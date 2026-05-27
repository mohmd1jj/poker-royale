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
      --bg:#03140b; --panel:rgba(2,14,8,.78); --panel2:rgba(8,38,22,.78);
      --gold:#facc15; --gold2:#ca8a04; --green:#22c55e; --muted:#b8c7bd;
      --text:#fff7c2; --line:rgba(250,204,21,.22); --danger:#ef4444;
    }
    body {
      margin:0; min-height:100vh; font-family:Arial,Tahoma,sans-serif; color:white;
      background:
        radial-gradient(circle at 18% 0%, rgba(250,204,21,.16), transparent 30%),
        radial-gradient(circle at 82% 8%, rgba(34,197,94,.16), transparent 32%),
        linear-gradient(180deg,#062819 0%,#03140b 52%,#010604 100%);
      padding:calc(12px + env(safe-area-inset-top)) 14px calc(96px + env(safe-area-inset-bottom));
      overflow-x:hidden;
    }
    .shell { width:100%; max-width:980px; margin:0 auto; }

    .utilityBar {
      direction:ltr; min-height:56px; margin:0 0 14px; padding:7px;
      border:1px solid var(--line); border-radius:24px;
      background:linear-gradient(135deg,rgba(0,0,0,.72),rgba(5,46,22,.46));
      box-shadow:0 18px 44px rgba(0,0,0,.35), inset 0 1px 0 rgba(255,255,255,.08);
      display:flex; align-items:center; gap:10px;
    }
    .accountMini {
      width:42px; height:42px; border:1px solid rgba(250,204,21,.42); border-radius:16px;
      display:grid; place-items:center; text-decoration:none; font-size:22px;
      background:linear-gradient(180deg,#fff7ad,var(--gold) 46%,#b45309);
      box-shadow:0 10px 24px rgba(250,204,21,.22);
      color:#07121f; flex:0 0 auto;
    }
    .walletMini {
      direction:ltr; height:42px; min-width:118px; padding:6px 12px 6px 7px;
      border:1px solid rgba(250,204,21,.25); border-radius:16px;
      background:rgba(0,0,0,.36); display:flex; align-items:center; gap:8px;
      color:#fff7ad; font-weight:900; font-size:13px; flex:0 0 auto;
    }
    .pokerChip {
      width:30px; height:30px; border-radius:50%; position:relative; flex:0 0 auto;
      background:conic-gradient(#e11d48 0 18deg,#fff 18deg 36deg,#2563eb 36deg 54deg,#fff 54deg 72deg,#16a34a 72deg 90deg,#fff 90deg 108deg,#7c3aed 108deg 126deg,#fff 126deg 144deg,#ca8a04 144deg 162deg,#fff 162deg 180deg,#e11d48 180deg 198deg,#fff 198deg 216deg,#2563eb 216deg 234deg,#fff 234deg 252deg,#16a34a 252deg 270deg,#fff 270deg 288deg,#7c3aed 288deg 306deg,#fff 306deg 324deg,#ca8a04 324deg 342deg,#fff 342deg 360deg);
      box-shadow:0 5px 12px rgba(0,0,0,.28), inset 0 0 0 2px rgba(255,255,255,.85);
    }
    .pokerChip:before { content:""; position:absolute; inset:7px; border-radius:50%; background:#fff7ed; box-shadow:inset 0 0 0 2px #11182722; }
    .pokerChip:after { content:"PR"; position:absolute; inset:0; display:grid; place-items:center; color:#07121f; font-weight:1000; font-size:8px; letter-spacing:.2px; }
    .barFill { flex:1; min-height:1px; }

    .hero {
      position:relative; border:1px solid var(--line); border-radius:30px; padding:18px;
      background:linear-gradient(145deg,rgba(0,0,0,.72),rgba(5,46,22,.54)), radial-gradient(circle at top right,rgba(250,204,21,.13),transparent 42%);
      box-shadow:0 22px 60px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.07); overflow:hidden;
    }
    .hero:after { content:""; position:absolute; width:240px; height:240px; border-radius:50%; border:38px solid rgba(250,204,21,.045); left:-90px; bottom:-120px; }
    .topbar { display:flex; align-items:center; justify-content:space-between; gap:12px; position:relative; z-index:2; }
    .brand { display:flex; align-items:center; gap:12px; min-width:0; }
    .mark { width:66px; height:66px; border-radius:22px; display:grid; place-items:center; background:linear-gradient(180deg,#fff7ad,var(--gold) 48%,#b45309); color:#07121f; font-weight:1000; font-size:25px; box-shadow:0 14px 34px rgba(250,204,21,.25); flex:0 0 auto; }
    h1 { margin:0; font-size:clamp(34px,8vw,60px); line-height:.95; color:#fff7ad; letter-spacing:.5px; }
    .subtitle { margin:8px 0 0; color:var(--muted); font-size:14px; line-height:1.7; }
    .heroText { position:relative; z-index:2; margin-top:26px; }
    .heroText h2 { margin:0 0 12px; color:var(--gold); font-size:clamp(26px,7vw,44px); line-height:1.25; }
    .heroText p { margin:0; color:#dce7df; font-size:16px; line-height:2; max-width:760px; }
    .sectionHead { margin:34px 2px 14px; display:flex; align-items:center; justify-content:space-between; gap:12px; }
    .sectionHead h2 { margin:0; color:var(--gold); font-size:30px; }
    .homePill { border:1px solid var(--line); border-radius:999px; padding:8px 18px; color:#dce7df; background:rgba(0,0,0,.28); font-weight:900; }
    .gamesGrid { display:grid; grid-template-columns:1fr; gap:16px; }
    .gameCard {
      position:relative; min-height:164px; border:1px solid var(--line); border-radius:28px;
      padding:22px 22px; overflow:hidden; text-decoration:none; color:white;
      background:linear-gradient(145deg,rgba(0,0,0,.72),rgba(5,46,22,.48));
      box-shadow:0 18px 44px rgba(0,0,0,.34), inset 0 1px 0 rgba(255,255,255,.06);
      display:flex; align-items:center; justify-content:space-between; gap:18px;
    }
    .gameCard:after { content:""; position:absolute; width:220px; height:220px; border-radius:50%; border:42px solid rgba(255,255,255,.035); left:60px; bottom:-118px; }
    .gameCard.active { background:linear-gradient(145deg,rgba(250,204,21,.10),rgba(5,46,22,.62)); }
    .gameInfo { position:relative; z-index:2; min-width:0; }
    .gameStatus { display:inline-flex; margin-bottom:10px; border:1px solid rgba(250,204,21,.35); border-radius:999px; padding:7px 15px; color:var(--gold); font-weight:1000; font-size:13px; background:rgba(0,0,0,.28); }
    .gameCard.active .gameStatus { color:#bbf7d0; border-color:rgba(34,197,94,.45); background:rgba(22,163,74,.18); }
    .gameTitle { margin:0; color:#fff7ad; font-size:32px; line-height:1.15; }
    .gameDesc { margin:10px 0 0; color:#d9e4dd; font-size:15px; line-height:1.8; }
    .gameLogo { position:relative; z-index:2; width:98px; height:98px; border-radius:30px; display:grid; place-items:center; background:linear-gradient(145deg,rgba(255,255,255,.12),rgba(255,255,255,.04)); border:1px solid rgba(255,255,255,.16); box-shadow:inset 0 1px 0 rgba(255,255,255,.08), 0 18px 40px rgba(0,0,0,.28); flex:0 0 auto; }
    .logoGlyph { font-size:48px; line-height:1; color:var(--accent,#facc15); filter:drop-shadow(0 0 12px color-mix(in srgb,var(--accent,#facc15),transparent 52%)); font-weight:1000; }
    .bottomNav { position:fixed; left:50%; transform:translateX(-50%); bottom:calc(12px + env(safe-area-inset-bottom)); width:min(92%,620px); display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; padding:10px; border:1px solid var(--line); border-radius:28px; background:rgba(0,0,0,.68); backdrop-filter:blur(16px); z-index:30; box-shadow:0 -18px 44px rgba(0,0,0,.35); }
    .gameCard.photoCard::before { content:""; position:absolute; inset:0; background:radial-gradient(circle at 78% 35%, rgba(214,180,106,.12), transparent 26%); z-index:1; pointer-events:none; }
    .gameCard.photoCard .gameInfo { max-width:68%; }
    .gameCard.photoCard .gameLogo { width:72px !important; height:72px !important; border-radius:999px !important; background:rgba(0,0,0,.58) !important; border:1px solid rgba(214,180,106,.30) !important; backdrop-filter: blur(6px); }
    .gameCard.photoCard .logoGlyph { color:#f4efe2 !important; font-size:21px !important; letter-spacing:.5px !important; }
    .gameCard.photoCard .gameTitle { text-shadow:0 2px 16px rgba(0,0,0,.62); }
    .gameCard.photoCard .gameDesc { color:#e7ece8 !important; text-shadow:0 1px 10px rgba(0,0,0,.62); }

    .navItem { border:none; border-radius:20px; padding:13px 8px; color:#dce7df; background:transparent; font-weight:1000; font-size:13px; text-align:center; }
    .navItem.active { color:#07121f; background:linear-gradient(180deg,#fff7ad,var(--gold)); }
    @media (min-width:760px) { .gamesGrid{grid-template-columns:1fr 1fr}.gameCard{min-height:190px}.gameCard:first-child{grid-column:span 2}.gameTitle{font-size:38px} }
    @media (max-width:520px) { body{padding-left:10px;padding-right:10px}.hero{border-radius:24px;padding:16px}.mark{width:56px;height:56px;border-radius:19px}.subtitle{font-size:13px}.gameCard{min-height:152px;border-radius:24px;padding:18px 17px}.gameLogo{width:82px;height:82px;border-radius:26px}.logoGlyph{font-size:40px}.gameTitle{font-size:28px}.sectionHead h2{font-size:27px}.utilityBar{border-radius:21px}.walletMini{min-width:104px}.homePill{display:none} }
  

/* ================================
   PREMIUM DARK UI v4 - Home
   ================================ */
:root{
  --premium-bg:#060807;
  --premium-panel:rgba(8,12,11,.82);
  --premium-panel-2:rgba(13,25,19,.72);
  --premium-line:rgba(219,183,94,.18);
  --premium-gold:#d6b46a;
  --premium-gold-soft:#bfa15f;
  --premium-text:#f4efe2;
  --premium-muted:#9aa79f;
}
body{
  background:
    radial-gradient(circle at 50% -10%, rgba(214,180,106,.10), transparent 34%),
    radial-gradient(circle at 10% 10%, rgba(28,72,48,.18), transparent 34%),
    linear-gradient(180deg,#070908 0%, #07110c 46%, #030504 100%) !important;
  color:var(--premium-text) !important;
}
.utilityBar{
  height:50px !important;
  min-height:50px !important;
  border-radius:18px !important;
  border-color:var(--premium-line) !important;
  background:rgba(3,5,4,.72) !important;
  box-shadow:0 12px 36px rgba(0,0,0,.38), inset 0 1px 0 rgba(255,255,255,.045) !important;
}
.accountMini{
  width:36px !important;
  height:36px !important;
  border-radius:13px !important;
  font-size:18px !important;
  background:linear-gradient(180deg,#242927,#0d1110) !important;
  color:var(--premium-gold) !important;
  border-color:rgba(214,180,106,.28) !important;
  box-shadow:none !important;
}
.walletMini{
  height:36px !important;
  min-width:96px !important;
  border-radius:13px !important;
  background:rgba(255,255,255,.035) !important;
  border-color:rgba(214,180,106,.20) !important;
  color:var(--premium-text) !important;
}
.pokerChip{
  width:25px !important;
  height:25px !important;
  filter:saturate(.72) contrast(.94);
  opacity:.92;
}
.hero{
  border-radius:24px !important;
  padding:24px 20px !important;
  border-color:var(--premium-line) !important;
  background:
    linear-gradient(145deg,rgba(7,10,9,.88),rgba(10,28,18,.62)),
    radial-gradient(circle at 82% 18%, rgba(214,180,106,.08), transparent 35%) !important;
  box-shadow:0 24px 70px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.045) !important;
}
.hero:after{ opacity:.42 !important; border-color:rgba(214,180,106,.025) !important; }
.mark{
  width:54px !important;
  height:54px !important;
  border-radius:16px !important;
  background:linear-gradient(180deg,#1f2723,#0d1210) !important;
  color:var(--premium-gold) !important;
  border:1px solid rgba(214,180,106,.28) !important;
  box-shadow:0 14px 34px rgba(0,0,0,.28) !important;
  font-size:20px !important;
  letter-spacing:1px;
}
h1{
  color:var(--premium-text) !important;
  font-size:clamp(30px,7vw,54px) !important;
  letter-spacing:.2px !important;
  font-weight:800 !important;
}
.subtitle{ color:var(--premium-muted) !important; }
.heroText h2{
  color:var(--premium-gold) !important;
  font-size:clamp(24px,6vw,38px) !important;
  font-weight:800 !important;
}
.heroText p{ color:#c3cbc5 !important; font-size:15px !important; }
.sectionHead{ margin-top:28px !important; }
.sectionHead h2{
  color:var(--premium-text) !important;
  font-size:25px !important;
  font-weight:800 !important;
}
.homePill{
  border-color:rgba(214,180,106,.20) !important;
  color:var(--premium-muted) !important;
  background:rgba(255,255,255,.025) !important;
}
.gamesGrid{ gap:12px !important; }
.gameCard{
  min-height:154px !important;
  border-radius:22px !important;
  padding:18px 18px !important;
  border-color:rgba(214,180,106,.20) !important;
  background:
    linear-gradient(90deg,rgba(0,0,0,.86),rgba(0,0,0,.60) 44%,rgba(0,0,0,.22)),
    var(--photo, linear-gradient(145deg,rgba(10,14,13,.86),rgba(9,23,16,.66))) center/cover no-repeat !important;
  box-shadow:0 18px 46px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.045) !important;
}
.gameCard:after{
  width:150px !important;
  height:150px !important;
  border-width:28px !important;
  border-color:rgba(214,180,106,.025) !important;
  left:40px !important;
  bottom:-90px !important;
}
.gameCard.active{
  background:
    linear-gradient(145deg,rgba(18,22,20,.92),rgba(10,33,21,.74)),
    radial-gradient(circle at 75% 15%, rgba(214,180,106,.065), transparent 42%) !important;
}
.gameStatus{
  margin-bottom:8px !important;
  padding:5px 11px !important;
  font-size:11px !important;
  letter-spacing:.3px;
  color:var(--premium-gold) !important;
  border-color:rgba(214,180,106,.24) !important;
  background:rgba(0,0,0,.20) !important;
}
.gameCard.active .gameStatus{
  color:#c9f3d6 !important;
  border-color:rgba(64,150,96,.32) !important;
  background:rgba(28,90,53,.12) !important;
}
.gameTitle{
  font-size:24px !important;
  color:var(--premium-text) !important;
  font-weight:800 !important;
}
.gameDesc{
  margin-top:6px !important;
  color:#aeb9b2 !important;
  font-size:13px !important;
  line-height:1.65 !important;
}
.gameLogo{
  width:68px !important;
  height:68px !important;
  border-radius:18px !important;
  background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.018)) !important;
  border-color:rgba(214,180,106,.16) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.05),0 14px 30px rgba(0,0,0,.25) !important;
}
.logoGlyph{
  font-size:30px !important;
  color:var(--premium-gold) !important;
  filter:none !important;
  font-weight:800 !important;
  letter-spacing:-1px;
}
.bottomNav{
  width:min(92%,520px) !important;
  border-radius:22px !important;
  padding:7px !important;
  gap:6px !important;
  border-color:rgba(214,180,106,.18) !important;
  background:rgba(4,6,5,.78) !important;
  box-shadow:0 -18px 44px rgba(0,0,0,.44), inset 0 1px 0 rgba(255,255,255,.04) !important;
}
.navItem{
  border-radius:16px !important;
  color:#aeb9b2 !important;
  font-weight:800 !important;
  padding:11px 7px !important;
}
.navItem.active{
  background:linear-gradient(180deg,#d6b46a,#9b7c38) !important;
  color:#080c0a !important;
}
@media (min-width:760px){
  .gameCard{min-height:142px !important;}
  .gameTitle{font-size:28px !important;}
}
@media (max-width:520px){
  .hero{padding:18px 16px !important; border-radius:21px !important;}
  .gameCard{min-height:112px !important; padding:15px !important; border-radius:19px !important;}
  .gameLogo{width:60px !important;height:60px !important;border-radius:16px !important;}
  .logoGlyph{font-size:26px !important;}
  .gameTitle{font-size:22px !important;}
  .gameDesc{font-size:12.5px !important;}
}
</style>
</head>
<body>
  <main class="shell">
    <div class="utilityBar" aria-label="Account and wallet bar">
      <a class="accountMini" href="/account" aria-label="Account">&#128100;</a>
      <div class="walletMini" aria-label="Shared chips balance"><span class="pokerChip"></span><span id="walletAmount">0</span></div>
      <div class="barFill"></div>
    </div>

    <section class="hero">
      <div class="topbar">
        <div class="brand">
          <div class="mark">PR</div>
          <div>
            <h1>Poker Royale</h1>
            <div class="subtitle" id="subtitle"></div>
          </div>
        </div>
      </div>
      <div class="heroText">
        <h2 id="heroTitle"></h2>
        <p id="heroDesc"></p>
      </div>
    </section>

    <section class="sectionHead">
      <h2 id="gamesTitle"></h2>
      <div class="homePill" id="homePill"></div>
    </section>

    <section class="gamesGrid" id="gamesGrid"></section>
  </main>

  <nav class="bottomNav">
    <button class="navItem active" id="navHome"></button>
    <button class="navItem" id="navGames"></button>
    <a class="navItem" id="navProfile" href="/account" style="text-decoration:none;"></a>
  </nav>

  <script>
    const fa = {
      subtitle:"\u067E\u0644\u062A\u0641\u0631\u0645 \u0628\u0627\u0632\u06CC\u200C\u0647\u0627\u06CC \u0622\u0646\u0644\u0627\u06CC\u0646 \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u0648 \u0631\u0642\u0627\u0628\u062A\u06CC",
      heroTitle:"\u0628\u0627\u0632\u06CC \u0645\u0648\u0631\u062F \u0639\u0644\u0627\u0642\u0647\u200C\u0627\u062A \u0631\u0627 \u0627\u0646\u062A\u062E\u0627\u0628 \u06A9\u0646",
      heroDesc:"\u0627\u0632 \u0627\u06CC\u0646 \u0635\u0641\u062D\u0647 \u0648\u0627\u0631\u062F \u067E\u0648\u06A9\u0631 \u0634\u0648 \u06CC\u0627 \u0628\u0627\u0632\u06CC\u200C\u0647\u0627\u06CC \u0628\u0639\u062F\u06CC \u0631\u0627 \u062F\u0646\u0628\u0627\u0644 \u06A9\u0646. \u0645\u0648\u062C\u0648\u062F\u06CC \u0686\u06CC\u067E \u0628\u06CC\u0646 \u0647\u0645\u0647 \u0628\u0627\u0632\u06CC\u200C\u0647\u0627 \u0645\u0634\u062A\u0631\u06A9 \u0627\u0633\u062A.",
      gamesTitle:"\u0644\u06CC\u0633\u062A \u0628\u0627\u0632\u06CC\u200C\u0647\u0627", homePill:"\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC", navHome:"\u062E\u0627\u0646\u0647", navGames:"\u0628\u0627\u0632\u06CC\u200C\u0647\u0627", navProfile:"\u067E\u0631\u0648\u0641\u0627\u06CC\u0644",
      active:"\u0641\u0639\u0627\u0644", soon:"\u0628\u0647\u200C\u0632\u0648\u062F\u06CC",
      games:[
        {title:"\u067E\u0648\u06A9\u0631", desc:"Texas Hold\u2019em \u0628\u0627 \u0645\u06CC\u0632 \u0622\u0646\u0644\u0627\u06CC\u0646 \u0648 \u0645\u0648\u062C\u0648\u062F\u06CC \u0686\u06CC\u067E \u0645\u0634\u062A\u0631\u06A9", icon:"POKER", photo:"https://source.unsplash.com/1200x900/?poker,cards,chips", href:"/games/poker", active:true, accent:"#facc15"},
        {title:"\u0634\u0637\u0631\u0646\u062C", desc:"\u0628\u0627\u0632\u06CC \u0627\u0633\u062A\u0631\u0627\u062A\u0698\u06CC\u06A9 \u062F\u0648\u0646\u0641\u0631\u0647 \u0628\u0627 \u0627\u062A\u0627\u0642 \u0622\u0646\u0644\u0627\u06CC\u0646", icon:"CHESS", photo:"https://source.unsplash.com/1200x900/?chess,board,pieces", href:"#", active:false, accent:"#fff7ad"},
        {title:"\u0645\u0646\u0686", desc:"\u0628\u0627\u0632\u06CC \u06A9\u0644\u0627\u0633\u06CC\u06A9 \u0648 \u0633\u0631\u06AF\u0631\u0645\u200C\u06A9\u0646\u0646\u062F\u0647 \u0628\u0631\u0627\u06CC \u0631\u0642\u0627\u0628\u062A \u062F\u0648\u0633\u062A\u0627\u0646\u0647", icon:"LUDO", photo:"https://source.unsplash.com/1200x900/?ludo,boardgame,dice", href:"#", active:false, accent:"#22c55e"},
        {title:"\u062A\u062E\u062A\u0647 \u0646\u0631\u062F", desc:"\u0631\u0642\u0627\u0628\u062A \u0633\u0631\u06CC\u0639 \u0628\u0627 \u062A\u0627\u0633 \u0648 \u0645\u0647\u0631\u0647\u200C\u0647\u0627\u06CC \u06A9\u0644\u0627\u0633\u06CC\u06A9", icon:"BACK", photo:"https://source.unsplash.com/1200x900/?backgammon,dice,board", href:"#", active:false, accent:"#f59e0b"},
        {title:"\u062D\u06A9\u0645", desc:"\u0628\u0627\u0632\u06CC \u06A9\u0627\u0631\u062A\u06CC \u062A\u06CC\u0645\u06CC \u0628\u0627 \u0642\u0648\u0627\u0646\u06CC\u0646 \u0622\u0634\u0646\u0627", icon:"HOKM", photo:"https://source.unsplash.com/1200x900/?playing,cards,table", href:"#", active:false, accent:"#ef4444"},
        {title:"\u0686\u0647\u0627\u0631 \u0628\u0631\u06AF", desc:"\u0628\u0627\u0632\u06CC \u06A9\u0627\u0631\u062A\u06CC \u0633\u0631\u06CC\u0639 \u0648 \u0631\u0642\u0627\u0628\u062A\u06CC", icon:"CARD", photo:"https://source.unsplash.com/1200x900/?playing,cards,clubs", href:"#", active:false, accent:"#38bdf8"}
      ]
    };
    const en = {
      subtitle:"Classic competitive online games platform",
      heroTitle:"Choose your favorite game",
      heroDesc:"Enter Poker from here or follow the next games. Your chip balance is shared between all games.",
      gamesTitle:"Games List", homePill:"Home", navHome:"Home", navGames:"Games", navProfile:"Profile",
      active:"Active", soon:"Soon",
      games:[
        {title:"Poker", desc:"Texas Hold\u2019em with online table and shared chip balance", icon:"POKER", photo:"https://source.unsplash.com/1200x900/?poker,cards,chips", href:"/games/poker", active:true, accent:"#facc15"},
        {title:"Chess", desc:"Two-player strategy game with online room", icon:"CHESS", photo:"https://source.unsplash.com/1200x900/?chess,board,pieces", href:"#", active:false, accent:"#fff7ad"},
        {title:"Ludo", desc:"Classic friendly competition board game", icon:"LUDO", photo:"https://source.unsplash.com/1200x900/?ludo,boardgame,dice", href:"#", active:false, accent:"#22c55e"},
        {title:"Backgammon", desc:"Fast dice and classic checker strategy", icon:"BACK", photo:"https://source.unsplash.com/1200x900/?backgammon,dice,board", href:"#", active:false, accent:"#f59e0b"},
        {title:"Hokm", desc:"Team card game with familiar rules", icon:"HOKM", photo:"https://source.unsplash.com/1200x900/?playing,cards,table", href:"#", active:false, accent:"#ef4444"},
        {title:"Chahar Barg", desc:"Fast competitive Persian card game", icon:"CARD", photo:"https://source.unsplash.com/1200x900/?playing,cards,clubs", href:"#", active:false, accent:"#38bdf8"}
      ]
    };
    let currentLang = localStorage.getItem("pokerLang") || "fa";
    const data = () => currentLang === "fa" ? fa : en;
    const fmt = (n) => Number(n || 0).toLocaleString(currentLang === "fa" ? "fa-IR" : "en-US");
    function render(){
      const t=data();
      document.documentElement.lang=currentLang;
      document.documentElement.dir=currentLang === "fa" ? "rtl" : "ltr";
      document.getElementById("subtitle").textContent=t.subtitle;
      document.getElementById("heroTitle").textContent=t.heroTitle;
      document.getElementById("heroDesc").textContent=t.heroDesc;
      document.getElementById("gamesTitle").textContent=t.gamesTitle;
      document.getElementById("homePill").textContent=t.homePill;
      document.getElementById("navHome").textContent=t.navHome;
      document.getElementById("navGames").textContent=t.navGames;
      document.getElementById("navProfile").textContent=t.navProfile;
      const grid=document.getElementById("gamesGrid");
      grid.innerHTML="";
      t.games.forEach((g)=>{
        const a=document.createElement("a");
        a.className="gameCard photoCard"+(g.active?" active":"");
        a.href=g.href;
        a.style.setProperty("--accent",g.accent); if(g.photo){a.style.setProperty("--photo", "url('" + g.photo + "')");}
        if(!g.active){ a.onclick=(e)=>{ e.preventDefault(); alert(currentLang === "fa" ? "\u0627\u06CC\u0646 \u0628\u0627\u0632\u06CC \u0628\u0647\u200C\u0632\u0648\u062F\u06CC \u0641\u0639\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u062F." : "This game is coming soon."); }; }
        a.innerHTML='<div class="gameInfo"><span class="gameStatus">'+(g.active?t.active:t.soon)+'</span><h3 class="gameTitle"></h3><p class="gameDesc"></p></div><div class="gameLogo"><div class="logoGlyph"></div></div>';
        a.querySelector(".gameTitle").textContent=g.title;
        a.querySelector(".gameDesc").textContent=g.desc;
        a.querySelector(".logoGlyph").textContent=g.icon;
        grid.appendChild(a);
      });
    }
    async function loadMe(){
      try{
        const r=await fetch('/api/me'); const j=await r.json();
        document.getElementById('walletAmount').textContent=fmt(j.user ? j.user.chips : 0);
      }catch(e){ document.getElementById('walletAmount').textContent='0'; }
    }
    console.log("Real Photo Cards Full v3 loaded"); render(); loadMe();
  </script>
</body>
</html>`);
});

app.get("/account", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#03140b" />
  <title>Account - Poker Royale</title>
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    body{margin:0;min-height:100vh;font-family:Arial,Tahoma,sans-serif;color:white;background:radial-gradient(circle at 20% 0%,rgba(250,204,21,.16),transparent 30%),linear-gradient(180deg,#062819,#010604);padding:calc(16px + env(safe-area-inset-top)) 14px calc(28px + env(safe-area-inset-bottom));}
    .wrap{width:100%;max-width:620px;margin:0 auto;}
    .card{border:1px solid rgba(250,204,21,.22);border-radius:28px;background:linear-gradient(145deg,rgba(0,0,0,.72),rgba(5,46,22,.54));box-shadow:0 22px 60px rgba(0,0,0,.42);padding:18px;}
    .head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:18px;}
    .title{display:flex;align-items:center;gap:12px;min-width:0}.avatar{width:54px;height:54px;border-radius:19px;display:grid;place-items:center;background:linear-gradient(180deg,#fff7ad,#facc15 50%,#b45309);font-size:24px;color:#07121f;font-weight:1000}.title h1{margin:0;color:#fff7ad;font-size:28px}.title p{margin:4px 0 0;color:#b8c7bd;font-size:13px;line-height:1.6}
    .homeBtn,.langBtn,.btn{border:none;border-radius:16px;padding:12px 14px;font-weight:1000;cursor:pointer;text-decoration:none;text-align:center}.homeBtn{background:rgba(0,0,0,.36);border:1px solid rgba(250,204,21,.25);color:#facc15}.langBtn{background:#facc15;color:#111827}.grid{display:grid;gap:10px}.input{width:100%;border:1px solid rgba(250,204,21,.32);background:rgba(0,0,0,.42);color:white;border-radius:16px;padding:14px;font-size:15px;outline:none}.btnGreen{background:#166534;color:white}.btnGold{background:#facc15;color:#111827}.btnBlue{background:#2563eb;color:white}.btnPurple{background:#7c3aed;color:white}.btnRed{background:#991b1b;color:white}.row{display:grid;grid-template-columns:1fr 1fr;gap:10px}.info{border:1px solid rgba(250,204,21,.18);border-radius:20px;background:rgba(0,0,0,.28);padding:14px;color:#dce7df;line-height:1.8}.chipLine{display:flex;align-items:center;gap:10px;color:#fff7ad;font-weight:1000;font-size:18px;margin-top:8px;direction:ltr;justify-content:flex-start}.pokerChip{width:34px;height:34px;border-radius:50%;position:relative;flex:0 0 auto;background:conic-gradient(#e11d48 0 18deg,#fff 18deg 36deg,#2563eb 36deg 54deg,#fff 54deg 72deg,#16a34a 72deg 90deg,#fff 90deg 108deg,#7c3aed 108deg 126deg,#fff 126deg 144deg,#ca8a04 144deg 162deg,#fff 162deg 180deg,#e11d48 180deg 198deg,#fff 198deg 216deg,#2563eb 216deg 234deg,#fff 234deg 252deg,#16a34a 252deg 270deg,#fff 270deg 288deg,#7c3aed 288deg 306deg,#fff 306deg 324deg,#ca8a04 324deg 342deg,#fff 342deg 360deg);box-shadow:0 6px 14px rgba(0,0,0,.3),inset 0 0 0 2px rgba(255,255,255,.85)}.pokerChip:before{content:"";position:absolute;inset:8px;border-radius:50%;background:#fff7ed}.pokerChip:after{content:"PR";position:absolute;inset:0;display:grid;place-items:center;color:#07121f;font-size:8px;font-weight:1000}.hidden{display:none!important}.note{color:#b8c7bd;font-size:12px;line-height:1.8;margin:10px 0 0}.topActions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-bottom:12px}@media(max-width:480px){.row{grid-template-columns:1fr}.title h1{font-size:24px}.card{border-radius:24px;padding:15px}.head{align-items:flex-start}.topActions{justify-content:stretch}.topActions>*{flex:1}}
  

/* ================================
   PREMIUM DARK UI v4 - Account
   ================================ */
:root{--premium-gold:#d6b46a;--premium-text:#f4efe2;--premium-muted:#9aa79f;--premium-line:rgba(219,183,94,.18)}
body{
  background:
    radial-gradient(circle at 50% -10%, rgba(214,180,106,.10), transparent 34%),
    linear-gradient(180deg,#070908 0%, #07110c 48%, #030504 100%) !important;
  color:var(--premium-text) !important;
}
.accountShell,.accountCard,.panel,.auth-panel{
  border-color:var(--premium-line) !important;
  background:linear-gradient(145deg,rgba(7,10,9,.88),rgba(10,28,18,.62)) !important;
  box-shadow:0 24px 70px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.045) !important;
}
.accountTitle,h1,h2{color:var(--premium-text) !important;font-weight:800 !important;}
.accountSubtitle,.muted,.subtitle{color:var(--premium-muted) !important;}
.input,input{
  background:rgba(255,255,255,.035) !important;
  border-color:rgba(214,180,106,.18) !important;
  color:var(--premium-text) !important;
}
button,.small-btn,.primaryBtn,.secondaryBtn,.homeBtn{
  border-radius:14px !important;
  box-shadow:none !important;
  font-weight:800 !important;
}
.primaryBtn,.small-btn:not(.logout-btn){background:linear-gradient(180deg,#d6b46a,#9b7c38) !important;color:#080c0a !important;}
.secondaryBtn,.homeBtn{background:rgba(255,255,255,.04) !important;color:var(--premium-text) !important;border:1px solid rgba(214,180,106,.18) !important;}
.logout-btn{background:linear-gradient(180deg,#7f1d1d,#451111) !important;color:#fff !important;}
.pokerChip{filter:saturate(.72) contrast(.94);}
</style>
</head>
<body>
  <main class="wrap">
    <div class="topActions"><a class="homeBtn" href="/" id="homeTop"></a><button class="langBtn" id="langBtn" type="button">FA</button></div>
    <section class="card">
      <div class="head">
        <div class="title"><div class="avatar">&#128100;</div><div><h1 id="pageTitle"></h1><p id="pageSub"></p></div></div>
      </div>

      <div id="guestBox" class="grid">
        <input class="input" id="username" autocomplete="username" />
        <input class="input" id="password" type="password" autocomplete="current-password" />
        <div class="row"><button class="btn btnGreen" id="loginBtn"></button><button class="btn btnGold" id="registerBtn"></button></div>
        <p class="note" id="guestNote"></p>
      </div>

      <div id="userBox" class="grid hidden">
        <div class="info"><span id="welcomeText"></span> <strong id="accountName"></strong><div class="chipLine"><span class="pokerChip"></span><span id="chipsAmount">0</span></div><div class="note" id="sharedNote"></div></div>
        <div class="row"><button class="btn btnBlue" id="bonusBtn"></button><button class="btn btnPurple" id="reloadBtn"></button></div>
        <div class="row"><button class="btn btnGold" id="buyBtn"></button><button class="btn btnGold" id="sellBtn"></button></div>
        <button class="btn btnRed" id="logoutBtn"></button>
      </div>
    </section>
  </main>
  <script>
    const fa={home:"\u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC",title:"\u0646\u0627\u062D\u06CC\u0647 \u06A9\u0627\u0631\u0628\u0631\u06CC",sub:"\u0648\u0631\u0648\u062F\u060C \u0627\u062D\u0631\u0627\u0632 \u0647\u0648\u06CC\u062A \u0648 \u0645\u062F\u06CC\u0631\u06CC\u062A \u0645\u0648\u062C\u0648\u062F\u06CC \u0686\u06CC\u067E",lang:"EN",username:"\u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC",password:"\u0631\u0645\u0632 \u0639\u0628\u0648\u0631",login:"\u0648\u0631\u0648\u062F",register:"\u062B\u0628\u062A\u200C\u0646\u0627\u0645",guestNote:"\u0642\u0628\u0644 \u0627\u0632 \u0648\u0631\u0648\u062F \u0641\u0642\u0637 \u0646\u0627\u0645 \u06A9\u0627\u0631\u0628\u0631\u06CC\u060C \u0631\u0645\u0632 \u0639\u0628\u0648\u0631\u060C \u062A\u063A\u06CC\u06CC\u0631 \u0632\u0628\u0627\u0646 \u0648 \u0635\u0641\u062D\u0647 \u0627\u0635\u0644\u06CC \u062F\u0631 \u062F\u0633\u062A\u0631\u0633 \u0627\u0633\u062A.",welcome:"\u062E\u0648\u0634 \u0622\u0645\u062F\u06CC\u060C",shared:"\u0645\u0648\u062C\u0648\u062F\u06CC \u0686\u06CC\u067E \u0628\u06CC\u0646 \u0647\u0645\u0647 \u0628\u0627\u0632\u06CC\u200C\u0647\u0627 \u0645\u0634\u062A\u0631\u06A9 \u0627\u0633\u062A.",bonus:"\u062C\u0627\u06CC\u0632\u0647 \u0631\u0648\u0632\u0627\u0646\u0647",reload:"\u0634\u0627\u0631\u0698 \u0686\u06CC\u067E",buy:"\u062E\u0631\u06CC\u062F \u0686\u06CC\u067E",sell:"\u0641\u0631\u0648\u0634 \u0686\u06CC\u067E",logout:"\u062E\u0631\u0648\u062C",soon:"\u0627\u06CC\u0646 \u06AF\u0632\u06CC\u0646\u0647 \u0628\u0647\u200C\u0632\u0648\u062F\u06CC \u0641\u0639\u0627\u0644 \u0645\u06CC\u200C\u0634\u0648\u062F."};
    const en={home:"Home",title:"Account",sub:"Login, authentication and chip balance management",lang:"FA",username:"Username",password:"Password",login:"Login",register:"Register",guestNote:"Before login, only language, username, password and home are available.",welcome:"Welcome,",shared:"Chip balance is shared between all games.",bonus:"Daily Bonus",reload:"Reload Chips",buy:"Buy Chips",sell:"Sell Chips",logout:"Logout",soon:"This option is coming soon."};
    let currentLang=localStorage.getItem('pokerLang')||'fa';let currentUser=null;const $=id=>document.getElementById(id);const fmt=n=>Number(n||0).toLocaleString(currentLang==='fa'?'fa-IR':'en-US');function t(){return currentLang==='fa'?fa:en}function apply(){const x=t();document.documentElement.lang=currentLang;document.documentElement.dir=currentLang==='fa'?'rtl':'ltr';$('homeTop').textContent=x.home;$('pageTitle').textContent=x.title;$('pageSub').textContent=x.sub;$('langBtn').textContent=x.lang;$('username').placeholder=x.username;$('password').placeholder=x.password;$('loginBtn').textContent=x.login;$('registerBtn').textContent=x.register;$('guestNote').textContent=x.guestNote;$('welcomeText').textContent=x.welcome;$('sharedNote').textContent=x.shared;$('bonusBtn').textContent=x.bonus;$('reloadBtn').textContent=x.reload;$('buyBtn').textContent=x.buy;$('sellBtn').textContent=x.sell;$('logoutBtn').textContent=x.logout;renderUser()}function renderUser(){if(currentUser){$('guestBox').classList.add('hidden');$('userBox').classList.remove('hidden');$('accountName').textContent=currentUser.username;$('chipsAmount').textContent=fmt(currentUser.chips)}else{$('guestBox').classList.remove('hidden');$('userBox').classList.add('hidden')}}async function api(path,body){const r=await fetch(path,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||'Request failed');return j}async function loadMe(){try{const j=await api('/api/me');currentUser=j.user;renderUser()}catch(e){currentUser=null;renderUser()}}$('langBtn').onclick=()=>{currentLang=currentLang==='fa'?'en':'fa';localStorage.setItem('pokerLang',currentLang);apply()};$('loginBtn').onclick=async()=>{try{const j=await api('/api/login',{username:$('username').value,password:$('password').value});currentUser=j.user;apply()}catch(e){alert(e.message)}};$('registerBtn').onclick=async()=>{try{const j=await api('/api/register',{username:$('username').value,password:$('password').value});currentUser=j.user;apply()}catch(e){alert(e.message)}};$('logoutBtn').onclick=async()=>{await api('/api/logout',{});currentUser=null;apply()};$('bonusBtn').onclick=async()=>{try{const j=await api('/api/daily-bonus',{});alert(j.message);await loadMe()}catch(e){alert(e.message)}};$('reloadBtn').onclick=async()=>{try{const j=await api('/api/reload-chips',{});alert(j.message);await loadMe()}catch(e){alert(e.message)}};$('buyBtn').onclick=()=>alert(t().soon);$('sellBtn').onclick=()=>alert(t().soon);apply();loadMe();
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
<!--
Poker Royale - Real Photo Game Cards Patch
Paste this code exactly BEFORE </body> in server.js
-->

<script>
(function () {
  var PERSIAN = {
    poker: "\u067e\u0648\u06a9\u0631",
    chess: "\u0634\u0637\u0631\u0646\u062c",
    mench: "\u0645\u0646\u0686",
    backgammon: "\u062a\u062e\u062a\u0647 \u0646\u0631\u062f",
    hokm: "\u062d\u06a9\u0645",
    chaharBarg: "\u0686\u0647\u0627\u0631 \u0628\u0631\u06af"
  };

  var PHOTOS = {
    poker: "https://source.unsplash.com/1200x900/?poker,cards,chips,casino",
    chess: "https://source.unsplash.com/1200x900/?chess,board,pieces",
    mench: "https://source.unsplash.com/1200x900/?ludo,boardgame,dice",
    backgammon: "https://source.unsplash.com/1200x900/?backgammon,board,dice",
    hokm: "https://source.unsplash.com/1200x900/?playing,cards,casino",
    chaharBarg: "https://source.unsplash.com/1200x900/?playing,cards,clubs"
  };

  function injectStyle() {
    if (document.getElementById("realPhotoCardsStyle")) return;

    var style = document.createElement("style");
    style.id = "realPhotoCardsStyle";
    style.textContent = \`
      .game-card,
      .game-tile,
      .game-item,
      [data-game] {
        position: relative !important;
      }

      .real-photo-game-card {
        min-height: 176px !important;
        overflow: hidden !important;
        border: 1px solid rgba(214, 180, 106, 0.26) !important;
        background-size: cover !important;
        background-position: center !important;
        box-shadow:
          0 20px 58px rgba(0,0,0,0.46),
          inset 0 1px 0 rgba(255,255,255,0.08) !important;
      }

      .real-photo-game-card::before {
        content: "";
        position: absolute;
        inset: 0;
        background:
          linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.76)),
          radial-gradient(circle at top left, rgba(214,180,106,0.16), transparent 40%);
        z-index: 0;
        pointer-events: none;
      }

      .real-photo-game-card::after {
        content: "";
        position: absolute;
        inset: 1px;
        border-radius: inherit;
        border: 1px solid rgba(255,255,255,0.055);
        z-index: 1;
        pointer-events: none;
      }

      .real-photo-game-card > * {
        position: relative !important;
        z-index: 2 !important;
      }

      .real-photo-game-card .game-logo,
      .real-photo-game-card .game-icon,
      .real-photo-game-card .icon,
      .real-photo-game-card .logo-box {
        display: none !important;
      }

      .real-photo-game-card .game-title,
      .real-photo-game-card h2,
      .real-photo-game-card h3,
      .real-photo-game-card strong {
        color: #fff7d6 !important;
        text-shadow: 0 3px 18px rgba(0,0,0,0.82) !important;
        letter-spacing: -0.2px !important;
      }

      .real-photo-game-card .game-status,
      .real-photo-game-card .status,
      .real-photo-game-card small,
      .real-photo-game-card p {
        color: rgba(255,255,255,0.78) !important;
        text-shadow: 0 2px 12px rgba(0,0,0,0.72) !important;
      }

      .real-photo-game-card .game-status,
      .real-photo-game-card .status {
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        padding: 6px 10px !important;
        border-radius: 999px !important;
        background: rgba(0,0,0,0.46) !important;
        border: 1px solid rgba(214,180,106,0.26) !important;
        backdrop-filter: blur(8px) !important;
      }

      @media (max-width: 700px) {
        .real-photo-game-card {
          min-height: 150px !important;
        }
      }
    \`;

    document.head.appendChild(style);
  }

  function cardContains(card, value) {
    return (card.textContent || "").indexOf(value) !== -1;
  }

  function setPhoto(card, url) {
    card.classList.add("real-photo-game-card");
    card.style.backgroundImage =
      "linear-gradient(180deg, rgba(0,0,0,0.04), rgba(0,0,0,0.76)), url('" + url + "')";
  }

  function applyRealPhotos() {
    injectStyle();

    var cards = Array.prototype.slice.call(
      document.querySelectorAll(".game-card, .game-tile, .game-item, [data-game]")
    );

    cards.forEach(function (card) {
      var text = card.textContent || "";
      var dataGame = (card.getAttribute("data-game") || "").toLowerCase();

      if (cardContains(card, PERSIAN.poker) || dataGame.indexOf("poker") !== -1) setPhoto(card, PHOTOS.poker);
      if (cardContains(card, PERSIAN.chess) || dataGame.indexOf("chess") !== -1) setPhoto(card, PHOTOS.chess);
      if (cardContains(card, PERSIAN.mench) || dataGame.indexOf("mench") !== -1 || dataGame.indexOf("ludo") !== -1) setPhoto(card, PHOTOS.mench);
      if (cardContains(card, PERSIAN.backgammon) || dataGame.indexOf("backgammon") !== -1) setPhoto(card, PHOTOS.backgammon);
      if (cardContains(card, PERSIAN.hokm) || dataGame.indexOf("hokm") !== -1) setPhoto(card, PHOTOS.hokm);
      if (cardContains(card, PERSIAN.chaharBarg) || dataGame.indexOf("chahar") !== -1) setPhoto(card, PHOTOS.chaharBarg);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyRealPhotos);
  } else {
    applyRealPhotos();
  }

  setTimeout(applyRealPhotos, 500);
  setTimeout(applyRealPhotos, 1500);
})();
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
