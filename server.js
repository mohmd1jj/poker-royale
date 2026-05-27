const express = require("express");
const http = require("http");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 8080;
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is missing. Add it in Railway Variables.");
  process.exit(1);
}

if (!process.env.SESSION_SECRET) {
  console.warn("SESSION_SECRET is not set. Add it in Railway Variables for better security.");
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "poker-royale-dev-secret",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    maxAge: 1000 * 60 * 60 * 24 * 30
  }
});

app.use(express.json());
app.use(sessionMiddleware);

const io = new Server(server);
io.engine.use(sessionMiddleware);

const DAILY_BONUS_AMOUNT = 500;
const RELOAD_CHIPS_AMOUNT = 1000;
const RELOAD_MINIMUM_CHIPS = 100;
const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RELOAD_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 45000;
const disconnectTimers = new Map();

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      chips INTEGER NOT NULL DEFAULT 1000,
      wins INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0,
      hands_played INTEGER NOT NULL DEFAULT 0,
      biggest_pot INTEGER NOT NULL DEFAULT 0,
      best_hand VARCHAR(64) DEFAULT 'None',
      best_hand_rank INTEGER NOT NULL DEFAULT 0,
      last_bonus_at TIMESTAMP NULL,
      last_reload_at TIMESTAMP NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS wins INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS losses INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS hands_played INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS biggest_pot INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS best_hand VARCHAR(64) DEFAULT 'None'");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS best_hand_rank INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_bonus_at TIMESTAMP NULL");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_reload_at TIMESTAMP NULL");

  await pool.query(`
    CREATE TABLE IF NOT EXISTS game_history (
      id SERIAL PRIMARY KEY,
      room_id VARCHAR(64) NOT NULL,
      room_name VARCHAR(128) NOT NULL,
      pot INTEGER NOT NULL DEFAULT 0,
      winners TEXT NOT NULL,
      winner_ids TEXT NOT NULL,
      winning_hand VARCHAR(128) NOT NULL,
      result_summary TEXT NOT NULL,
      players_snapshot JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database ready.");
}

async function getUserById(id) {
  const result = await pool.query(
    `SELECT id, username, chips, wins, losses, hands_played, biggest_pot, best_hand,
            last_bonus_at, last_reload_at
     FROM users WHERE id = $1`,
    [id]
  );
  return result.rows[0] || null;
}

async function updateUserChips(userId, chips) {
  await pool.query("UPDATE users SET chips = $1 WHERE id = $2", [chips, userId]);
}

function getSessionUserId(req) {
  return req.session && req.session.userId ? req.session.userId : null;
}

function isCooldownReady(lastDate, cooldownMs) {
  if (!lastDate) return { ready: true, remainingMs: 0 };
  const elapsed = Date.now() - new Date(lastDate).getTime();
  return elapsed >= cooldownMs
    ? { ready: true, remainingMs: 0 }
    : { ready: false, remainingMs: cooldownMs - elapsed };
}

function formatRemaining(ms) {
  const hours = Math.floor(ms / (60 * 60 * 1000));
  const minutes = Math.ceil((ms % (60 * 60 * 1000)) / (60 * 1000));
  return hours + "h " + minutes + "m";
}

function findPlayerByUserId(userId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.userId === userId);
    if (player) return { room, player };
  }
  return null;
}

function isUserInActiveHand(userId) {
  const location = findPlayerByUserId(userId);
  if (!location) return false;
  const { room, player } = location;
  return room.handStarted && !player.waitingNextHand && !player.folded && room.phase !== "waiting" && room.phase !== "showdown";
}

function syncOnlineUserChips(userId, chips) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.userId === userId);
    if (player && !room.handStarted) {
      player.chips = chips;
      emitRoom(room);
    }
  }
}

async function recordGameHistory(room, summary, winners, winningHandName) {
  const playersSnapshot = room.players.map((player) => ({
    userId: player.userId,
    name: player.name,
    chips: player.chips,
    committedThisHand: player.committedThisHand || 0,
    folded: player.folded,
    allIn: player.allIn || false
  }));

  await pool.query(
    `INSERT INTO game_history
      (room_id, room_name, pot, winners, winner_ids, winning_hand, result_summary, players_snapshot)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      room.id,
      room.name,
      room.pot,
      winners.map((player) => player.name).join(", "),
      winners.map((player) => String(player.userId)).join(","),
      winningHandName,
      summary,
      JSON.stringify(playersSnapshot)
    ]
  );
}

async function updateUserStatsAfterHand(room, winners, bestHandsByUserId, biggestWonPot) {
  const winnerIds = new Set(winners.map((player) => player.userId));

  for (const player of room.players) {
    if (player.waitingNextHand) continue;
    const won = winnerIds.has(player.userId);
    const bestHand = bestHandsByUserId[player.userId] || { name: "Everyone else folded", rank: 0 };

    await pool.query(
      `UPDATE users
       SET wins = wins + $1,
           losses = losses + $2,
           hands_played = hands_played + 1,
           biggest_pot = GREATEST(biggest_pot, $3),
           best_hand = CASE WHEN best_hand_rank < $4 THEN $5 ELSE best_hand END,
           best_hand_rank = GREATEST(best_hand_rank, $4),
           chips = $6
       WHERE id = $7`,
      [won ? 1 : 0, won ? 0 : 1, won ? biggestWonPot : 0, bestHand.rank || 0, bestHand.name || "None", player.chips, player.userId]
    );
  }
}

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim().slice(0, 32);
    const password = String(req.body.password || "");

    if (!username || username.length < 3) {
      return res.status(400).json({ error: "Username must be at least 3 characters." });
    }
    if (!password || password.length < 4) {
      return res.status(400).json({ error: "Password must be at least 4 characters." });
    }

    const existing = await pool.query("SELECT id FROM users WHERE LOWER(username) = LOWER($1)", [username]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (username, password_hash, chips) VALUES ($1, $2, $3) RETURNING id, username, chips",
      [username, passwordHash, 1000]
    );

    req.session.userId = result.rows[0].id;
    res.json({ ok: true, user: result.rows[0] });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Register failed." });
  }
});

app.post("/api/login", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    const result = await pool.query(
      `SELECT id, username, password_hash, chips, wins, losses, hands_played,
              biggest_pot, best_hand, last_bonus_at, last_reload_at
       FROM users WHERE LOWER(username) = LOWER($1)`,
      [username]
    );
    const user = result.rows[0];
    if (!user) return res.status(400).json({ error: "Invalid username or password." });

    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) return res.status(400).json({ error: "Invalid username or password." });

    req.session.userId = user.id;
    delete user.password_hash;
    res.json({ ok: true, user });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Login failed." });
  }
});

app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get("/api/me", async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.json({ user: null });

    const user = await getUserById(userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.json({ user: null });
    }
    res.json({ user });
  } catch (error) {
    console.error("Me error:", error);
    res.status(500).json({ error: "Failed to load user." });
  }
});

app.post("/api/daily-bonus", async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Login first." });
    if (isUserInActiveHand(userId)) return res.status(400).json({ error: "You cannot claim bonus during an active hand." });

    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: "Login again." });

    const cooldown = isCooldownReady(user.last_bonus_at, BONUS_COOLDOWN_MS);
    if (!cooldown.ready) {
      return res.status(400).json({ error: "Daily bonus is not ready. Try again in " + formatRemaining(cooldown.remainingMs) + "." });
    }

    const newChips = user.chips + DAILY_BONUS_AMOUNT;
    await pool.query("UPDATE users SET chips = $1, last_bonus_at = CURRENT_TIMESTAMP WHERE id = $2", [newChips, userId]);
    syncOnlineUserChips(userId, newChips);
    res.json({ ok: true, chips: newChips, message: "Daily bonus claimed: +" + DAILY_BONUS_AMOUNT });
  } catch (error) {
    console.error("Daily bonus error:", error);
    res.status(500).json({ error: "Daily bonus failed." });
  }
});

app.post("/api/reload-chips", async (req, res) => {
  try {
    const userId = getSessionUserId(req);
    if (!userId) return res.status(401).json({ error: "Login first." });
    if (isUserInActiveHand(userId)) return res.status(400).json({ error: "You cannot reload during an active hand." });

    const user = await getUserById(userId);
    if (!user) return res.status(401).json({ error: "Login again." });
    if (user.chips >= RELOAD_MINIMUM_CHIPS) {
      return res.status(400).json({ error: "Reload is only available when chips are below " + RELOAD_MINIMUM_CHIPS + "." });
    }

    const cooldown = isCooldownReady(user.last_reload_at, RELOAD_COOLDOWN_MS);
    if (!cooldown.ready) {
      return res.status(400).json({ error: "Reload is not ready. Try again in " + formatRemaining(cooldown.remainingMs) + "." });
    }

    const newChips = Math.max(user.chips, RELOAD_CHIPS_AMOUNT);
    await pool.query("UPDATE users SET chips = $1, last_reload_at = CURRENT_TIMESTAMP WHERE id = $2", [newChips, userId]);
    syncOnlineUserChips(userId, newChips);
    res.json({ ok: true, chips: newChips, message: "Chips reloaded to " + newChips });
  } catch (error) {
    console.error("Reload error:", error);
    res.status(500).json({ error: "Reload failed." });
  }
});

app.get("/api/leaderboard", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username, chips, wins, losses, hands_played, biggest_pot, best_hand
       FROM users ORDER BY chips DESC, wins DESC, biggest_pot DESC LIMIT 10`
    );
    res.json({ leaderboard: result.rows });
  } catch (error) {
    console.error("Leaderboard error:", error);
    res.status(500).json({ error: "Failed to load leaderboard." });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, room_name, pot, winners, winning_hand, result_summary, created_at
       FROM game_history ORDER BY created_at DESC LIMIT 15`
    );
    res.json({ history: result.rows });
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({ error: "Failed to load history." });
  }
});

const rooms = {
  "royal-room": createRoom("royal-room", "Royal Room", "High energy table", 10, 20),
  "vip-room": createRoom("vip-room", "VIP Room", "Premium table", 25, 50),
  "beginner-room": createRoom("beginner-room", "Beginner Room", "Low stakes table", 5, 10)
};

function createRoom(id, name, description, smallBlindAmount, bigBlindAmount) {
  return {
    id,
    name,
    description,
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerIndex: -1,
    smallBlindIndex: -1,
    bigBlindIndex: -1,
    smallBlindAmount,
    bigBlindAmount,
    turnIndex: 0,
    phase: "waiting",
    status: "Waiting for players",
    handStarted: false,
    chatMessages: []
  };
}

function createDeck() {
  const suits = ["\u2660", "\u2665", "\u2666", "\u2663"];
  const ranks = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
  const deck = [];
  for (const suit of suits) for (const rank of ranks) deck.push(rank + suit);
  return deck;
}

function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = deck[i];
    deck[i] = deck[j];
    deck[j] = temp;
  }
  return deck;
}

function getPublicRooms() {
  return Object.values(rooms).map((room) => ({
    id: room.id,
    name: room.name,
    description: room.description,
    playerCount: room.players.length,
    connectedCount: room.players.filter((p) => !p.disconnected).length,
    waitingCount: room.players.filter((p) => p.waitingNextHand).length,
    smallBlindAmount: room.smallBlindAmount,
    bigBlindAmount: room.bigBlindAmount,
    pot: room.pot,
    phase: room.phase,
    status: room.status,
    isPlaying: room.handStarted && room.phase !== "waiting" && room.phase !== "showdown"
  }));
}

function getPublicRoomState(room) {
  return {
    id: room.id,
    name: room.name,
    description: room.description,
    smallBlindAmount: room.smallBlindAmount,
    bigBlindAmount: room.bigBlindAmount,
    players: room.players.map((player) => ({
      socketId: player.socketId,
      userId: player.userId,
      name: player.name,
      chips: player.chips,
      seat: player.seat,
      bet: player.bet,
      committedThisHand: player.committedThisHand || 0,
      role: player.role || "",
      folded: player.folded,
      allIn: player.allIn || false,
      disconnected: player.disconnected || false,
      waitingNextHand: player.waitingNextHand || false,
      isTurn: player.isTurn,
      status: player.status
    })),
    communityCards: room.communityCards,
    pot: room.pot,
    currentBet: room.currentBet,
    phase: room.phase,
    status: room.status,
    chatMessages: room.chatMessages || []
  };
}

function findPlayerLocation(socketId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) return { room, player };
  }
  return null;
}

function findPlayerLocationByUserId(userId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.userId === userId);
    if (player) return { room, player };
  }
  return null;
}

function resetRoomToWaiting(room) {
  room.deck = [];
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 0;
  room.turnIndex = 0;
  room.phase = "waiting";
  room.status = "Waiting for players";
  room.handStarted = false;
  room.smallBlindIndex = -1;
  room.bigBlindIndex = -1;

  room.players.forEach((player) => {
    player.cards = [];
    player.bet = 0;
    player.committedThisHand = 0;
    player.folded = false;
    player.allIn = false;
    player.isTurn = false;
    player.status = player.disconnected ? "Disconnected" : "Waiting";
    player.role = "";
    player.hasActed = false;
    player.waitingNextHand = false;
  });
}

function removePlayerByUserId(userId) {
  for (const room of Object.values(rooms)) {
    const index = room.players.findIndex((p) => p.userId === userId);
    if (index !== -1) {
      const removedPlayer = room.players.splice(index, 1)[0];
      room.players.forEach((player, playerIndex) => { player.seat = playerIndex; });
      if (room.players.length < 2) resetRoomToWaiting(room);
      return { room, removedPlayer };
    }
  }
  return null;
}

function getNextPlayerIndex(room, fromIndex) {
  if (!room.players.length) return 0;
  for (let i = 1; i <= room.players.length; i++) {
    const index = (fromIndex + i + room.players.length) % room.players.length;
    const player = room.players[index];
    if (player && player.chips > 0 && !player.disconnected && !player.waitingNextHand) return index;
  }
  return 0;
}

function getNextActionIndex(room, fromIndex) {
  if (!room.players.length) return -1;
  for (let i = 1; i <= room.players.length; i++) {
    const index = (fromIndex + i + room.players.length) % room.players.length;
    const player = room.players[index];
    if (player && !player.folded && !player.allIn && !player.disconnected && !player.waitingNextHand && player.chips > 0) return index;
  }
  return -1;
}

function activePlayers(room) {
  return room.players.filter((player) => !player.folded && !player.waitingNextHand);
}

function playersWhoCanAct(room) {
  return room.players.filter((player) => !player.folded && !player.allIn && !player.disconnected && !player.waitingNextHand && player.chips > 0);
}

function playablePlayers(room) {
  return room.players.filter((player) => player.chips > 0 && !player.disconnected && !player.waitingNextHand);
}

function onlyOnePlayerLeft(room) {
  return activePlayers(room).length <= 1;
}

function clearPlayerRoles(room) { room.players.forEach((player) => { player.role = ""; }); }

function setupDealerAndBlinds(room) {
  clearPlayerRoles(room);
  room.dealerIndex = getNextPlayerIndex(room, room.dealerIndex);

  if (playablePlayers(room).length === 2) {
    room.smallBlindIndex = room.dealerIndex;
    room.bigBlindIndex = getNextPlayerIndex(room, room.smallBlindIndex);
  } else {
    room.smallBlindIndex = getNextPlayerIndex(room, room.dealerIndex);
    room.bigBlindIndex = getNextPlayerIndex(room, room.smallBlindIndex);
  }

  if (room.players[room.dealerIndex]) room.players[room.dealerIndex].role = "D";
  if (room.players[room.smallBlindIndex]) room.players[room.smallBlindIndex].role = room.players[room.smallBlindIndex].role ? room.players[room.smallBlindIndex].role + " / SB" : "SB";
  if (room.players[room.bigBlindIndex]) room.players[room.bigBlindIndex].role = "BB";
}

async function takeChips(player, amount) {
  const realAmount = Math.max(0, Math.min(player.chips, amount));
  player.chips -= realAmount;
  player.bet += realAmount;
  player.committedThisHand += realAmount;
  if (player.chips === 0) player.allIn = true;
  await updateUserChips(player.userId, player.chips);
  return realAmount;
}

async function postBlind(room, playerIndex, amount, label) {
  const player = room.players[playerIndex];
  if (!player) return { player: null, amount: 0, label };
  const blindAmount = await takeChips(player, amount);
  player.status = label + " " + blindAmount;
  player.hasActed = false;
  room.pot += blindAmount;
  return { player, amount: blindAmount, label };
}

function bettingRoundComplete(room) {
  if (onlyOnePlayerLeft(room)) return true;
  const canAct = playersWhoCanAct(room);
  if (canAct.length === 0) return true;
  return canAct.every((player) => player.hasActed && player.bet >= room.currentBet);
}

async function startHand(room) {
  if (playablePlayers(room).length < 2) {
    room.status = "Need at least 2 connected players with chips";
    room.phase = "waiting";
    room.handStarted = false;
    return;
  }

  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = room.bigBlindAmount;
  room.phase = "preflop";
  room.handStarted = true;
  room.status = "New hand started";

  room.players.forEach((player) => {
    const canPlay = player.chips > 0 && !player.disconnected && !player.waitingNextHand;
    player.cards = canPlay ? [room.deck.pop(), room.deck.pop()] : [];
    player.bet = 0;
    player.committedThisHand = 0;
    player.folded = !canPlay;
    player.allIn = false;
    player.status = canPlay ? "In hand" : player.disconnected ? "Disconnected" : "Waiting next hand";
    player.isTurn = false;
    player.hasActed = false;
    player.role = "";
    player.waitingNextHand = false;
  });

  setupDealerAndBlinds(room);
  const smallBlind = await postBlind(room, room.smallBlindIndex, room.smallBlindAmount, "Small Blind");
  const bigBlind = await postBlind(room, room.bigBlindIndex, room.bigBlindAmount, "Big Blind");
  room.currentBet = Math.max(smallBlind.amount, bigBlind.amount);
  room.turnIndex = getNextActionIndex(room, room.bigBlindIndex);

  const sbName = smallBlind.player ? smallBlind.player.name : "Unknown";
  const bbName = bigBlind.player ? bigBlind.player.name : "Unknown";
  room.status = sbName + " posts SB " + smallBlind.amount + ", " + bbName + " posts BB " + bigBlind.amount;
  setCurrentTurn(room);
}

function setCurrentTurn(room) {
  room.players.forEach((player) => { player.isTurn = false; });

  if (onlyOnePlayerLeft(room)) { finishHand(room); return; }
  if (playersWhoCanAct(room).length === 0) { advancePhase(room); return; }

  if (room.turnIndex === -1 || !room.players[room.turnIndex] || room.players[room.turnIndex].folded || room.players[room.turnIndex].allIn || room.players[room.turnIndex].disconnected || room.players[room.turnIndex].waitingNextHand || room.players[room.turnIndex].chips <= 0) {
    room.turnIndex = getNextActionIndex(room, room.turnIndex);
  }

  const currentPlayer = room.players[room.turnIndex];
  if (currentPlayer) {
    currentPlayer.isTurn = true;
    room.status = currentPlayer.name + "'s turn";
  }
}

function nextTurn(room) {
  if (room.players.length < 2) { resetRoomToWaiting(room); return; }
  room.turnIndex = getNextActionIndex(room, room.turnIndex);
  setCurrentTurn(room);
}

function dealRemainingCommunityCards(room) {
  while (room.communityCards.length < 5 && room.deck.length > 0) room.communityCards.push(room.deck.pop());
}

function advancePhase(room) {
  if (onlyOnePlayerLeft(room)) { finishHand(room); return; }
  if (playersWhoCanAct(room).length === 0) { dealRemainingCommunityCards(room); finishHand(room); return; }

  if (room.phase === "preflop") {
    room.communityCards.push(room.deck.pop(), room.deck.pop(), room.deck.pop());
    room.phase = "flop";
    room.status = "Flop dealt";
  } else if (room.phase === "flop") {
    room.communityCards.push(room.deck.pop());
    room.phase = "turn";
    room.status = "Turn card dealt";
  } else if (room.phase === "turn") {
    room.communityCards.push(room.deck.pop());
    room.phase = "river";
    room.status = "River card dealt";
  } else if (room.phase === "river") {
    finishHand(room);
    return;
  }

  room.currentBet = 0;
  room.players.forEach((player) => { player.bet = 0; player.hasActed = false; });

  if (playersWhoCanAct(room).length === 0) { dealRemainingCommunityCards(room); finishHand(room); return; }
  room.turnIndex = getNextActionIndex(room, room.dealerIndex);
  setCurrentTurn(room);
}

async function proceedAfterAction(room) {
  if (onlyOnePlayerLeft(room)) { await finishHand(room); return; }
  if (bettingRoundComplete(room)) { advancePhase(room); return; }
  nextTurn(room);
}

const HAND_RANKS = { HIGH_CARD: 1, ONE_PAIR: 2, TWO_PAIR: 3, THREE_OF_A_KIND: 4, STRAIGHT: 5, FLUSH: 6, FULL_HOUSE: 7, FOUR_OF_A_KIND: 8, STRAIGHT_FLUSH: 9, ROYAL_FLUSH: 10 };
const RANK_VALUES = { "2": 2, "3": 3, "4": 4, "5": 5, "6": 6, "7": 7, "8": 8, "9": 9, "10": 10, "J": 11, "Q": 12, "K": 13, "A": 14 };

function parseCard(card) { const suit = card.slice(-1); const rank = card.slice(0, -1); return { card, rank, suit, value: RANK_VALUES[rank] }; }
function getCounts(values) { const counts = {}; values.forEach((value) => { counts[value] = (counts[value] || 0) + 1; }); return counts; }
function getStraightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);
  if (unique.includes(14)) unique.push(1);
  for (let i = 0; i <= unique.length - 5; i++) {
    const slice = unique.slice(i, i + 5);
    if (slice[0] - 1 === slice[1] && slice[1] - 1 === slice[2] && slice[2] - 1 === slice[3] && slice[3] - 1 === slice[4]) return slice[0];
  }
  return null;
}
function evaluateSevenCards(cards) {
  const parsed = cards.map(parseCard);
  const values = parsed.map((card) => card.value).sort((a, b) => b - a);
  const counts = getCounts(values);
  const groups = Object.entries(counts).map(([value, count]) => ({ value: Number(value), count })).sort((a, b) => b.count !== a.count ? b.count - a.count : b.value - a.value);
  const suits = {};
  parsed.forEach((card) => { if (!suits[card.suit]) suits[card.suit] = []; suits[card.suit].push(card.value); });
  let flushValues = null;
  Object.values(suits).forEach((suitValues) => { if (suitValues.length >= 5) { const sortedSuitValues = suitValues.sort((a, b) => b - a); if (!flushValues || sortedSuitValues[0] > flushValues[0]) flushValues = sortedSuitValues; } });
  if (flushValues) {
    const straightFlushHigh = getStraightHigh(flushValues);
    if (straightFlushHigh === 14) return { rank: HAND_RANKS.ROYAL_FLUSH, name: "Royal Flush", values: [14] };
    if (straightFlushHigh) return { rank: HAND_RANKS.STRAIGHT_FLUSH, name: "Straight Flush", values: [straightFlushHigh] };
  }
  const four = groups.find((group) => group.count === 4);
  if (four) { const kicker = values.find((value) => value !== four.value); return { rank: HAND_RANKS.FOUR_OF_A_KIND, name: "Four of a Kind", values: [four.value, kicker] }; }
  const threeGroups = groups.filter((group) => group.count === 3);
  const pairGroups = groups.filter((group) => group.count === 2);
  if (threeGroups.length >= 1 && (pairGroups.length >= 1 || threeGroups.length >= 2)) { const three = threeGroups[0]; const pair = pairGroups[0] || threeGroups[1]; return { rank: HAND_RANKS.FULL_HOUSE, name: "Full House", values: [three.value, pair.value] }; }
  if (flushValues) return { rank: HAND_RANKS.FLUSH, name: "Flush", values: flushValues.slice(0, 5) };
  const straightHigh = getStraightHigh(values);
  if (straightHigh) return { rank: HAND_RANKS.STRAIGHT, name: "Straight", values: [straightHigh] };
  if (threeGroups.length >= 1) { const three = threeGroups[0]; const kickers = values.filter((value) => value !== three.value).slice(0, 2); return { rank: HAND_RANKS.THREE_OF_A_KIND, name: "Three of a Kind", values: [three.value, ...kickers] }; }
  if (pairGroups.length >= 2) { const firstPair = pairGroups[0]; const secondPair = pairGroups[1]; const kicker = values.find((value) => value !== firstPair.value && value !== secondPair.value); return { rank: HAND_RANKS.TWO_PAIR, name: "Two Pair", values: [firstPair.value, secondPair.value, kicker] }; }
  if (pairGroups.length === 1) { const pair = pairGroups[0]; const kickers = values.filter((value) => value !== pair.value).slice(0, 3); return { rank: HAND_RANKS.ONE_PAIR, name: "One Pair", values: [pair.value, ...kickers] }; }
  return { rank: HAND_RANKS.HIGH_CARD, name: "High Card", values: values.slice(0, 5) };
}
function compareHands(handA, handB) {
  if (handA.rank !== handB.rank) return handA.rank - handB.rank;
  for (let i = 0; i < Math.max(handA.values.length, handB.values.length); i++) { const valueA = handA.values[i] || 0; const valueB = handB.values[i] || 0; if (valueA !== valueB) return valueA - valueB; }
  return 0;
}
function getPlayerHand(player, room) { return evaluateSevenCards([...(player.cards || []), ...room.communityCards]); }
function getBestPlayersForPot(eligiblePlayers, room) {
  let bestHand = null; let winners = [];
  eligiblePlayers.forEach((player) => { const hand = getPlayerHand(player, room); if (!bestHand || compareHands(hand, bestHand) > 0) { bestHand = hand; winners = [player]; } else if (compareHands(hand, bestHand) === 0) winners.push(player); });
  return { winners, hand: bestHand };
}
function buildSidePots(room) {
  const committedPlayers = room.players.filter((player) => (player.committedThisHand || 0) > 0).map((player) => ({ player, committed: player.committedThisHand || 0 })).sort((a, b) => a.committed - b.committed);
  const levels = [...new Set(committedPlayers.map((item) => item.committed))];
  const sidePots = []; let previousLevel = 0;
  levels.forEach((level) => { const contributors = room.players.filter((player) => (player.committedThisHand || 0) >= level); const amount = (level - previousLevel) * contributors.length; const eligiblePlayers = contributors.filter((player) => !player.folded && !player.waitingNextHand); if (amount > 0 && eligiblePlayers.length > 0) sidePots.push({ amount, eligiblePlayers }); previousLevel = level; });
  return sidePots;
}
function splitAmount(amount, winners) {
  const baseShare = Math.floor(amount / winners.length); let remainder = amount % winners.length;
  return winners.map((winner) => { const extra = remainder > 0 ? 1 : 0; if (remainder > 0) remainder--; return { player: winner, amount: baseShare + extra }; });
}
async function finishHand(room) {
  const remainingPlayers = room.players.filter((player) => !player.folded && !player.waitingNextHand);
  if (remainingPlayers.length === 0) { resetRoomToWaiting(room); return; }
  const resultMessages = []; const payoutByUserId = {}; const bestHandsByUserId = {}; let allWinners = []; let topWinningHandName = "Everyone else folded"; let topWinningHandRank = 0;
  if (remainingPlayers.length === 1) {
    const winner = remainingPlayers[0]; winner.chips += room.pot; payoutByUserId[winner.userId] = room.pot; allWinners = [winner]; resultMessages.push(winner.name + " wins " + room.pot + " because everyone else folded.");
  } else {
    if (room.communityCards.length < 5) dealRemainingCommunityCards(room);
    remainingPlayers.forEach((player) => { bestHandsByUserId[player.userId] = getPlayerHand(player, room); });
    const sidePots = buildSidePots(room);
    sidePots.forEach((sidePot, index) => {
      const result = getBestPlayersForPot(sidePot.eligiblePlayers, room); const payouts = splitAmount(sidePot.amount, result.winners);
      payouts.forEach((payout) => { payout.player.chips += payout.amount; payoutByUserId[payout.player.userId] = (payoutByUserId[payout.player.userId] || 0) + payout.amount; });
      if (result.hand && result.hand.rank > topWinningHandRank) { topWinningHandRank = result.hand.rank; topWinningHandName = result.hand.name; }
      result.winners.forEach((winner) => { if (!allWinners.find((player) => player.userId === winner.userId)) allWinners.push(winner); });
      const winnerNames = result.winners.map((player) => player.name).join(" & "); const potLabel = index === 0 ? "main pot" : "side pot " + index;
      resultMessages.push(winnerNames + " win " + sidePot.amount + " from " + potLabel + " with " + result.hand.name);
    });
  }
  const biggestWonPot = Math.max(0, ...Object.values(payoutByUserId));
  room.status = resultMessages.join(" | "); room.phase = "showdown"; room.handStarted = false;
  room.players.forEach((player) => { player.isTurn = false; player.status = player.waitingNextHand ? "Waiting next hand" : remainingPlayers.includes(player) ? "Showdown" : "Folded"; });
  await updateUserStatsAfterHand(room, allWinners, bestHandsByUserId, biggestWonPot);
  await recordGameHistory(room, room.status, allWinners, topWinningHandName);
  io.to(room.id).emit("gameMessage", room.status); emitRoom(room);
  setTimeout(async () => { if (playablePlayers(room).length >= 2) { await startHand(room); emitRoom(room); } else { resetRoomToWaiting(room); emitRoom(room); } }, 7000);
}
function emitPrivateCards(room) { room.players.forEach((player) => { io.to(player.socketId).emit("privateCards", player.cards || []); }); }
function emitRoom(room) { io.to(room.id).emit("roomState", getPublicRoomState(room)); emitPrivateCards(room); io.emit("roomsUpdate", getPublicRooms()); }

function sanitizeChatMessage(message) {
  return String(message || "")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 150);
}

function addRoomChatMessage(room, message) {
  if (!room.chatMessages) room.chatMessages = [];
  room.chatMessages.push(message);
  if (room.chatMessages.length > 50) {
    room.chatMessages = room.chatMessages.slice(-50);
  }
}


app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#03140b" />
  <title>Poker Royale</title>
  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
    :root {
      --bg: #03140b;
      --panel: rgba(2, 14, 8, 0.78);
      --panel2: rgba(8, 38, 22, 0.78);
      --gold: #facc15;
      --gold2: #ca8a04;
      --green: #22c55e;
      --muted: #b8c7bd;
      --text: #fff7c2;
      --line: rgba(250, 204, 21, 0.22);
      --danger: #ef4444;
    }
    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Tahoma, sans-serif;
      color: white;
      background:
        radial-gradient(circle at 18% 0%, rgba(250,204,21,.16), transparent 30%),
        radial-gradient(circle at 82% 8%, rgba(34,197,94,.16), transparent 32%),
        linear-gradient(180deg, #062819 0%, #03140b 52%, #010604 100%);
      padding: calc(14px + env(safe-area-inset-top)) 14px calc(22px + env(safe-area-inset-bottom));
      overflow-x: hidden;
    }
    .shell { width: 100%; max-width: 980px; margin: 0 auto; }
    .hero {
      position: relative;
      border: 1px solid var(--line);
      border-radius: 30px;
      padding: 18px;
      background:
        linear-gradient(145deg, rgba(0,0,0,.72), rgba(5,46,22,.54)),
        radial-gradient(circle at top right, rgba(250,204,21,.13), transparent 42%);
      box-shadow: 0 22px 60px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.07);
      overflow: hidden;
    }
    .hero:after {
      content: "";
      position: absolute;
      width: 240px; height: 240px;
      border-radius: 50%;
      border: 38px solid rgba(250,204,21,.045);
      left: -90px; bottom: -120px;
    }
    .topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; position: relative; z-index: 2; }
    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .mark {
      width: 66px; height: 66px; border-radius: 22px;
      display: grid; place-items: center;
      background: linear-gradient(180deg, #fff7ad, var(--gold) 48%, #b45309);
      color: #07121f;
      font-weight: 1000;
      font-size: 25px;
      box-shadow: 0 14px 34px rgba(250,204,21,.25);
      flex: 0 0 auto;
    }
    h1 { margin: 0; font-size: clamp(34px, 8vw, 60px); line-height: .95; color: #fff7ad; letter-spacing: .5px; }
    .subtitle { margin: 8px 0 0; color: var(--muted); font-size: 14px; line-height: 1.7; }
    .lang {
      border: 1px solid rgba(250,204,21,.5);
      background: rgba(0,0,0,.42);
      color: var(--gold);
      border-radius: 999px;
      width: 58px; height: 58px;
      font-weight: 1000;
      font-size: 16px;
      box-shadow: inset 0 0 0 1px rgba(255,255,255,.05);
      flex: 0 0 auto;
    }
    .account-box {
      position: relative;
      z-index: 2;
      margin-top: 14px;
      border: 1px solid rgba(250,204,21,.18);
      border-radius: 22px;
      padding: 12px;
      background: rgba(0,0,0,.34);
      display: grid;
      gap: 10px;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.06);
    }
    .account-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .account-title { display: flex; align-items: center; gap: 9px; min-width: 0; }
    .account-avatar {
      width: 38px; height: 38px; border-radius: 14px;
      display: grid; place-items: center;
      background: linear-gradient(135deg, rgba(250,204,21,.95), rgba(202,138,4,.85));
      color: #111827; font-weight: 1000; direction: ltr;
    }
    .account-name { color: #fff7ad; font-weight: 1000; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
    .coin-pill {
      display: inline-flex; align-items: center; gap: 7px;
      border: 1px solid rgba(250,204,21,.28);
      border-radius: 999px;
      padding: 8px 12px;
      background: rgba(250,204,21,.10);
      color: #fff7ad;
      font-weight: 1000;
      font-size: 13px;
      direction: ltr;
    }
    .coin-dot { width: 14px; height: 14px; border-radius: 50%; background: radial-gradient(circle at 30% 25%, #fff7ad, #facc15 52%, #b45309); box-shadow: 0 0 13px rgba(250,204,21,.55); }
    .login-mini { display: grid; grid-template-columns: 1fr 1fr auto auto; gap: 8px; }
    .login-mini input {
      min-width: 0;
      border: 1px solid rgba(250,204,21,.22);
      background: rgba(0,0,0,.38);
      color: white;
      border-radius: 13px;
      padding: 11px 12px;
      outline: 0;
      font-size: 13px;
    }
    .mini-btn {
      border: 0;
      border-radius: 13px;
      padding: 11px 13px;
      font-weight: 1000;
      color: #fff;
      background: linear-gradient(135deg, #166534, #22c55e);
      white-space: nowrap;
      cursor: pointer;
    }
    .mini-btn.gold { color: #111827; background: linear-gradient(135deg, #fff7ad, #facc15, #ca8a04); }
    .mini-btn.ghost { background: rgba(255,255,255,.07); color: #dbe8df; border: 1px solid rgba(255,255,255,.10); }
    .headline { position: relative; z-index: 2; margin-top: 22px; }
    .headline h2 { margin: 0; color: var(--gold); font-size: clamp(25px, 6vw, 44px); line-height: 1.35; }
    .headline p { margin: 10px 0 0; color: #d7e4dc; font-size: 15px; line-height: 1.9; max-width: 760px; }
    .section-title {
      margin: 24px 4px 14px;
      display: flex; align-items: center; justify-content: space-between; gap: 12px;
      color: var(--gold);
      font-size: 23px;
      font-weight: 1000;
    }
    .section-title small {
      color: var(--muted); font-size: 12px; border: 1px solid rgba(250,204,21,.22); border-radius: 999px; padding: 7px 10px; background: rgba(0,0,0,.25);
    }
    .games { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
    .game-card {
      position: relative;
      min-height: 206px;
      border-radius: 32px;
      border: 1px solid rgba(250,204,21,.20);
      padding: 18px;
      background:
        radial-gradient(circle at 16% 22%, var(--glow), transparent 34%),
        linear-gradient(145deg, rgba(0,0,0,.72), rgba(6,30,18,.82));
      box-shadow: 0 18px 52px rgba(0,0,0,.36), inset 0 1px 0 rgba(255,255,255,.07);
      overflow: hidden;
      display: flex; flex-direction: column; justify-content: space-between;
      text-decoration: none;
      color: inherit;
      cursor: pointer;
    }
    .game-card:active { transform: scale(.985); }
    .game-card:after {
      content: ""; position: absolute; inset: auto -34px -46px auto;
      width: 155px; height: 155px; border-radius: 50%; border: 28px solid rgba(255,255,255,.035);
    }
    .game-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; position: relative; z-index: 1; }
    .logo-wrap {
      width: 86px; height: 86px; border-radius: 28px;
      display: grid; place-items: center;
      background: linear-gradient(145deg, rgba(255,255,255,.13), rgba(255,255,255,.04));
      border: 1px solid rgba(255,255,255,.12);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.09), 0 14px 32px rgba(0,0,0,.26);
      direction: ltr;
      overflow: hidden;
      flex: 0 0 auto;
    }
    .game-logo { width: 66px; height: 66px; position: relative; display: grid; place-items: center; color: var(--accent); font-weight: 1000; }
    .logo-poker { font-size: 34px; }
    .logo-poker::before { content: "A"; transform: rotate(-8deg); }
    .logo-poker::after { content: "\\2660"; position: absolute; bottom: 7px; right: 10px; font-size: 20px; color: #fff7ad; }
    .logo-chess { font-size: 42px; }
    .logo-chess::before { content: "\\265E"; }
    .logo-mench { grid-template-columns: repeat(2, 20px); grid-template-rows: repeat(2,20px); gap: 5px; }
    .logo-mench span { width: 20px; height: 20px; border-radius: 50%; background: currentColor; box-shadow: 0 0 16px color-mix(in srgb, currentColor 55%, transparent); }
    .logo-backgammon::before, .logo-backgammon::after { content:""; position:absolute; width: 18px; height: 54px; background: currentColor; clip-path: polygon(50% 0,100% 100%,0 100%); opacity:.95; }
    .logo-backgammon::before { left: 10px; top: 6px; }
    .logo-backgammon::after { right: 10px; bottom: 6px; transform: rotate(180deg); color:#fff7ad; background:#fff7ad; }
    .logo-hokm { font-size: 35px; }
    .logo-hokm::before { content:"\\265B"; }
    .logo-hokm::after { content:"H"; position:absolute; right: 7px; bottom: 2px; font-size: 18px; color:#fff7ad; }
    .logo-4barg { font-size: 33px; }
    .logo-4barg::before { content:"4"; }
    .logo-4barg::after { content:"\\2663"; position:absolute; right: 5px; bottom: 2px; font-size: 24px; color:#fff7ad; }
    .badge {
      border: 1px solid rgba(250,204,21,.28);
      background: rgba(0,0,0,.34);
      color: var(--gold);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 12px;
      font-weight: 1000;
      white-space: nowrap;
    }
    .badge.live { background: rgba(34,197,94,.16); border-color: rgba(34,197,94,.36); color: #86efac; }
    .game-name { position: relative; z-index: 1; color: #fff7ad; font-size: 30px; font-weight: 1000; margin-bottom: 7px; }
    .game-desc { position: relative; z-index: 1; color: #cbd5e1; font-size: 14px; line-height: 1.7; }
    .bottom-nav {
      position: sticky; bottom: calc(10px + env(safe-area-inset-bottom));
      margin-top: 18px;
      border: 1px solid rgba(250,204,21,.18);
      border-radius: 24px;
      background: rgba(0,0,0,.62);
      backdrop-filter: blur(12px);
      padding: 9px;
      display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;
      box-shadow: 0 -12px 42px rgba(0,0,0,.28);
    }
    .nav-item { border: 0; border-radius: 17px; padding: 13px 8px; color: #dbe8df; background: transparent; font-weight: 900; }
    .nav-item.active { color: #111827; background: linear-gradient(135deg, #fff7ad, var(--gold)); }
    .toast {
      position: fixed; left: 14px; right: 14px; bottom: calc(86px + env(safe-area-inset-bottom));
      border: 1px solid rgba(250,204,21,.24); border-radius: 18px; padding: 13px 14px;
      background: rgba(0,0,0,.82); color: #fff7ad; font-weight: 900; text-align: center;
      opacity: 0; transform: translateY(10px); transition: .2s; pointer-events: none; z-index: 20;
    }
    .toast.show { opacity: 1; transform: translateY(0); }

    .account-widget {
      position: fixed;
      left: 14px;
      top: calc(16px + env(safe-area-inset-top));
      z-index: 50;
      direction: rtl;
    }
    .account-toggle {
      width: 58px;
      min-height: 64px;
      border: 1px solid rgba(250,204,21,.28);
      border-radius: 22px;
      background:
        radial-gradient(circle at top, rgba(250,204,21,.22), transparent 52%),
        rgba(0,0,0,.66);
      color: #fff7ad;
      display: grid;
      place-items: center;
      gap: 3px;
      box-shadow: 0 14px 38px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08);
      backdrop-filter: blur(12px);
      cursor: pointer;
    }
    .account-icon {
      width: 34px; height: 34px;
      border-radius: 14px;
      display: grid; place-items: center;
      background: linear-gradient(135deg, #fff7ad, #facc15, #ca8a04);
      color: #111827;
      font-size: 20px;
      box-shadow: 0 0 18px rgba(250,204,21,.28);
    }
    .mini-coin {
      max-width: 48px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      direction: ltr;
      font-size: 10px;
      font-weight: 1000;
      color: #facc15;
    }
    .account-panel {
      position: absolute;
      left: 0;
      top: 74px;
      width: min(342px, calc(100vw - 28px));
      border: 1px solid rgba(250,204,21,.22);
      border-radius: 24px;
      padding: 12px;
      background:
        linear-gradient(145deg, rgba(0,0,0,.86), rgba(5,46,22,.76)),
        radial-gradient(circle at top right, rgba(250,204,21,.13), transparent 40%);
      box-shadow: 0 22px 70px rgba(0,0,0,.50), inset 0 1px 0 rgba(255,255,255,.07);
      backdrop-filter: blur(16px);
      display: none;
    }
    .account-widget.open .account-panel { display: grid; gap: 10px; }
    .account-note { color:#b8c7bd; font-size:12px; margin-top:4px; line-height:1.6; }
    @media (max-width: 720px) {
      .hero { border-radius: 26px; padding: 16px; }
      .account-widget { left: 10px; top: calc(10px + env(safe-area-inset-top)); }
      .account-toggle { width: 54px; min-height: 60px; border-radius: 20px; }
      .account-panel { top: 68px; width: calc(100vw - 20px); }

      .topbar { align-items: flex-start; }
      .mark { width: 58px; height: 58px; border-radius: 20px; font-size: 22px; }
      .subtitle { font-size: 13px; }
      .login-mini { grid-template-columns: 1fr; }
      .games { grid-template-columns: 1fr; }
      .game-card { min-height: 182px; border-radius: 27px; }
      .logo-wrap { width: 76px; height: 76px; border-radius: 24px; }
      .game-logo { width: 58px; height: 58px; }
      .game-name { font-size: 26px; }
    }

/* ================================
   POKER CLEAN WINDOW PATCH
   Hide account, stats, chat, online table panels from /games/poker
   ================================ */
body.poker-clean-mode .auth-panel,
body.poker-clean-mode .top-status,
body.poker-clean-mode .main-layout > aside.panel,
body.poker-clean-mode .chat-panel,
body.poker-clean-mode .log {
  display: none !important;
}
body.poker-clean-mode .app { max-width: 980px !important; }
body.poker-clean-mode .main-layout { display: block !important; }
body.poker-clean-mode main { width: 100% !important; }
body.poker-clean-mode .top-row { margin-bottom: 14px !important; }
body.poker-clean-mode .poker-table { margin-top: 8px !important; min-height: 600px !important; }
body.poker-clean-mode .turn-status { top: 330px !important; }
body.poker-clean-mode .actions { box-shadow: 0 -18px 55px rgba(0,0,0,.50) !important; }
body.poker-clean-mode::after {
  content: "POKER TABLE";
  position: fixed;
  top: calc(8px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 9998;
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(250,204,21,.96), rgba(202,138,4,.94));
  color: #111827;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 1.4px;
  box-shadow: 0 8px 24px rgba(250,204,21,.28);
  pointer-events: none;
}
@media(max-width:850px){ body.poker-clean-mode .poker-table{ min-height: 560px !important; } }
  </style>
</head>
<body>
  <div class="account-widget" id="accountWidget" aria-label="User menu">
    <button class="account-toggle" id="accountToggle" type="button" aria-label="Account">
      <span class="account-icon">&#128100;</span>
      <span class="mini-coin" id="miniCoin">--</span>
    </button>
    <section class="account-panel" aria-label="User account panel">
      <div class="account-row">
        <div class="account-title">
          <div class="account-avatar" id="accountAvatar">?</div>
          <div>
            <div class="account-name" id="accountName">&#1705;&#1575;&#1585;&#1576;&#1585; &#1605;&#1607;&#1605;&#1575;&#1606;</div>
            <div class="account-note">&#1605;&#1608;&#1580;&#1608;&#1583;&#1740; &#1587;&#1705;&#1607; &#1583;&#1585; &#1607;&#1605;&#1607; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575; &#1740;&#1705;&#1587;&#1575;&#1606; &#1575;&#1587;&#1578;</div>
          </div>
        </div>
        <div class="coin-pill"><span class="coin-dot"></span><span id="coinAmount">--</span></div>
      </div>
      <div class="login-mini" id="loginMini">
        <input id="homeUsername" placeholder="Username" autocomplete="username" />
        <input id="homePassword" placeholder="Password" type="password" autocomplete="current-password" />
        <button class="mini-btn" id="homeLogin" type="button">&#1608;&#1585;&#1608;&#1583;</button>
        <button class="mini-btn gold" id="homeRegister" type="button">&#1579;&#1576;&#1578;&#8204;&#1606;&#1575;&#1605;</button>
      </div>
      <div class="account-row" id="loggedActions" style="display:none;">
        <button class="mini-btn gold" id="homeBonus" type="button">&#1580;&#1575;&#1740;&#1586;&#1607; &#1585;&#1608;&#1586;&#1575;&#1606;&#1607;</button>
        <button class="mini-btn ghost" id="homeLogout" type="button">&#1582;&#1585;&#1608;&#1580;</button>
      </div>
    </section>
  </div>
  <main class="shell">
    <section class="hero">
      <div class="topbar">
        <div class="brand">
          <div class="mark">PR</div>
          <div>
            <h1>Poker Royale</h1>
            <p class="subtitle">&#1662;&#1604;&#1578;&#1601;&#1585;&#1605; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606; &#1705;&#1604;&#1575;&#1587;&#1740;&#1705; &#1608; &#1585;&#1602;&#1575;&#1576;&#1578;&#1740;</p>
          </div>
        </div>
        <button class="lang" type="button">FA</button>
      </div>

      <div class="headline">
        <h2>&#1576;&#1575;&#1586;&#1740; &#1605;&#1608;&#1585;&#1583; &#1593;&#1604;&#1575;&#1602;&#1607;&#8204;&#1575;&#1578; &#1585;&#1575; &#1575;&#1606;&#1578;&#1582;&#1575;&#1576; &#1705;&#1606;</h2>
        <p>&#1575;&#1586; &#1575;&#1740;&#1606; &#1589;&#1601;&#1581;&#1607; &#1608;&#1575;&#1585;&#1583; &#1662;&#1608;&#1705;&#1585; &#1588;&#1608; &#1740;&#1575; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1576;&#1593;&#1583;&#1740; &#1585;&#1575; &#1583;&#1606;&#1576;&#1575;&#1604; &#1705;&#1606;. &#1605;&#1608;&#1580;&#1608;&#1583;&#1740; &#1587;&#1705;&#1607;&#8204;&#1575;&#1578; &#1576;&#1740;&#1606; &#1607;&#1605;&#1607; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575; &#1605;&#1588;&#1578;&#1585;&#1705; &#1575;&#1587;&#1578;.</p>
      </div>
    </section>

    <div class="section-title">
      <span>&#1604;&#1740;&#1587;&#1578; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;</span>
      <small>&#1589;&#1601;&#1581;&#1607; &#1575;&#1589;&#1604;&#1740;</small>
    </div>

    <section class="games" aria-label="Games">
      <a class="game-card" href="/games/poker" style="--accent:#facc15;--glow:rgba(250,204,21,.20)">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-poker"></div></div><div class="badge live">&#1601;&#1593;&#1575;&#1604;</div></div>
        <div><div class="game-name">&#1662;&#1608;&#1705;&#1585;</div><div class="game-desc">Texas Hold&#8217;em &#1576;&#1575; &#1605;&#1740;&#1586; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606; &#1608; &#1605;&#1608;&#1580;&#1608;&#1583;&#1740; &#1587;&#1705;&#1607; &#1605;&#1588;&#1578;&#1585;&#1705;</div></div>
      </a>

      <article class="game-card soon" style="--accent:#fff7ad;--glow:rgba(255,247,173,.16)" data-game="&#1588;&#1591;&#1585;&#1606;&#1580;">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-chess"></div></div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1588;&#1591;&#1585;&#1606;&#1580;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1575;&#1587;&#1578;&#1585;&#1575;&#1578;&#1688;&#1740;&#1705; &#1583;&#1608;&#1606;&#1601;&#1585;&#1607; &#1576;&#1575; &#1575;&#1578;&#1575;&#1602; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606;</div></div>
      </article>

      <article class="game-card soon" style="--accent:#22c55e;--glow:rgba(34,197,94,.18)" data-game="&#1605;&#1606;&#1670;">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-mench"><span></span><span></span><span></span><span></span></div></div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1605;&#1606;&#1670;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1583;&#1608;&#1585;&#1607;&#1605;&#1740;&#1548; &#1587;&#1575;&#1583;&#1607; &#1608; &#1587;&#1585;&#1711;&#1585;&#1605;&#8204;&#1705;&#1606;&#1606;&#1583;&#1607;</div></div>
      </article>

      <article class="game-card soon" style="--accent:#fb923c;--glow:rgba(251,146,60,.18)" data-game="&#1578;&#1582;&#1578;&#1607; &#1606;&#1585;&#1583;">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-backgammon"></div></div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1578;&#1582;&#1578;&#1607; &#1606;&#1585;&#1583;</div><div class="game-desc">&#1705;&#1604;&#1575;&#1587;&#1740;&#1705;&#1548; &#1587;&#1585;&#1740;&#1593;&#1548; &#1585;&#1602;&#1575;&#1576;&#1578;&#1740; &#1608; &#1605;&#1606;&#1575;&#1587;&#1576; &#1605;&#1608;&#1576;&#1575;&#1740;&#1604;</div></div>
      </article>

      <article class="game-card soon" style="--accent:#ef4444;--glow:rgba(239,68,68,.18)" data-game="&#1581;&#1705;&#1605;">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-hokm"></div></div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1581;&#1705;&#1605;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1578;&#1740;&#1605;&#1740; &#1608; &#1605;&#1581;&#1576;&#1608;&#1576; &#1575;&#1740;&#1585;&#1575;&#1606;&#1740;</div></div>
      </article>

      <article class="game-card soon" style="--accent:#60a5fa;--glow:rgba(96,165,250,.18)" data-game="&#1670;&#1607;&#1575;&#1585; &#1576;&#1585;&#1711;">
        <div class="game-top"><div class="logo-wrap"><div class="game-logo logo-4barg"></div></div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1670;&#1607;&#1575;&#1585; &#1576;&#1585;&#1711;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1587;&#1585;&#1740;&#1593;&#1548; &#1587;&#1575;&#1583;&#1607; &#1608; &#1607;&#1740;&#1580;&#1575;&#1606;&#1740;</div></div>
      </article>
    </section>

    <nav class="bottom-nav">
      <button class="nav-item active" type="button">&#1582;&#1575;&#1606;&#1607;</button>
      <button class="nav-item" type="button">&#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;</button>
      <button class="nav-item" type="button">&#1662;&#1585;&#1608;&#1601;&#1575;&#1740;&#1604;</button>
    </nav>
  </main>
  <div id="toast" class="toast">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740; &#1601;&#1593;&#1575;&#1604; &#1605;&#1740;&#8204;&#1588;&#1608;&#1583;</div>
  <script>
    var toast = document.getElementById('toast');
    var timer = null;
    var currentUser = null;
    var accountWidget = document.getElementById('accountWidget');
    var accountToggle = document.getElementById('accountToggle');
    var accountName = document.getElementById('accountName');
    var accountAvatar = document.getElementById('accountAvatar');
    var coinAmount = document.getElementById('coinAmount');
    var miniCoin = document.getElementById('miniCoin');
    var loginMini = document.getElementById('loginMini');
    var loggedActions = document.getElementById('loggedActions');

    function showToast(message) {
      toast.textContent = message;
      toast.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(function(){ toast.classList.remove('show'); }, 2400);
    }

    accountToggle.onclick = function() {
      accountWidget.classList.toggle('open');
    };
    document.addEventListener('click', function(event) {
      if (!accountWidget.contains(event.target)) {
        accountWidget.classList.remove('open');
      }
    });
    async function api(path, body) {
      var response = await fetch(path, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined
      });
      var data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Request failed');
      return data;
    }
    function updateAccount() {
      if (currentUser) {
        accountName.textContent = currentUser.username;
        accountAvatar.textContent = currentUser.username ? currentUser.username.charAt(0).toUpperCase() : 'U';
        coinAmount.textContent = Number(currentUser.chips || 0).toLocaleString('en-US');
        miniCoin.textContent = Number(currentUser.chips || 0).toLocaleString('en-US');
        loginMini.style.display = 'none';
        loggedActions.style.display = 'flex';
      } else {
        accountName.innerHTML = '&#1705;&#1575;&#1585;&#1576;&#1585; &#1605;&#1607;&#1605;&#1575;&#1606;';
        accountAvatar.textContent = '?';
        coinAmount.textContent = '--';
        miniCoin.textContent = '--';
        loginMini.style.display = 'grid';
        loggedActions.style.display = 'none';
      }
    }
    async function loadMe() {
      try {
        var data = await api('/api/me');
        currentUser = data.user;
        updateAccount();
      } catch (e) { updateAccount(); }
    }
    document.getElementById('homeLogin').onclick = async function() {
      try {
        var data = await api('/api/login', {
          username: document.getElementById('homeUsername').value,
          password: document.getElementById('homePassword').value
        });
        currentUser = data.user;
        updateAccount();
        showToast('&#1608;&#1585;&#1608;&#1583; &#1605;&#1608;&#1601;&#1602; &#1576;&#1608;&#1583;');
      } catch (e) { showToast(e.message); }
    };
    document.getElementById('homeRegister').onclick = async function() {
      try {
        var data = await api('/api/register', {
          username: document.getElementById('homeUsername').value,
          password: document.getElementById('homePassword').value
        });
        currentUser = data.user;
        updateAccount();
        showToast('&#1579;&#1576;&#1578;&#8204;&#1606;&#1575;&#1605; &#1575;&#1606;&#1580;&#1575;&#1605; &#1588;&#1583;');
      } catch (e) { showToast(e.message); }
    };
    document.getElementById('homeLogout').onclick = async function() {
      try { await api('/api/logout', {}); } catch (e) {}
      currentUser = null;
      updateAccount();
      showToast('&#1582;&#1585;&#1608;&#1580; &#1575;&#1606;&#1580;&#1575;&#1605; &#1588;&#1583;');
    };
    document.getElementById('homeBonus').onclick = async function() {
      try {
        var data = await api('/api/daily-bonus', {});
        showToast(data.message || 'Daily bonus claimed');
        await loadMe();
      } catch (e) { showToast(e.message); }
    };
    document.querySelectorAll('.game-card.soon').forEach(function(card) {
      card.addEventListener('click', function() {
        var name = card.getAttribute('data-game') || 'Game';
        showToast(name + ' - ' + 'Ø¨ÙâØ²ÙØ¯Û ÙØ¹Ø§Ù ÙÛâØ´ÙØ¯');
      });
    });
    loadMe();
  </script>
</body>
</html>`);
});

app.get("/poker", (req, res) => res.redirect("/games/poker"));

app.get("/games/chess", (req, res) => res.redirect("/"));
app.get("/games/mench", (req, res) => res.redirect("/"));
app.get("/games/backgammon", (req, res) => res.redirect("/"));
app.get("/games/hokm", (req, res) => res.redirect("/"));
app.get("/games/chahar-barg", (req, res) => res.redirect("/"));

app.get("/games/poker", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Poker Royale</title>
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent} body{margin:0;min-height:100vh;font-family:Arial,sans-serif;background:radial-gradient(circle at top,#115c39 0%,#07150d 45%,#020403 100%);color:white;overflow-x:hidden;padding-bottom:calc(124px + env(safe-area-inset-bottom))} body.rtl{direction:rtl;font-family:Arial,Tahoma,sans-serif}.app{width:100%;max-width:1180px;margin:0 auto;padding:14px}.top-row{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px}.logo{color:#facc15;font-size:28px;font-weight:900;text-shadow:0 0 20px rgba(250,204,21,.65)}.lang-btn,.small-btn,.btn{border:none;cursor:pointer;font-weight:900}.lang-btn{border:1px solid rgba(250,204,21,.45);background:rgba(0,0,0,.45);color:#facc15;border-radius:999px;padding:9px 13px}.auth-panel,.panel,.log{background:rgba(0,0,0,.48);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:14px;box-shadow:0 18px 55px rgba(0,0,0,.25)}.auth-panel{margin-bottom:12px}.auth-grid{display:grid;grid-template-columns:1fr 1fr auto auto;gap:8px;align-items:center}.input{width:100%;border:1px solid rgba(250,204,21,.35);background:rgba(0,0,0,.45);color:white;border-radius:12px;padding:12px;outline:none;font-size:15px}.small-btn{border-radius:12px;padding:12px;color:white;background:#166534}.register-btn{background:#ca8a04;color:#111827}.logout-btn{background:#991b1b}.bonus-btn{background:#2563eb}.reload-btn{background:#7c3aed}.user-card{display:none;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}.user-info strong{color:#facc15}.stats-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-top:10px}.stat-box{background:rgba(255,255,255,.06);border:1px solid rgba(250,204,21,.18);border-radius:12px;padding:8px;font-size:12px;color:#d1d5db}.stat-box strong{color:#facc15}.top-status{margin:12px auto;display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.status-pill{background:rgba(0,0,0,.42);border:1px solid rgba(250,204,21,.28);border-radius:12px;padding:9px 8px;font-size:12px;color:#d1d5db}.status-pill strong{color:#facc15}.main-layout{display:grid;grid-template-columns:285px 1fr;gap:14px;align-items:start}.panel h2{margin:0 0 10px;color:#facc15;font-size:17px}.room-card{border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(255,255,255,.08),rgba(255,255,255,.035));border-radius:16px;padding:12px;margin-bottom:10px;cursor:pointer}.room-card.active{border-color:#facc15;background:rgba(250,204,21,.12)}.room-title{display:flex;justify-content:space-between;gap:8px;align-items:center;font-weight:900;margin-bottom:6px}.room-badge{font-size:10px;border-radius:999px;padding:3px 7px;background:#166534;color:#bbf7d0}.room-badge.playing{background:#7c2d12;color:#fed7aa}.room-meta{color:#d1d5db;font-size:12px;line-height:1.55}.join-pill{margin-top:8px;background:#facc15;color:#111827;text-align:center;border-radius:999px;padding:7px;font-weight:900;font-size:12px}.leaderboard-list,.history-list{display:grid;gap:8px;font-size:12px;color:#d1d5db}.list-item{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:8px;line-height:1.45}.poker-table{position:relative;min-height:565px;border-radius:48%;background:radial-gradient(circle at center,#15803d 0%,#166534 45%,#052e16 100%);border:12px solid #7c2d12;box-shadow:inset 0 0 48px rgba(0,0,0,.56),0 25px 70px rgba(0,0,0,.55);overflow:hidden}.table-line{position:absolute;inset:32px;border-radius:48%;border:2px dashed rgba(250,204,21,.32);pointer-events:none}.dealer{position:absolute;top:38px;left:50%;transform:translateX(-50%);background:#facc15;color:#111827;padding:7px 14px;border-radius:999px;font-weight:900;font-size:13px;z-index:7}.community{position:absolute;top:178px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:8}.card{width:52px;height:74px;background:#fff;color:#111827;border-radius:9px;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:20px;box-shadow:0 12px 22px rgba(0,0,0,.38)}.card.red{color:#dc2626}.card.back{background:linear-gradient(135deg,#991b1b,#450a0a);color:#facc15;border:2px solid rgba(250,204,21,.8)}.pot{position:absolute;top:276px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,.58);border:1px solid rgba(250,204,21,.55);border-radius:18px;padding:10px 18px;color:#facc15;font-weight:900;z-index:8}.turn-status{position:absolute;top:334px;left:50%;transform:translateX(-50%);background:rgba(2,6,23,.72);border:1px solid rgba(34,197,94,.5);border-radius:14px;padding:10px 14px;min-width:240px;color:#bbf7d0;text-align:center;font-size:13px;z-index:8}.my-cards{position:absolute;bottom:105px;left:50%;transform:translateX(-50%);display:flex;gap:8px;z-index:12}.player{position:absolute;width:118px;text-align:center;z-index:10}.avatar{width:58px;height:58px;margin:0 auto 5px;border-radius:50%;background:radial-gradient(circle at top,#facc15,#a16207);border:3px solid #fff7ed;color:#111827;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:21px}.player.turn .avatar{box-shadow:0 0 0 4px rgba(34,197,94,.55),0 0 24px rgba(34,197,94,.65)}.player.folded{opacity:.45}.player-name{background:rgba(0,0,0,.7);border-radius:999px;padding:5px 8px;font-size:12px;font-weight:900;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.role-badge{display:inline-block;margin-top:3px;background:#facc15;color:#111827;border-radius:999px;padding:3px 7px;font-size:10px;font-weight:900}.danger-badge{background:#ef4444;color:white}.chips{margin-top:4px;color:#facc15;font-size:12px}.bet{margin-top:2px;color:#93c5fd;font-size:11px}.seat-0{left:50%;bottom:24px;transform:translateX(-50%)}.seat-1{left:48px;bottom:115px}.seat-2{left:48px;top:100px}.seat-3{right:48px;top:100px}.seat-4{right:48px;bottom:115px}.seat-5{left:50%;top:72px;transform:translateX(-50%)}.actions{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));z-index:2000;display:flex;justify-content:center;gap:8px;flex-wrap:wrap;width:min(96%,620px);background:rgba(0,0,0,.55);border:1px solid rgba(250,204,21,.25);border-radius:22px;padding:10px;backdrop-filter:blur(10px)}.btn{border-radius:999px;padding:12px 14px;min-width:78px;color:white;font-size:13px}.btn:disabled{opacity:.42;cursor:not-allowed}.fold{background:#991b1b}.call{background:#166534}.raise{background:#ca8a04;color:#111827}.allin{background:#7c3aed}.start{background:#2563eb}.log{margin-top:14px;font-size:13px;color:#d1d5db;max-height:170px;overflow-y:auto;line-height:1.55}.log-item{border-bottom:1px solid rgba(255,255,255,.08);padding:5px 0}.toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(2,6,23,.92);border:1px solid rgba(250,204,21,.35);color:#fff;border-radius:999px;padding:11px 16px;font-weight:900;font-size:13px;box-shadow:0 18px 55px rgba(0,0,0,.4);display:none}.toast.show{display:block}.chat-panel{margin-top:14px;background:rgba(0,0,0,.46);border:1px solid rgba(250,204,21,.18);border-radius:18px;padding:12px}.chat-title{display:flex;justify-content:space-between;align-items:center;color:#facc15;font-weight:900;margin-bottom:8px}.chat-messages{height:160px;overflow-y:auto;background:rgba(2,6,23,.35);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:9px;display:flex;flex-direction:column;gap:7px}.chat-line{font-size:12px;line-height:1.45;color:#e5e7eb;word-break:break-word}.chat-line strong{color:#facc15}.chat-time{color:#9ca3af;font-size:10px;margin-inline-start:4px}.chat-system{color:#bbf7d0;font-style:italic}.chat-form{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:8px}.chat-input{border:1px solid rgba(250,204,21,.35);background:rgba(0,0,0,.45);color:white;border-radius:999px;padding:11px 13px;outline:none}.chat-send{border:none;border-radius:999px;background:#facc15;color:#111827;font-weight:900;padding:0 16px;cursor:pointer}@media(max-width:850px){.auth-grid{grid-template-columns:1fr}.stats-grid{grid-template-columns:1fr 1fr}.main-layout{grid-template-columns:1fr}.top-status{grid-template-columns:1fr}.logo{font-size:24px}.poker-table{min-height:520px;border-width:8px}.community{top:174px;gap:6px}.card{width:43px;height:62px;font-size:17px}.pot{top:256px}.turn-status{top:310px;min-width:215px}.my-cards{bottom:98px}.player{width:100px}.avatar{width:50px;height:50px}.seat-0{left:50%;bottom:22px;transform:translateX(-50%)}.seat-1{left:10px;bottom:112px}.seat-2{left:10px;top:108px}.seat-3{right:10px;top:108px}.seat-4{right:10px;bottom:112px}.seat-5{left:50%;top:66px;transform:translateX(-50%)}.btn{min-width:68px;padding:10px 10px;font-size:12px}}
  

/* ================================
   POKER CLEAN WINDOW PATCH
   Hide account, stats, chat, online table panels from /games/poker
   ================================ */
body.poker-clean-mode .auth-panel,
body.poker-clean-mode .top-status,
body.poker-clean-mode .main-layout > aside.panel,
body.poker-clean-mode .chat-panel,
body.poker-clean-mode .log {
  display: none !important;
}

body.poker-clean-mode .app {
  max-width: 980px !important;
}

body.poker-clean-mode .main-layout {
  display: block !important;
}

body.poker-clean-mode main {
  width: 100% !important;
}

body.poker-clean-mode .top-row {
  margin-bottom: 14px !important;
}

body.poker-clean-mode .poker-table {
  margin-top: 8px !important;
  min-height: 600px !important;
}

body.poker-clean-mode .turn-status {
  top: 330px !important;
}

body.poker-clean-mode .actions {
  box-shadow: 0 -18px 55px rgba(0,0,0,.50) !important;
}

body.poker-clean-mode::after {
  content: "POKER TABLE";
  position: fixed;
  top: calc(8px + env(safe-area-inset-top));
  left: 50%;
  transform: translateX(-50%);
  z-index: 9998;
  padding: 6px 14px;
  border-radius: 999px;
  background: linear-gradient(135deg, rgba(250,204,21,.96), rgba(202,138,4,.94));
  color: #111827;
  font-size: 10px;
  font-weight: 900;
  letter-spacing: 1.4px;
  box-shadow: 0 8px 24px rgba(250,204,21,.28);
  pointer-events: none;
}

@media(max-width:850px){
  body.poker-clean-mode .poker-table{
    min-height: 560px !important;
  }
}

  </style>
</head>
<body class="poker-clean-mode">
  <div id="toast" class="toast"></div>
  <div class="app">
    <div class="top-row"><div class="logo">\u2660 Poker Royale \u2663</div><button class="lang-btn" id="langBtn">FA</button></div>
    <div class="auth-panel">
      <div id="authForm" class="auth-grid"><input id="authUsername" class="input" placeholder="Username" /><input id="authPassword" class="input" type="password" placeholder="Password" /><button class="small-btn" id="loginBtn">Login</button><button class="small-btn register-btn" id="registerBtn">Register</button></div>
      <div id="userCard" class="user-card"><div class="user-info"><div>Welcome, <strong id="panelUsername">Player</strong></div><div>Chips: <strong id="panelChips">0</strong></div></div><button class="small-btn bonus-btn" id="bonusBtn">Daily Bonus</button><button class="small-btn reload-btn" id="reloadBtn">Reload</button><button class="small-btn logout-btn" id="logoutBtn">Logout</button></div>
      <div id="statsPanel" class="stats-grid" style="display:none;"><div class="stat-box">Wins<br><strong id="panelWins">0</strong></div><div class="stat-box">Losses<br><strong id="panelLosses">0</strong></div><div class="stat-box">Hands<br><strong id="panelHands">0</strong></div><div class="stat-box">Biggest Pot<br><strong id="panelBiggestPot">0</strong></div><div class="stat-box">Best Hand<br><strong id="panelBestHand">None</strong></div></div>
    </div>
    <div class="top-status"><div class="status-pill">Connection: <strong id="connectionStatus">Connecting...</strong></div><div class="status-pill">Online: <strong id="onlineCount">0</strong></div><div class="status-pill">Phase: <strong id="phaseStatus">waiting</strong></div></div>
    <div class="main-layout"><aside class="panel"><h2>Lobby Rooms</h2><div id="rooms"></div><h2 style="margin-top:16px;">Leaderboard</h2><div id="leaderboardList" class="leaderboard-list"></div><h2 style="margin-top:16px;">Game History</h2><div id="historyList" class="history-list"></div></aside><main><div class="poker-table"><div class="table-line"></div><div class="dealer">DEALER</div><div class="community" id="communityCards"><div class="card back">\u2660</div><div class="card back">\u2665</div><div class="card back">\u2666</div><div class="card back">\u2663</div><div class="card back">\u2605</div></div><div class="pot" id="potDisplay">POT: 0</div><div class="turn-status" id="turnStatus">Login first, then choose a room</div><div class="my-cards" id="myCards"></div><div id="players"></div></div><div class="log" id="gameLog"><div class="log-item">Welcome to Poker Royale.</div></div><div class="chat-panel"><div class="chat-title"><span id="chatTitle">Room Chat</span><span id="chatRoomName">-</span></div><div class="chat-messages" id="chatMessages"><div class="chat-line chat-system">Join a room to chat.</div></div><div class="chat-form"><input class="chat-input" id="chatInput" maxlength="150" placeholder="Write a message..." /><button class="chat-send" id="chatSendBtn">Send</button></div></div></main></div>
  </div>
  <div class="actions"><button class="btn start" id="startBtn" disabled>Start</button><button class="btn fold" id="foldBtn" disabled>Fold</button><button class="btn call" id="callBtn" disabled>Call / Check</button><button class="btn raise" id="raiseBtn" disabled>Raise</button><button class="btn allin" id="allInBtn" disabled>All-in</button></div>
  <script src="/socket.io/socket.io.js"></script>
  <script>
    const socket = io(); let currentUser=null,currentRoomId=null,joined=false,latestRoom=null,currentLang=localStorage.getItem("pokerLang")||"en";
    const text={en:{langButton:"FA",loginFirst:"Login first, then choose a room",username:"Username",password:"Password",login:"Login",register:"Register",logout:"Logout",needLogin:"Please login or register first.",joined:"You joined",raiseAmount:"Raise to amount:",you:"You",bet:"Bet",committed:"Committed",pot:"POT",callCheck:"Call / Check",start:"Start",fold:"Fold",raise:"Raise",allIn:"All-in",dailyBonus:"Daily Bonus",reload:"Reload",chatTitle:"Room Chat",chatPlaceholder:"Write a message...",chatSend:"Send"},fa:{langButton:"EN",loginFirst:"\u0627\u0648\u0644 \u0648\u0627\u0631\u062F \u062D\u0633\u0627\u0628 \u0634\u0648\u060C \u0628\u0639\u062F \u0627\u062A\u0627\u0642 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646",username:"\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC",password:"\u0631\u0645\u0632 \u0639\u0628\u0648\u0631",login:"\u0648\u0631\u0648\u062F",register:"\u062B\u0628\u062A\u200C\u0646\u0627\u0645",logout:"\u062E\u0631\u0648\u062C",needLogin:"\u0627\u0648\u0644 \u0648\u0627\u0631\u062F \u062D\u0633\u0627\u0628 \u0634\u0648 \u06CC\u0627 \u062B\u0628\u062A\u200C\u0646\u0627\u0645 \u06A9\u0646.",joined:"\u0648\u0627\u0631\u062F \u0634\u062F\u06CC \u0628\u0647",raiseAmount:"\u0627\u0641\u0632\u0627\u06CC\u0634 \u062A\u0627 \u0645\u0628\u0644\u063A:",you:"\u0634\u0645\u0627",bet:"\u0634\u0631\u0637",committed:"\u06A9\u0644 \u0634\u0631\u0637",pot:"\u067E\u0627\u062A",callCheck:"\u06A9\u0627\u0644 / \u0686\u06A9",start:"\u0634\u0631\u0648\u0639",fold:"\u0627\u0646\u0635\u0631\u0627\u0641",raise:"\u0627\u0641\u0632\u0627\u06CC\u0634",allIn:"\u0622\u0644 \u0627\u06CC\u0646",dailyBonus:"\u062C\u0627\u06CC\u0632\u0647 \u0631\u0648\u0632\u0627\u0646\u0647",reload:"\u0634\u0627\u0631\u0698 \u0686\u06CC\u067E",chatTitle:"\u0686\u062A \u0627\u062A\u0627\u0642",chatPlaceholder:"\u067E\u06CC\u0627\u0645 \u0628\u0646\u0648\u06CC\u0633...",chatSend:"\u0627\u0631\u0633\u0627\u0644"}};
    const $=id=>document.getElementById(id),toast=$("toast"),langBtn=$("langBtn"),authForm=$("authForm"),userCard=$("userCard"),authUsername=$("authUsername"),authPassword=$("authPassword"),loginBtn=$("loginBtn"),registerBtn=$("registerBtn"),logoutBtn=$("logoutBtn"),bonusBtn=$("bonusBtn"),reloadBtn=$("reloadBtn"),panelUsername=$("panelUsername"),panelChips=$("panelChips"),statsPanel=$("statsPanel"),panelWins=$("panelWins"),panelLosses=$("panelLosses"),panelHands=$("panelHands"),panelBiggestPot=$("panelBiggestPot"),panelBestHand=$("panelBestHand"),leaderboardList=$("leaderboardList"),historyList=$("historyList"),connectionStatus=$("connectionStatus"),onlineCount=$("onlineCount"),phaseStatus=$("phaseStatus"),roomsEl=$("rooms"),playersEl=$("players"),communityCardsEl=$("communityCards"),myCardsEl=$("myCards"),potDisplay=$("potDisplay"),turnStatus=$("turnStatus"),gameLog=$("gameLog"),startBtn=$("startBtn"),foldBtn=$("foldBtn"),callBtn=$("callBtn"),raiseBtn=$("raiseBtn"),allInBtn=$("allInBtn"),chatTitle=$("chatTitle"),chatRoomName=$("chatRoomName"),chatMessages=$("chatMessages"),chatInput=$("chatInput"),chatSendBtn=$("chatSendBtn");
    function tr(){return text[currentLang]} function showToast(m){toast.textContent=m;toast.classList.add("show");setTimeout(()=>toast.classList.remove("show"),2800)}
    function applyLanguage(){document.documentElement.lang=currentLang;document.documentElement.dir=currentLang==="fa"?"rtl":"ltr";document.body.classList.toggle("rtl",currentLang==="fa");langBtn.textContent=tr().langButton;authUsername.placeholder=tr().username;authPassword.placeholder=tr().password;loginBtn.textContent=tr().login;registerBtn.textContent=tr().register;logoutBtn.textContent=tr().logout;bonusBtn.textContent=tr().dailyBonus;reloadBtn.textContent=tr().reload;startBtn.textContent=tr().start;foldBtn.textContent=tr().fold;callBtn.textContent=tr().callCheck;raiseBtn.textContent=tr().raise;allInBtn.textContent=tr().allIn;chatTitle.textContent=tr().chatTitle;chatInput.placeholder=tr().chatPlaceholder;chatSendBtn.textContent=tr().chatSend;if(!joined)turnStatus.textContent=tr().loginFirst;if(latestRoom){updateTableText(latestRoom);renderPlayers(latestRoom.players)}}
    langBtn.onclick=()=>{currentLang=currentLang==="en"?"fa":"en";localStorage.setItem("pokerLang",currentLang);applyLanguage()};
    function addLog(message){const item=document.createElement("div");item.className="log-item";item.textContent=message;gameLog.prepend(item)}
    function formatChatTime(value){try{return new Date(value).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"})}catch(e){return ""}}
    function renderChatMessages(messages){chatMessages.innerHTML="";(messages||[]).forEach(appendChatMessage);if(!messages||messages.length===0){const item=document.createElement("div");item.className="chat-line chat-system";item.textContent=currentRoomId?"No messages yet.":"Join a room to chat.";chatMessages.appendChild(item)}}
    function appendChatMessage(message){const item=document.createElement("div");item.className="chat-line"+(message.system?" chat-system":"");if(message.system){item.textContent=message.text}else{const safeName=message.name||"Player";item.innerHTML="<strong></strong>: <span></span> <em class=\"chat-time\"></em>";item.querySelector("strong").textContent=safeName;item.querySelector("span").textContent=message.text||"";item.querySelector("em").textContent=formatChatTime(message.createdAt)}chatMessages.appendChild(item);chatMessages.scrollTop=chatMessages.scrollHeight}
    async function api(path,body){const response=await fetch(path,{method:body?"POST":"GET",headers:body?{"Content-Type":"application/json"}:{},body:body?JSON.stringify(body):undefined});const data=await response.json();if(!response.ok)throw new Error(data.error||"Request failed.");return data}
    async function loadMe(){const data=await api("/api/me");currentUser=data.user;updateUserPanel()}
    function updateUserPanel(){if(currentUser){authForm.style.display="none";userCard.style.display="flex";statsPanel.style.display="grid";panelUsername.textContent=currentUser.username;panelChips.textContent=currentUser.chips;panelWins.textContent=currentUser.wins||0;panelLosses.textContent=currentUser.losses||0;panelHands.textContent=currentUser.hands_played||0;panelBiggestPot.textContent=currentUser.biggest_pot||0;panelBestHand.textContent=currentUser.best_hand||"None"}else{authForm.style.display="grid";userCard.style.display="none";statsPanel.style.display="none"}}
    async function loadLeaderboard(){try{const data=await api("/api/leaderboard");leaderboardList.innerHTML="";data.leaderboard.forEach((user,index)=>{const item=document.createElement("div");item.className="list-item";item.innerHTML="#"+(index+1)+" <strong>"+user.username+"</strong><br>Chips: "+user.chips+" | Wins: "+user.wins+" | Hands: "+user.hands_played;leaderboardList.appendChild(item)})}catch(e){}}
    async function loadHistory(){try{const data=await api("/api/history");historyList.innerHTML="";data.history.forEach(hand=>{const item=document.createElement("div");item.className="list-item";item.innerHTML="<strong>"+hand.room_name+"</strong><br>Pot: "+hand.pot+" | Winners: "+hand.winners+"<br>Hand: "+hand.winning_hand;historyList.appendChild(item)})}catch(e){}}
    async function refreshDashboard(){await loadLeaderboard();await loadHistory()}
    loginBtn.onclick=async()=>{try{const data=await api("/api/login",{username:authUsername.value,password:authPassword.value});currentUser=data.user;updateUserPanel();addLog("Logged in as "+currentUser.username);showToast("Logged in");refreshDashboard().catch(()=>{})}catch(e){showToast(e.message)}};
    registerBtn.onclick=async()=>{try{const data=await api("/api/register",{username:authUsername.value,password:authPassword.value});currentUser=data.user;updateUserPanel();addLog("Registered as "+currentUser.username);showToast("Registered");refreshDashboard().catch(()=>{})}catch(e){showToast(e.message)}};
    logoutBtn.onclick=async()=>{await api("/api/logout",{});currentUser=null;joined=false;currentRoomId=null;latestRoom=null;updateUserPanel();updateButtons(null);playersEl.innerHTML="";myCardsEl.innerHTML="";turnStatus.textContent=tr().loginFirst;chatRoomName.textContent="-";renderChatMessages([]);addLog("Logged out.");showToast("Logged out")};
    bonusBtn.onclick=async()=>{try{const data=await api("/api/daily-bonus",{});addLog(data.message);showToast(data.message);await loadMe();await refreshDashboard()}catch(e){showToast(e.message)}};
    reloadBtn.onclick=async()=>{try{const data=await api("/api/reload-chips",{});addLog(data.message);showToast(data.message);await loadMe();await refreshDashboard()}catch(e){showToast(e.message)}};
    function cardIsRed(card){return card.includes("\u2665")||card.includes("\u2666")} function renderCard(card){if(!card)return '<div class="card back">\u2605</div>';return '<div class="card'+(cardIsRed(card)?" red":"")+'">'+card+'</div>'}
    function renderRooms(rooms){roomsEl.innerHTML="";rooms.forEach(room=>{const card=document.createElement("div");card.className="room-card"+(room.id===currentRoomId?" active":"");card.innerHTML='<div class="room-title"><span>'+room.name+'</span><span class="room-badge '+(room.isPlaying?'playing':'')+'">'+(room.isPlaying?'PLAYING':'WAITING')+'</span></div><div class="room-meta">'+room.description+'<br>Players: '+room.playerCount+'/6 | Online: '+room.connectedCount+'<br>Blinds: '+room.smallBlindAmount+'/'+room.bigBlindAmount+'<br>Pot: '+room.pot+' | Phase: '+room.phase+'<br>Status: '+room.status+'</div><div class="join-pill">Join Table</div>';card.onclick=()=>{if(!currentUser){showToast(tr().needLogin);return}currentRoomId=room.id;socket.emit("joinRoom",{roomId:room.id})};roomsEl.appendChild(card)})}
    function renderPlayers(players){playersEl.innerHTML="";players.forEach((player,index)=>{const el=document.createElement("div");let className="player seat-"+index;if(player.isTurn)className+=" turn";if(player.folded)className+=" folded";el.className=className;const initial=player.name?player.name.charAt(0).toUpperCase():"?";const youLabel=currentUser&&player.userId===currentUser.id?" ("+tr().you+")":"";const roleHtml=player.role?'<div class="role-badge">'+player.role+'</div>':"";const allInHtml=player.allIn?'<div class="role-badge">ALL-IN</div>':"";const waitHtml=player.waitingNextHand?'<div class="role-badge">WAITING</div>':"";const disconnectHtml=player.disconnected?'<div class="role-badge danger-badge">OFFLINE</div>':"";el.innerHTML='<div class="avatar">'+initial+'</div><div class="player-name">'+player.name+youLabel+'</div>'+roleHtml+allInHtml+waitHtml+disconnectHtml+'<div class="chips">\uD83D\uDFE1 '+player.chips+'</div><div class="bet">'+tr().bet+': '+player.bet+'</div><div class="bet">'+tr().committed+': '+player.committedThisHand+'</div>';playersEl.appendChild(el)})}
    function renderCommunity(cards){let html="";for(let i=0;i<5;i++)html+=renderCard(cards[i]);communityCardsEl.innerHTML=html}
    function renderMyCards(cards){if(!cards||cards.length===0){myCardsEl.innerHTML="";return}myCardsEl.innerHTML=renderCard(cards[0])+renderCard(cards[1])}
    function updateTableText(room){potDisplay.textContent=tr().pot+": "+room.pot;turnStatus.textContent=room.status;phaseStatus.textContent=room.phase}
    function updateButtons(room){startBtn.disabled=!joined;if(!room||!joined||!currentUser){foldBtn.disabled=callBtn.disabled=raiseBtn.disabled=allInBtn.disabled=true;return}const me=room.players.find(player=>player.userId===currentUser.id);const isMyTurn=me&&me.isTurn&&!me.folded&&!me.allIn&&!me.disconnected&&!me.waitingNextHand&&room.phase!=="waiting"&&room.phase!=="showdown";foldBtn.disabled=callBtn.disabled=raiseBtn.disabled=allInBtn.disabled=!isMyTurn}
    socket.on("connect",()=>{connectionStatus.textContent="Connected";connectionStatus.style.color="#22c55e";addLog("Connected.")}); socket.on("disconnect",()=>{connectionStatus.textContent="Disconnected";connectionStatus.style.color="#ef4444";updateButtons(null)}); socket.on("onlineCount",count=>onlineCount.textContent=count); socket.on("roomsUpdate",rooms=>renderRooms(rooms));
    socket.on("roomJoined",room=>{joined=true;latestRoom=room;currentRoomId=room.id;updateTableText(room);renderPlayers(room.players);renderCommunity(room.communityCards);updateButtons(room);addLog(tr().joined+" "+room.name);chatRoomName.textContent=room.name;renderChatMessages(room.chatMessages||[]);showToast(tr().joined+" "+room.name)});
    socket.on("roomState",room=>{if(!currentRoomId||room.id!==currentRoomId)return;latestRoom=room;updateTableText(room);renderPlayers(room.players);renderCommunity(room.communityCards);renderChatMessages(room.chatMessages||[]);updateButtons(room)}); socket.on("privateCards",cards=>renderMyCards(cards)); socket.on("gameMessage",async message=>{addLog(message);showToast(message);try{await loadMe();await refreshDashboard()}catch(e){}}); socket.on("chatMessage",message=>{appendChatMessage(message)});
    function sendChat(){if(!joined||!currentRoomId){showToast("Join a room first.");return}const message=chatInput.value.trim();if(!message)return;socket.emit("roomChatMessage",{roomId:currentRoomId,message});chatInput.value=""} chatSendBtn.onclick=sendChat; chatInput.addEventListener("keydown",e=>{if(e.key==="Enter")sendChat()});
    startBtn.onclick=()=>{if(!joined||!currentRoomId)return;socket.emit("startHand",{roomId:currentRoomId})}; foldBtn.onclick=()=>{if(!joined||!currentRoomId)return;socket.emit("playerAction",{roomId:currentRoomId,action:"Fold"})}; callBtn.onclick=()=>{if(!joined||!currentRoomId)return;socket.emit("playerAction",{roomId:currentRoomId,action:"Call"})}; raiseBtn.onclick=()=>{if(!joined||!currentRoomId)return;const amount=prompt(tr().raiseAmount,"50");if(!amount)return;socket.emit("playerAction",{roomId:currentRoomId,action:"Raise",amount:Number(amount)})}; allInBtn.onclick=()=>{if(!joined||!currentRoomId)return;socket.emit("playerAction",{roomId:currentRoomId,action:"AllIn"})};
    applyLanguage();loadMe().catch(()=>{});refreshDashboard().catch(()=>{});
  </script>
</body></html>`);
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);
  io.emit("onlineCount", io.engine.clientsCount);
  socket.emit("roomsUpdate", getPublicRooms());

  socket.on("joinRoom", async ({ roomId }) => {
    try {
      const session = socket.request.session;
      if (!session || !session.userId) { socket.emit("gameMessage", "Please login first."); return; }
      const user = await getUserById(session.userId);
      if (!user) { socket.emit("gameMessage", "User not found. Please login again."); return; }
      const existingByUser = findPlayerLocationByUserId(user.id);
      if (existingByUser) {
        const { room, player } = existingByUser;
        if (disconnectTimers.has(user.id)) { clearTimeout(disconnectTimers.get(user.id)); disconnectTimers.delete(user.id); }
        player.socketId = socket.id; player.disconnected = false;
        player.status = player.waitingNextHand ? "Waiting next hand" : room.handStarted ? (player.folded ? "Folded" : "Reconnected") : "Waiting";
        socket.join(room.id); socket.emit("roomJoined", getPublicRoomState(room)); io.to(room.id).emit("gameMessage", user.username + " reconnected to " + room.name + "."); emitRoom(room); return;
      }
      const room = rooms[roomId];
      if (!room) { socket.emit("gameMessage", "Room not found."); return; }
      if (room.players.length >= 6) { socket.emit("gameMessage", "This room is full."); return; }
      if (user.chips <= 0) { socket.emit("gameMessage", "You do not have enough chips to sit."); return; }
      const joiningDuringHand = room.handStarted && room.phase !== "waiting" && room.phase !== "showdown";
      const player = { socketId: socket.id, userId: user.id, name: user.username, chips: user.chips, seat: room.players.length, cards: [], bet: 0, committedThisHand: 0, role: "", folded: joiningDuringHand, allIn: false, disconnected: false, waitingNextHand: joiningDuringHand, isTurn: false, hasActed: false, status: joiningDuringHand ? "Waiting next hand" : "Waiting" };
      room.players.push(player); room.status = joiningDuringHand ? user.username + " joined and waits for next hand" : user.username + " joined the table";
      socket.join(room.id); socket.emit("roomJoined", getPublicRoomState(room)); io.to(room.id).emit("gameMessage", room.status); emitRoom(room);
    } catch (error) { console.error("Join room error:", error); socket.emit("gameMessage", "Failed to join room."); }
  });

  socket.on("roomChatMessage", async ({ roomId, message }) => {
    try {
      const session = socket.request.session;
      if (!session || !session.userId) { socket.emit("gameMessage", "Please login first."); return; }
      const room = rooms[roomId];
      if (!room) { socket.emit("gameMessage", "Room not found."); return; }
      const player = room.players.find((p) => p.socketId === socket.id && p.userId === session.userId);
      if (!player) { socket.emit("gameMessage", "Join this room before chatting."); return; }
      const cleanMessage = sanitizeChatMessage(message);
      if (!cleanMessage) return;
      const chatMessage = { userId: player.userId, name: player.name, text: cleanMessage, createdAt: new Date().toISOString() };
      addRoomChatMessage(room, chatMessage);
      io.to(room.id).emit("chatMessage", chatMessage);
    } catch (error) { console.error("Chat error:", error); socket.emit("gameMessage", "Chat failed."); }
  });

  socket.on("startHand", async ({ roomId }) => {
    try {
      const room = rooms[roomId]; if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) { socket.emit("gameMessage", "Join a room first."); return; }
      if (playablePlayers(room).length < 2) { socket.emit("gameMessage", "Need at least 2 connected players with chips to start."); return; }
      await startHand(room); io.to(room.id).emit("gameMessage", room.status); emitRoom(room);
    } catch (error) { console.error("Start hand error:", error); socket.emit("gameMessage", "Failed to start hand."); }
  });

  socket.on("playerAction", async ({ roomId, action, amount }) => {
    try {
      const room = rooms[roomId]; if (!room) return;
      const player = room.players.find((p) => p.socketId === socket.id);
      if (!player) { socket.emit("gameMessage", "You are not seated in this room."); return; }
      if (room.phase === "waiting" || room.phase === "showdown") { socket.emit("gameMessage", "Hand is not active."); return; }
      if (!player.isTurn) { socket.emit("gameMessage", "It is not your turn."); return; }
      if (player.allIn || player.folded || player.disconnected || player.waitingNextHand) { socket.emit("gameMessage", "You cannot act now."); return; }
      if (action === "Fold") { player.folded = true; player.hasActed = true; player.status = "Folded"; room.status = player.name + " folded"; io.to(room.id).emit("gameMessage", player.name + " folded."); await proceedAfterAction(room); emitRoom(room); return; }
      if (action === "Call") { const callAmount = Math.max(0, room.currentBet - player.bet); const paidAmount = await takeChips(player, callAmount); room.pot += paidAmount; player.hasActed = true; if (paidAmount < callAmount && player.allIn) { player.status = "All-in"; room.status = player.name + " calls all-in for " + paidAmount; io.to(room.id).emit("gameMessage", player.name + " calls all-in for " + paidAmount + "."); } else if (callAmount === 0) { player.status = "Checked"; room.status = player.name + " checked"; io.to(room.id).emit("gameMessage", player.name + " checked."); } else { player.status = "Called"; room.status = player.name + " called " + paidAmount; io.to(room.id).emit("gameMessage", player.name + " called " + paidAmount + "."); } await proceedAfterAction(room); emitRoom(room); return; }
      if (action === "Raise") { const raiseToAmount = Number(amount); if (!Number.isFinite(raiseToAmount) || raiseToAmount <= room.currentBet) { socket.emit("gameMessage", "Raise must be higher than current bet."); return; } const neededAmount = raiseToAmount - player.bet; if (neededAmount <= 0) { socket.emit("gameMessage", "Invalid raise amount."); return; } if (player.chips < neededAmount) { socket.emit("gameMessage", "Not enough chips. Use All-in instead."); return; } const paidAmount = await takeChips(player, neededAmount); room.pot += paidAmount; room.currentBet = raiseToAmount; room.players.forEach((p) => { if (!p.folded && !p.allIn && !p.disconnected && !p.waitingNextHand && p.chips > 0) p.hasActed = false; }); player.hasActed = true; player.status = player.allIn ? "All-in Raise" : "Raised"; room.status = player.name + " raised to " + raiseToAmount; io.to(room.id).emit("gameMessage", player.name + " raised to " + raiseToAmount + "."); await proceedAfterAction(room); emitRoom(room); return; }
      if (action === "AllIn") { const allInBefore = player.chips; const targetBet = player.bet + allInBefore; const paidAmount = await takeChips(player, allInBefore); room.pot += paidAmount; player.hasActed = true; player.status = "All-in"; if (targetBet > room.currentBet) { room.currentBet = targetBet; room.players.forEach((p) => { if (!p.folded && !p.allIn && !p.disconnected && !p.waitingNextHand && p.chips > 0) p.hasActed = false; }); player.hasActed = true; room.status = player.name + " goes all-in raising to " + targetBet; io.to(room.id).emit("gameMessage", player.name + " goes all-in raising to " + targetBet + "."); } else { room.status = player.name + " goes all-in for " + paidAmount; io.to(room.id).emit("gameMessage", player.name + " goes all-in for " + paidAmount + "."); } await proceedAfterAction(room); emitRoom(room); return; }
    } catch (error) { console.error("Player action error:", error); socket.emit("gameMessage", "Action failed."); }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);
    const location = findPlayerLocation(socket.id);
    if (!location) { io.emit("onlineCount", io.engine.clientsCount); return; }
    const { room, player } = location;
    player.disconnected = true; player.isTurn = false; player.status = "Disconnected";
    io.to(room.id).emit("gameMessage", player.name + " disconnected. Waiting " + Math.floor(RECONNECT_GRACE_MS / 1000) + "s for reconnect."); emitRoom(room);
    const timer = setTimeout(() => {
      const result = removePlayerByUserId(player.userId);
      if (result) { io.to(result.room.id).emit("gameMessage", result.removedPlayer.name + " left the table."); emitRoom(result.room); if (result.room.handStarted) { if (result.room.turnIndex >= result.room.players.length) result.room.turnIndex = 0; if (playersWhoCanAct(result.room).length > 0) { setCurrentTurn(result.room); emitRoom(result.room); } } }
      disconnectTimers.delete(player.userId);
    }, RECONNECT_GRACE_MS);
    disconnectTimers.set(player.userId, timer);
    io.emit("onlineCount", io.engine.clientsCount);
  });
});

initDb()
  .then(() => { server.listen(PORT, () => { console.log("Poker Royale server running on port " + PORT); }); })
  .catch((error) => { console.error("Database init failed:", error); process.exit(1); });
