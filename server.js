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

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false
});

const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || "poker-royale-secret-change-later",
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

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username VARCHAR(32) UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      chips INTEGER NOT NULL DEFAULT 1000,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database ready.");
}

async function getUserById(id) {
  const result = await pool.query(
    "SELECT id, username, chips FROM users WHERE id = $1",
    [id]
  );

  return result.rows[0] || null;
}

async function updateUserChips(userId, chips) {
  await pool.query(
    "UPDATE users SET chips = $1 WHERE id = $2",
    [chips, userId]
  );
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

    const existing = await pool.query(
      "SELECT id FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );

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
      "SELECT id, username, password_hash, chips FROM users WHERE LOWER(username) = LOWER($1)",
      [username]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    const validPassword = await bcrypt.compare(password, user.password_hash);

    if (!validPassword) {
      return res.status(400).json({ error: "Invalid username or password." });
    }

    req.session.userId = user.id;

    res.json({
      ok: true,
      user: { id: user.id, username: user.username, chips: user.chips }
    });
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
    if (!req.session.userId) {
      return res.json({ user: null });
    }

    const user = await getUserById(req.session.userId);

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

const rooms = {
  "royal-room": createRoom("royal-room", "Royal Room"),
  "vip-room": createRoom("vip-room", "VIP Room"),
  "beginner-room": createRoom("beginner-room", "Beginner Room")
};

function createRoom(id, name) {
  return {
    id,
    name,
    players: [],
    deck: [],
    communityCards: [],
    pot: 0,
    currentBet: 0,
    dealerIndex: -1,
    smallBlindIndex: -1,
    bigBlindIndex: -1,
    smallBlindAmount: 10,
    bigBlindAmount: 20,
    turnIndex: 0,
    phase: "waiting",
    status: "Waiting for players",
    handStarted: false
  };
}

function createDeck() {
  const suits = ["♠", "♥", "♦", "♣"];
  const ranks = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];
  const deck = [];

  for (const suit of suits) {
    for (const rank of ranks) {
      deck.push(rank + suit);
    }
  }

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
    playerCount: room.players.length,
    pot: room.pot,
    phase: room.phase,
    status: room.status
  }));
}

function getPublicRoomState(room) {
  return {
    id: room.id,
    name: room.name,
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
      isTurn: player.isTurn,
      status: player.status
    })),
    communityCards: room.communityCards,
    pot: room.pot,
    currentBet: room.currentBet,
    phase: room.phase,
    status: room.status
  };
}

function findPlayerLocation(socketId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.socketId === socketId);
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
    player.status = "Waiting";
    player.role = "";
    player.hasActed = false;
  });
}

function removePlayer(socketId) {
  for (const room of Object.values(rooms)) {
    const index = room.players.findIndex((p) => p.socketId === socketId);

    if (index !== -1) {
      const removedPlayer = room.players.splice(index, 1)[0];

      room.players.forEach((player, playerIndex) => {
        player.seat = playerIndex;
      });

      if (room.players.length < 2) {
        resetRoomToWaiting(room);
      } else {
        if (room.turnIndex >= room.players.length) room.turnIndex = 0;
        if (room.dealerIndex >= room.players.length) room.dealerIndex = -1;
        room.status = removedPlayer.name + " left the table";
      }

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

    if (player && player.chips > 0) return index;
  }

  return 0;
}

function getNextActionIndex(room, fromIndex) {
  if (!room.players.length) return 0;

  for (let i = 1; i <= room.players.length; i++) {
    const index = (fromIndex + i + room.players.length) % room.players.length;
    const player = room.players[index];

    if (player && !player.folded && !player.allIn && player.chips > 0) {
      return index;
    }
  }

  return -1;
}

function activePlayers(room) {
  return room.players.filter((player) => !player.folded);
}

function playersWhoCanAct(room) {
  return room.players.filter((player) => !player.folded && !player.allIn && player.chips > 0);
}

function onlyOnePlayerLeft(room) {
  return activePlayers(room).length <= 1;
}

function clearPlayerRoles(room) {
  room.players.forEach((player) => {
    player.role = "";
  });
}

function setupDealerAndBlinds(room) {
  clearPlayerRoles(room);

  room.dealerIndex = getNextPlayerIndex(room, room.dealerIndex);

  if (room.players.length === 2) {
    room.smallBlindIndex = room.dealerIndex;
    room.bigBlindIndex = getNextPlayerIndex(room, room.smallBlindIndex);
  } else {
    room.smallBlindIndex = getNextPlayerIndex(room, room.dealerIndex);
    room.bigBlindIndex = getNextPlayerIndex(room, room.smallBlindIndex);
  }

  if (room.players[room.dealerIndex]) {
    room.players[room.dealerIndex].role = "D";
  }

  if (room.players[room.smallBlindIndex]) {
    room.players[room.smallBlindIndex].role = room.players[room.smallBlindIndex].role
      ? room.players[room.smallBlindIndex].role + " / SB"
      : "SB";
  }

  if (room.players[room.bigBlindIndex]) {
    room.players[room.bigBlindIndex].role = "BB";
  }
}

async function takeChips(player, amount) {
  const realAmount = Math.max(0, Math.min(player.chips, amount));

  player.chips -= realAmount;
  player.bet += realAmount;
  player.committedThisHand += realAmount;

  if (player.chips === 0) {
    player.allIn = true;
  }

  await updateUserChips(player.userId, player.chips);
  return realAmount;
}

async function postBlind(room, playerIndex, amount, label) {
  const player = room.players[playerIndex];

  if (!player) {
    return { player: null, amount: 0, label };
  }

  const blindAmount = await takeChips(player, amount);

  player.status = label + " " + blindAmount;
  player.hasActed = false;
  room.pot += blindAmount;

  return { player, amount: blindAmount, label };
}

function bettingRoundComplete(room) {
  if (onlyOnePlayerLeft(room)) return true;

  const canAct = playersWhoCanAct(room);

  if (canAct.length === 0) {
    return true;
  }

  return canAct.every((player) => {
    return player.hasActed && player.bet >= room.currentBet;
  });
}

async function startHand(room) {
  const playablePlayers = room.players.filter((player) => player.chips > 0);

  if (playablePlayers.length < 2) {
    room.status = "Need at least 2 players with chips";
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
    player.cards = player.chips > 0 ? [room.deck.pop(), room.deck.pop()] : [];
    player.bet = 0;
    player.committedThisHand = 0;
    player.folded = player.chips <= 0;
    player.allIn = false;
    player.status = player.chips > 0 ? "In hand" : "No chips";
    player.isTurn = false;
    player.hasActed = false;
    player.role = "";
  });

  setupDealerAndBlinds(room);

  const smallBlind = await postBlind(room, room.smallBlindIndex, room.smallBlindAmount, "Small Blind");
  const bigBlind = await postBlind(room, room.bigBlindIndex, room.bigBlindAmount, "Big Blind");

  room.currentBet = Math.max(smallBlind.amount, bigBlind.amount);
  room.turnIndex = getNextActionIndex(room, room.bigBlindIndex);

  const sbName = smallBlind.player ? smallBlind.player.name : "Unknown";
  const bbName = bigBlind.player ? bigBlind.player.name : "Unknown";

  room.status =
    sbName +
    " posts SB " +
    smallBlind.amount +
    ", " +
    bbName +
    " posts BB " +
    bigBlind.amount;

  setCurrentTurn(room);
}

function setCurrentTurn(room) {
  room.players.forEach((player) => {
    player.isTurn = false;
  });

  if (onlyOnePlayerLeft(room)) {
    finishHand(room);
    return;
  }

  if (playersWhoCanAct(room).length === 0) {
    advancePhase(room);
    return;
  }

  if (
    room.turnIndex === -1 ||
    !room.players[room.turnIndex] ||
    room.players[room.turnIndex].folded ||
    room.players[room.turnIndex].allIn ||
    room.players[room.turnIndex].chips <= 0
  ) {
    room.turnIndex = getNextActionIndex(room, room.turnIndex);
  }

  const currentPlayer = room.players[room.turnIndex];

  if (currentPlayer) {
    currentPlayer.isTurn = true;
    room.status = currentPlayer.name + "'s turn";
  }
}

function nextTurn(room) {
  if (room.players.length < 2) {
    resetRoomToWaiting(room);
    return;
  }

  room.turnIndex = getNextActionIndex(room, room.turnIndex);
  setCurrentTurn(room);
}

function dealRemainingCommunityCards(room) {
  while (room.communityCards.length < 5 && room.deck.length > 0) {
    room.communityCards.push(room.deck.pop());
  }
}

function advancePhase(room) {
  if (onlyOnePlayerLeft(room)) {
    finishHand(room);
    return;
  }

  if (playersWhoCanAct(room).length === 0) {
    dealRemainingCommunityCards(room);
    finishHand(room);
    return;
  }

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

  room.players.forEach((player) => {
    player.bet = 0;
    player.hasActed = false;
  });

  if (playersWhoCanAct(room).length === 0) {
    dealRemainingCommunityCards(room);
    finishHand(room);
    return;
  }

  room.turnIndex = getNextActionIndex(room, room.dealerIndex);
  setCurrentTurn(room);
}

async function proceedAfterAction(room) {
  if (onlyOnePlayerLeft(room)) {
    await finishHand(room);
    return;
  }

  if (bettingRoundComplete(room)) {
    advancePhase(room);
    return;
  }

  nextTurn(room);
}

const HAND_RANKS = {
  HIGH_CARD: 1,
  ONE_PAIR: 2,
  TWO_PAIR: 3,
  THREE_OF_A_KIND: 4,
  STRAIGHT: 5,
  FLUSH: 6,
  FULL_HOUSE: 7,
  FOUR_OF_A_KIND: 8,
  STRAIGHT_FLUSH: 9,
  ROYAL_FLUSH: 10
};

const RANK_VALUES = {
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 10,
  "J": 11,
  "Q": 12,
  "K": 13,
  "A": 14
};

function parseCard(card) {
  const suit = card.slice(-1);
  const rank = card.slice(0, -1);

  return { card, rank, suit, value: RANK_VALUES[rank] };
}

function getCounts(values) {
  const counts = {};
  values.forEach((value) => {
    counts[value] = (counts[value] || 0) + 1;
  });
  return counts;
}

function getStraightHigh(values) {
  const unique = [...new Set(values)].sort((a, b) => b - a);

  if (unique.includes(14)) unique.push(1);

  for (let i = 0; i <= unique.length - 5; i++) {
    const slice = unique.slice(i, i + 5);

    if (
      slice[0] - 1 === slice[1] &&
      slice[1] - 1 === slice[2] &&
      slice[2] - 1 === slice[3] &&
      slice[3] - 1 === slice[4]
    ) {
      return slice[0];
    }
  }

  return null;
}

function evaluateSevenCards(cards) {
  const parsed = cards.map(parseCard);
  const values = parsed.map((card) => card.value).sort((a, b) => b - a);
  const counts = getCounts(values);

  const groups = Object.entries(counts)
    .map(([value, count]) => ({ value: Number(value), count }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return b.value - a.value;
    });

  const suits = {};

  parsed.forEach((card) => {
    if (!suits[card.suit]) suits[card.suit] = [];
    suits[card.suit].push(card.value);
  });

  let flushValues = null;

  Object.values(suits).forEach((suitValues) => {
    if (suitValues.length >= 5) {
      const sortedSuitValues = suitValues.sort((a, b) => b - a);
      if (!flushValues || sortedSuitValues[0] > flushValues[0]) {
        flushValues = sortedSuitValues;
      }
    }
  });

  if (flushValues) {
    const straightFlushHigh = getStraightHigh(flushValues);

    if (straightFlushHigh === 14) {
      return { rank: HAND_RANKS.ROYAL_FLUSH, name: "Royal Flush", values: [14] };
    }

    if (straightFlushHigh) {
      return { rank: HAND_RANKS.STRAIGHT_FLUSH, name: "Straight Flush", values: [straightFlushHigh] };
    }
  }

  const four = groups.find((group) => group.count === 4);

  if (four) {
    const kicker = values.find((value) => value !== four.value);
    return { rank: HAND_RANKS.FOUR_OF_A_KIND, name: "Four of a Kind", values: [four.value, kicker] };
  }

  const threeGroups = groups.filter((group) => group.count === 3);
  const pairGroups = groups.filter((group) => group.count === 2);

  if (threeGroups.length >= 1 && (pairGroups.length >= 1 || threeGroups.length >= 2)) {
    const three = threeGroups[0];
    const pair = pairGroups[0] || threeGroups[1];
    return { rank: HAND_RANKS.FULL_HOUSE, name: "Full House", values: [three.value, pair.value] };
  }

  if (flushValues) {
    return { rank: HAND_RANKS.FLUSH, name: "Flush", values: flushValues.slice(0, 5) };
  }

  const straightHigh = getStraightHigh(values);

  if (straightHigh) {
    return { rank: HAND_RANKS.STRAIGHT, name: "Straight", values: [straightHigh] };
  }

  if (threeGroups.length >= 1) {
    const three = threeGroups[0];
    const kickers = values.filter((value) => value !== three.value).slice(0, 2);
    return { rank: HAND_RANKS.THREE_OF_A_KIND, name: "Three of a Kind", values: [three.value, ...kickers] };
  }

  if (pairGroups.length >= 2) {
    const firstPair = pairGroups[0];
    const secondPair = pairGroups[1];
    const kicker = values.find((value) => value !== firstPair.value && value !== secondPair.value);
    return { rank: HAND_RANKS.TWO_PAIR, name: "Two Pair", values: [firstPair.value, secondPair.value, kicker] };
  }

  if (pairGroups.length === 1) {
    const pair = pairGroups[0];
    const kickers = values.filter((value) => value !== pair.value).slice(0, 3);
    return { rank: HAND_RANKS.ONE_PAIR, name: "One Pair", values: [pair.value, ...kickers] };
  }

  return { rank: HAND_RANKS.HIGH_CARD, name: "High Card", values: values.slice(0, 5) };
}

function compareHands(handA, handB) {
  if (handA.rank !== handB.rank) return handA.rank - handB.rank;

  for (let i = 0; i < Math.max(handA.values.length, handB.values.length); i++) {
    const valueA = handA.values[i] || 0;
    const valueB = handB.values[i] || 0;

    if (valueA !== valueB) return valueA - valueB;
  }

  return 0;
}

function getPlayerHand(player, room) {
  return evaluateSevenCards([...(player.cards || []), ...room.communityCards]);
}

function getBestPlayersForPot(eligiblePlayers, room) {
  let bestHand = null;
  let winners = [];

  eligiblePlayers.forEach((player) => {
    const hand = getPlayerHand(player, room);

    if (!bestHand || compareHands(hand, bestHand) > 0) {
      bestHand = hand;
      winners = [player];
    } else if (compareHands(hand, bestHand) === 0) {
      winners.push(player);
    }
  });

  return { winners, hand: bestHand };
}

function buildSidePots(room) {
  const committedPlayers = room.players
    .filter((player) => (player.committedThisHand || 0) > 0)
    .map((player) => ({ player, committed: player.committedThisHand || 0 }))
    .sort((a, b) => a.committed - b.committed);

  const levels = [...new Set(committedPlayers.map((item) => item.committed))];
  const sidePots = [];
  let previousLevel = 0;

  levels.forEach((level) => {
    const contributors = room.players.filter((player) => (player.committedThisHand || 0) >= level);
    const amount = (level - previousLevel) * contributors.length;
    const eligiblePlayers = contributors.filter((player) => !player.folded);

    if (amount > 0 && eligiblePlayers.length > 0) {
      sidePots.push({ amount, eligiblePlayers });
    }

    previousLevel = level;
  });

  return sidePots;
}

function splitAmount(amount, winners) {
  const baseShare = Math.floor(amount / winners.length);
  let remainder = amount % winners.length;

  return winners.map((winner) => {
    const extra = remainder > 0 ? 1 : 0;
    if (remainder > 0) remainder--;

    return {
      player: winner,
      amount: baseShare + extra
    };
  });
}

async function finishHand(room) {
  const remainingPlayers = room.players.filter((player) => !player.folded);

  if (remainingPlayers.length === 0) {
    resetRoomToWaiting(room);
    return;
  }

  const resultMessages = [];

  if (remainingPlayers.length === 1) {
    const winner = remainingPlayers[0];
    winner.chips += room.pot;
    resultMessages.push(winner.name + " wins " + room.pot + " because everyone else folded.");
  } else {
    if (room.communityCards.length < 5) {
      dealRemainingCommunityCards(room);
    }

    const sidePots = buildSidePots(room);

    sidePots.forEach((sidePot, index) => {
      const result = getBestPlayersForPot(sidePot.eligiblePlayers, room);
      const payouts = splitAmount(sidePot.amount, result.winners);

      payouts.forEach((payout) => {
        payout.player.chips += payout.amount;
      });

      const winnerNames = result.winners.map((player) => player.name).join(" & ");
      const potLabel = index === 0 ? "main pot" : "side pot " + index;

      resultMessages.push(
        winnerNames +
        " win " +
        sidePot.amount +
        " from " +
        potLabel +
        " with " +
        result.hand.name
      );
    });
  }

  room.status = resultMessages.join(" | ");
  room.phase = "showdown";
  room.handStarted = false;

  room.players.forEach((player) => {
    player.isTurn = false;
    player.status = remainingPlayers.includes(player) ? "Showdown" : "Folded";
  });

  for (const player of room.players) {
    await updateUserChips(player.userId, player.chips);
  }

  io.to(room.id).emit("gameMessage", room.status);
  emitRoom(room);

  setTimeout(async () => {
    if (room.players.filter((player) => player.chips > 0).length >= 2) {
      await startHand(room);
      emitRoom(room);
    } else {
      resetRoomToWaiting(room);
      emitRoom(room);
    }
  }, 7000);
}

function emitPrivateCards(room) {
  room.players.forEach((player) => {
    io.to(player.socketId).emit("privateCards", player.cards || []);
  });
}

function emitRoom(room) {
  io.to(room.id).emit("roomState", getPublicRoomState(room));
  emitPrivateCards(room);
  io.emit("roomsUpdate", getPublicRooms());
}

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en" dir="ltr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>Poker Royale</title>

  <style>
    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, sans-serif;
      background: radial-gradient(circle at top, #0f5132 0%, #07150d 45%, #020403 100%);
      color: white;
      overflow-x: hidden;
      padding-bottom: calc(118px + env(safe-area-inset-bottom));
    }

    body.rtl { direction: rtl; font-family: Arial, Tahoma, sans-serif; }

    .app { width: 100%; max-width: 1100px; margin: 0 auto; padding: 16px; }

    .top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 10px;
    }

    .logo {
      color: #facc15;
      font-size: 28px;
      font-weight: 900;
      text-shadow: 0 0 20px rgba(250, 204, 21, 0.65);
    }

    .lang-btn {
      border: 1px solid rgba(250, 204, 21, 0.45);
      background: rgba(0, 0, 0, 0.45);
      color: #facc15;
      border-radius: 999px;
      padding: 9px 13px;
      font-weight: 900;
      cursor: pointer;
    }

    .auth-panel {
      background: rgba(0,0,0,0.46);
      border: 1px solid rgba(250,204,21,0.24);
      border-radius: 18px;
      padding: 14px;
      margin-bottom: 14px;
    }

    .auth-grid {
      display: grid;
      grid-template-columns: 1fr 1fr auto auto;
      gap: 8px;
      align-items: center;
    }

    .input {
      width: 100%;
      border: 1px solid rgba(250, 204, 21, 0.35);
      background: rgba(0, 0, 0, 0.45);
      color: white;
      border-radius: 12px;
      padding: 12px;
      outline: none;
      font-size: 15px;
    }

    .small-btn {
      border: none;
      border-radius: 12px;
      padding: 12px;
      color: white;
      background: #166534;
      font-weight: 900;
      cursor: pointer;
    }

    .register-btn { background: #ca8a04; color: #111827; }
    .logout-btn { background: #991b1b; }

    .user-card {
      display: none;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
    }

    .user-info strong { color: #facc15; }

    .top-status {
      margin: 12px auto;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
    }

    .status-pill {
      background: rgba(0, 0, 0, 0.42);
      border: 1px solid rgba(250, 204, 21, 0.28);
      border-radius: 12px;
      padding: 9px 8px;
      font-size: 12px;
      color: #d1d5db;
    }

    .status-pill strong { color: #facc15; }

    .main-layout {
      display: grid;
      grid-template-columns: 270px 1fr;
      gap: 16px;
      align-items: start;
    }

    .panel {
      background: rgba(0, 0, 0, 0.44);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      padding: 14px;
    }

    .panel h2 { margin: 0 0 12px; color: #facc15; font-size: 17px; }

    .room-card {
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 10px;
      cursor: pointer;
    }

    .room-card.active {
      border-color: #facc15;
      background: rgba(250, 204, 21, 0.12);
    }

    .room-title { font-weight: 900; margin-bottom: 5px; }
    .room-meta { color: #d1d5db; font-size: 12px; line-height: 1.55; }

    .poker-table {
      position: relative;
      min-height: 560px;
      border-radius: 48%;
      background: radial-gradient(circle at center, #15803d 0%, #166534 45%, #052e16 100%);
      border: 12px solid #7c2d12;
      box-shadow: inset 0 0 48px rgba(0,0,0,0.56), 0 25px 70px rgba(0,0,0,0.55);
      overflow: hidden;
    }

    .table-line {
      position: absolute;
      inset: 32px;
      border-radius: 48%;
      border: 2px dashed rgba(250, 204, 21, 0.32);
      pointer-events: none;
    }

    .dealer {
      position: absolute;
      top: 38px;
      left: 50%;
      transform: translateX(-50%);
      background: #facc15;
      color: #111827;
      padding: 7px 14px;
      border-radius: 999px;
      font-weight: 900;
      font-size: 13px;
      z-index: 7;
    }

    .community {
      position: absolute;
      top: 185px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 8;
    }

    .card {
      width: 52px;
      height: 74px;
      background: #fff;
      color: #111827;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 20px;
      box-shadow: 0 12px 22px rgba(0,0,0,0.38);
    }

    .card.red { color: #dc2626; }

    .card.back {
      background: linear-gradient(135deg, #991b1b, #450a0a);
      color: #facc15;
      border: 2px solid rgba(250, 204, 21, 0.8);
    }

    .pot {
      position: absolute;
      top: 282px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0,0,0,0.58);
      border: 1px solid rgba(250,204,21,0.55);
      border-radius: 18px;
      padding: 10px 18px;
      color: #facc15;
      font-weight: 900;
      z-index: 8;
    }

    .turn-status {
      position: absolute;
      top: 340px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(2,6,23,0.68);
      border: 1px solid rgba(34,197,94,0.5);
      border-radius: 14px;
      padding: 10px 14px;
      min-width: 230px;
      color: #bbf7d0;
      text-align: center;
      font-size: 13px;
      z-index: 8;
    }

    .my-cards {
      position: absolute;
      bottom: 105px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 8px;
      z-index: 12;
    }

    .player {
      position: absolute;
      width: 118px;
      text-align: center;
      z-index: 10;
    }

    .avatar {
      width: 58px;
      height: 58px;
      margin: 0 auto 5px;
      border-radius: 50%;
      background: radial-gradient(circle at top, #facc15, #a16207);
      border: 3px solid #fff7ed;
      color: #111827;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 21px;
    }

    .player.turn .avatar {
      box-shadow: 0 0 0 4px rgba(34,197,94,0.55), 0 0 24px rgba(34,197,94,0.65);
    }

    .player.folded { opacity: 0.45; }

    .player-name {
      background: rgba(0,0,0,0.7);
      border-radius: 999px;
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 900;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .role-badge {
      display: inline-block;
      margin-top: 3px;
      background: #facc15;
      color: #111827;
      border-radius: 999px;
      padding: 3px 7px;
      font-size: 10px;
      font-weight: 900;
    }

    .chips { margin-top: 4px; color: #facc15; font-size: 12px; }
    .bet { margin-top: 2px; color: #93c5fd; font-size: 11px; }

    .seat-0 { left: 50%; bottom: 24px; transform: translateX(-50%); }
    .seat-1 { left: 48px; bottom: 115px; }
    .seat-2 { left: 48px; top: 100px; }
    .seat-3 { right: 48px; top: 100px; }
    .seat-4 { right: 48px; bottom: 115px; }
    .seat-5 { left: 50%; top: 72px; transform: translateX(-50%); }

    .actions {
      position: fixed;
      left: 50%;
      transform: translateX(-50%);
      bottom: calc(14px + env(safe-area-inset-bottom));
      z-index: 2000;
      display: flex;
      justify-content: center;
      gap: 8px;
      flex-wrap: wrap;
      width: min(96%, 620px);
      background: rgba(0,0,0,0.5);
      border: 1px solid rgba(250,204,21,0.25);
      border-radius: 22px;
      padding: 10px;
      backdrop-filter: blur(10px);
    }

    .btn {
      border: none;
      border-radius: 999px;
      padding: 12px 14px;
      min-width: 78px;
      color: white;
      font-weight: 900;
      cursor: pointer;
      font-size: 13px;
    }

    .btn:disabled { opacity: 0.42; cursor: not-allowed; }

    .fold { background: #991b1b; }
    .call { background: #166534; }
    .raise { background: #ca8a04; color: #111827; }
    .allin { background: #7c3aed; }
    .start { background: #2563eb; }

    .log {
      margin-top: 14px;
      background: rgba(0,0,0,0.42);
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 16px;
      padding: 12px;
      font-size: 13px;
      color: #d1d5db;
      max-height: 170px;
      overflow-y: auto;
      line-height: 1.55;
    }

    .log-item {
      border-bottom: 1px solid rgba(255,255,255,0.08);
      padding: 5px 0;
    }

    @media (max-width: 850px) {
      .auth-grid { grid-template-columns: 1fr; }
      .main-layout { grid-template-columns: 1fr; }
      .top-status { grid-template-columns: 1fr; }
      .logo { font-size: 24px; }
      .poker-table { min-height: 520px; border-width: 8px; }
      .community { top: 178px; gap: 6px; }
      .card { width: 43px; height: 62px; font-size: 17px; }
      .pot { top: 260px; }
      .turn-status { top: 314px; min-width: 215px; }
      .my-cards { bottom: 100px; }
      .player { width: 100px; }
      .avatar { width: 50px; height: 50px; }
      .seat-0 { left: 50%; bottom: 22px; transform: translateX(-50%); }
      .seat-1 { left: 10px; bottom: 112px; }
      .seat-2 { left: 10px; top: 108px; }
      .seat-3 { right: 10px; top: 108px; }
      .seat-4 { right: 10px; bottom: 112px; }
      .seat-5 { left: 50%; top: 66px; transform: translateX(-50%); }
      .btn { min-width: 68px; padding: 10px 10px; font-size: 12px; }
    }
  </style>
</head>

<body>
  <div class="app">
    <div class="top-row">
      <div class="logo">♠ Poker Royale ♣</div>
      <button class="lang-btn" id="langBtn">FA</button>
    </div>

    <div class="auth-panel">
      <div id="authForm" class="auth-grid">
        <input id="authUsername" class="input" placeholder="Username" />
        <input id="authPassword" class="input" type="password" placeholder="Password" />
        <button class="small-btn" id="loginBtn">Login</button>
        <button class="small-btn register-btn" id="registerBtn">Register</button>
      </div>

      <div id="userCard" class="user-card">
        <div class="user-info">
          <div>Welcome, <strong id="panelUsername">Player</strong></div>
          <div>Chips: <strong id="panelChips">0</strong></div>
        </div>
        <button class="small-btn logout-btn" id="logoutBtn">Logout</button>
      </div>
    </div>

    <div class="top-status">
      <div class="status-pill">Connection: <strong id="connectionStatus">Connecting...</strong></div>
      <div class="status-pill">Online: <strong id="onlineCount">0</strong></div>
      <div class="status-pill">Phase: <strong id="phaseStatus">waiting</strong></div>
    </div>

    <div class="main-layout">
      <aside class="panel">
        <h2>Lobby Rooms</h2>
        <div id="rooms"></div>
      </aside>

      <main>
        <div class="poker-table">
          <div class="table-line"></div>
          <div class="dealer">DEALER</div>

          <div class="community" id="communityCards">
            <div class="card back">♠</div>
            <div class="card back">♥</div>
            <div class="card back">♦</div>
            <div class="card back">♣</div>
            <div class="card back">★</div>
          </div>

          <div class="pot" id="potDisplay">POT: 0</div>
          <div class="turn-status" id="turnStatus">Login first, then choose a room</div>
          <div class="my-cards" id="myCards"></div>
          <div id="players"></div>
        </div>

        <div class="log" id="gameLog">
          <div class="log-item">Welcome to Poker Royale.</div>
        </div>
      </main>
    </div>
  </div>

  <div class="actions">
    <button class="btn start" id="startBtn" disabled>Start</button>
    <button class="btn fold" id="foldBtn" disabled>Fold</button>
    <button class="btn call" id="callBtn" disabled>Call / Check</button>
    <button class="btn raise" id="raiseBtn" disabled>Raise</button>
    <button class="btn allin" id="allInBtn" disabled>All-in</button>
  </div>

  <script src="/socket.io/socket.io.js"></script>

  <script>
    const socket = io();

    let currentUser = null;
    let currentRoomId = null;
    let joined = false;
    let latestRoom = null;
    let currentLang = localStorage.getItem("pokerLang") || "en";

    const text = {
      en: {
        langButton: "FA",
        loginFirst: "Login first, then choose a room",
        username: "Username",
        password: "Password",
        login: "Login",
        register: "Register",
        logout: "Logout",
        needLogin: "Please login or register first.",
        joined: "You joined",
        raiseAmount: "Raise to amount:",
        you: "You",
        bet: "Bet",
        committed: "Committed",
        pot: "POT",
        callCheck: "Call / Check",
        start: "Start",
        fold: "Fold",
        raise: "Raise",
        allIn: "All-in"
      },
      fa: {
        langButton: "EN",
        loginFirst: "اول وارد حساب شو، بعد اتاق انتخاب کن",
        username: "نام کاربری",
        password: "رمز عبور",
        login: "ورود",
        register: "ثبت‌نام",
        logout: "خروج",
        needLogin: "اول وارد حساب شو یا ثبت‌نام کن.",
        joined: "وارد شدی به",
        raiseAmount: "افزایش تا مبلغ:",
        you: "شما",
        bet: "شرط",
        committed: "کل شرط",
        pot: "پات",
        callCheck: "کال / چک",
        start: "شروع",
        fold: "انصراف",
        raise: "افزایش",
        allIn: "آل این"
      }
    };

    const langBtn = document.getElementById("langBtn");
    const authForm = document.getElementById("authForm");
    const userCard = document.getElementById("userCard");
    const authUsername = document.getElementById("authUsername");
    const authPassword = document.getElementById("authPassword");
    const loginBtn = document.getElementById("loginBtn");
    const registerBtn = document.getElementById("registerBtn");
    const logoutBtn = document.getElementById("logoutBtn");
    const panelUsername = document.getElementById("panelUsername");
    const panelChips = document.getElementById("panelChips");

    const connectionStatus = document.getElementById("connectionStatus");
    const onlineCount = document.getElementById("onlineCount");
    const phaseStatus = document.getElementById("phaseStatus");
    const roomsEl = document.getElementById("rooms");
    const playersEl = document.getElementById("players");
    const communityCardsEl = document.getElementById("communityCards");
    const myCardsEl = document.getElementById("myCards");
    const potDisplay = document.getElementById("potDisplay");
    const turnStatus = document.getElementById("turnStatus");
    const gameLog = document.getElementById("gameLog");

    const startBtn = document.getElementById("startBtn");
    const foldBtn = document.getElementById("foldBtn");
    const callBtn = document.getElementById("callBtn");
    const raiseBtn = document.getElementById("raiseBtn");
    const allInBtn = document.getElementById("allInBtn");

    function tr() {
      return text[currentLang];
    }

    function applyLanguage() {
      document.documentElement.lang = currentLang;
      document.documentElement.dir = currentLang === "fa" ? "rtl" : "ltr";
      document.body.classList.toggle("rtl", currentLang === "fa");

      langBtn.textContent = tr().langButton;
      authUsername.placeholder = tr().username;
      authPassword.placeholder = tr().password;
      loginBtn.textContent = tr().login;
      registerBtn.textContent = tr().register;
      logoutBtn.textContent = tr().logout;
      startBtn.textContent = tr().start;
      foldBtn.textContent = tr().fold;
      callBtn.textContent = tr().callCheck;
      raiseBtn.textContent = tr().raise;
      allInBtn.textContent = tr().allIn;

      if (!joined) {
        turnStatus.textContent = tr().loginFirst;
      }

      if (latestRoom) {
        updateTableText(latestRoom);
        renderPlayers(latestRoom.players);
      }
    }

    langBtn.onclick = function() {
      currentLang = currentLang === "en" ? "fa" : "en";
      localStorage.setItem("pokerLang", currentLang);
      applyLanguage();
    };

    function addLog(message) {
      const item = document.createElement("div");
      item.className = "log-item";
      item.textContent = message;
      gameLog.prepend(item);
    }

    async function api(path, body) {
      const response = await fetch(path, {
        method: body ? "POST" : "GET",
        headers: body ? { "Content-Type": "application/json" } : {},
        body: body ? JSON.stringify(body) : undefined
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed.");
      }

      return data;
    }

    async function loadMe() {
      const data = await api("/api/me");
      currentUser = data.user;
      updateUserPanel();
    }

    function updateUserPanel() {
      if (currentUser) {
        authForm.style.display = "none";
        userCard.style.display = "flex";
        panelUsername.textContent = currentUser.username;
        panelChips.textContent = currentUser.chips;
      } else {
        authForm.style.display = "grid";
        userCard.style.display = "none";
      }
    }

    loginBtn.onclick = async function() {
      try {
        const data = await api("/api/login", {
          username: authUsername.value,
          password: authPassword.value
        });

        currentUser = data.user;
        updateUserPanel();
        addLog("Logged in as " + currentUser.username);
      } catch (error) {
        alert(error.message);
      }
    };

    registerBtn.onclick = async function() {
      try {
        const data = await api("/api/register", {
          username: authUsername.value,
          password: authPassword.value
        });

        currentUser = data.user;
        updateUserPanel();
        addLog("Registered as " + currentUser.username);
      } catch (error) {
        alert(error.message);
      }
    };

    logoutBtn.onclick = async function() {
      await api("/api/logout", {});
      currentUser = null;
      joined = false;
      currentRoomId = null;
      latestRoom = null;
      updateUserPanel();
      updateButtons(null);
      playersEl.innerHTML = "";
      myCardsEl.innerHTML = "";
      turnStatus.textContent = tr().loginFirst;
      addLog("Logged out.");
    };

    function cardIsRed(card) {
      return card.includes("♥") || card.includes("♦");
    }

    function renderCard(card) {
      if (!card) return '<div class="card back">★</div>';

      const redClass = cardIsRed(card) ? " red" : "";
      return '<div class="card' + redClass + '">' + card + '</div>';
    }

    function renderRooms(rooms) {
      roomsEl.innerHTML = "";

      rooms.forEach(function(room) {
        const card = document.createElement("div");
        card.className = "room-card" + (room.id === currentRoomId ? " active" : "");

        card.innerHTML =
          '<div class="room-title">' + room.name + '</div>' +
          '<div class="room-meta">' +
          'Players: ' + room.playerCount + '/6<br />' +
          'Pot: ' + room.pot + '<br />' +
          'Phase: ' + room.phase + '<br />' +
          'Status: ' + room.status +
          '</div>';

        card.onclick = function() {
          if (!currentUser) {
            alert(tr().needLogin);
            return;
          }

          currentRoomId = room.id;
          socket.emit("joinRoom", { roomId: room.id });
        };

        roomsEl.appendChild(card);
      });
    }

    function renderPlayers(players) {
      playersEl.innerHTML = "";

      players.forEach(function(player, index) {
        const el = document.createElement("div");
        let className = "player seat-" + index;

        if (player.isTurn) className += " turn";
        if (player.folded) className += " folded";

        el.className = className;

        const initial = player.name ? player.name.charAt(0).toUpperCase() : "?";
        const youLabel = currentUser && player.userId === currentUser.id ? " (" + tr().you + ")" : "";
        const roleHtml = player.role ? '<div class="role-badge">' + player.role + '</div>' : "";
        const allInHtml = player.allIn ? '<div class="role-badge">ALL-IN</div>' : "";

        el.innerHTML =
          '<div class="avatar">' + initial + '</div>' +
          '<div class="player-name">' + player.name + youLabel + '</div>' +
          roleHtml +
          allInHtml +
          '<div class="chips">🟡 ' + player.chips + '</div>' +
          '<div class="bet">' + tr().bet + ': ' + player.bet + '</div>' +
          '<div class="bet">' + tr().committed + ': ' + player.committedThisHand + '</div>';

        playersEl.appendChild(el);
      });
    }

    function renderCommunity(cards) {
      let html = "";

      for (let i = 0; i < 5; i++) {
        html += renderCard(cards[i]);
      }

      communityCardsEl.innerHTML = html;
    }

    function renderMyCards(cards) {
      if (!cards || cards.length === 0) {
        myCardsEl.innerHTML = "";
        return;
      }

      myCardsEl.innerHTML = renderCard(cards[0]) + renderCard(cards[1]);
    }

    function updateTableText(room) {
      potDisplay.textContent = tr().pot + ": " + room.pot;
      turnStatus.textContent = room.status;
      phaseStatus.textContent = room.phase;
    }

    function updateButtons(room) {
      startBtn.disabled = !joined;

      if (!room || !joined || !currentUser) {
        foldBtn.disabled = true;
        callBtn.disabled = true;
        raiseBtn.disabled = true;
        allInBtn.disabled = true;
        return;
      }

      const me = room.players.find(function(player) {
        return player.userId === currentUser.id;
      });

      const isMyTurn = me && me.isTurn && !me.folded && !me.allIn && room.phase !== "waiting" && room.phase !== "showdown";

      foldBtn.disabled = !isMyTurn;
      callBtn.disabled = !isMyTurn;
      raiseBtn.disabled = !isMyTurn;
      allInBtn.disabled = !isMyTurn;
    }

    socket.on("connect", function() {
      connectionStatus.textContent = "Connected";
      connectionStatus.style.color = "#22c55e";
      addLog("Connected.");
    });

    socket.on("disconnect", function() {
      connectionStatus.textContent = "Disconnected";
      connectionStatus.style.color = "#ef4444";
      updateButtons(null);
    });

    socket.on("onlineCount", function(count) {
      onlineCount.textContent = count;
    });

    socket.on("roomsUpdate", function(rooms) {
      renderRooms(rooms);
    });

    socket.on("roomJoined", function(room) {
      joined = true;
      latestRoom = room;
      currentRoomId = room.id;

      updateTableText(room);
      renderPlayers(room.players);
      renderCommunity(room.communityCards);
      updateButtons(room);

      addLog(tr().joined + " " + room.name);
    });

    socket.on("roomState", function(room) {
      if (!currentRoomId || room.id !== currentRoomId) return;

      latestRoom = room;

      updateTableText(room);
      renderPlayers(room.players);
      renderCommunity(room.communityCards);
      updateButtons(room);
    });

    socket.on("privateCards", function(cards) {
      renderMyCards(cards);
    });

    socket.on("gameMessage", async function(message) {
      addLog(message);

      try {
        await loadMe();
      } catch (e) {}
    });

    startBtn.onclick = function() {
      if (!joined || !currentRoomId) return;
      socket.emit("startHand", { roomId: currentRoomId });
    };

    foldBtn.onclick = function() {
      if (!joined || !currentRoomId) return;
      socket.emit("playerAction", { roomId: currentRoomId, action: "Fold" });
    };

    callBtn.onclick = function() {
      if (!joined || !currentRoomId) return;
      socket.emit("playerAction", { roomId: currentRoomId, action: "Call" });
    };

    raiseBtn.onclick = function() {
      if (!joined || !currentRoomId) return;

      const amount = prompt(tr().raiseAmount, "50");

      if (!amount) return;

      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Raise",
        amount: Number(amount)
      });
    };

    allInBtn.onclick = function() {
      if (!joined || !currentRoomId) return;
      socket.emit("playerAction", { roomId: currentRoomId, action: "AllIn" });
    };

    applyLanguage();
    loadMe().catch(() => {});
  </script>
</body>
</html>
  `);
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  io.emit("onlineCount", io.engine.clientsCount);
  socket.emit("roomsUpdate", getPublicRooms());

  socket.on("joinRoom", async ({ roomId }) => {
    try {
      const session = socket.request.session;

      if (!session || !session.userId) {
        socket.emit("gameMessage", "Please login first.");
        return;
      }

      const user = await getUserById(session.userId);

      if (!user) {
        socket.emit("gameMessage", "User not found. Please login again.");
        return;
      }

      const room = rooms[roomId];

      if (!room) {
        socket.emit("gameMessage", "Room not found.");
        return;
      }

      const existing = findPlayerLocation(socket.id);

      if (existing) {
        socket.leave(existing.room.id);
        removePlayer(socket.id);
        emitRoom(existing.room);
      }

      const alreadyInRoom = room.players.find((p) => p.userId === user.id);

      if (alreadyInRoom) {
        socket.emit("gameMessage", "This account is already seated in this room.");
        return;
      }

      if (room.players.length >= 6) {
        socket.emit("gameMessage", "This room is full.");
        return;
      }

      if (user.chips <= 0) {
        socket.emit("gameMessage", "You do not have enough chips to sit.");
        return;
      }

      const player = {
        socketId: socket.id,
        userId: user.id,
        name: user.username,
        chips: user.chips,
        seat: room.players.length,
        cards: [],
        bet: 0,
        committedThisHand: 0,
        role: "",
        folded: false,
        allIn: false,
        isTurn: false,
        hasActed: false,
        status: "Waiting"
      };

      room.players.push(player);
      room.status = user.username + " joined the table";

      socket.join(room.id);

      socket.emit("roomJoined", getPublicRoomState(room));
      io.to(room.id).emit("gameMessage", user.username + " joined " + room.name + ".");

      emitRoom(room);
    } catch (error) {
      console.error("Join room error:", error);
      socket.emit("gameMessage", "Failed to join room.");
    }
  });

  socket.on("startHand", async ({ roomId }) => {
    try {
      const room = rooms[roomId];

      if (!room) return;

      const player = room.players.find((p) => p.socketId === socket.id);

      if (!player) {
        socket.emit("gameMessage", "Join a room first.");
        return;
      }

      if (room.players.filter((p) => p.chips > 0).length < 2) {
        socket.emit("gameMessage", "Need at least 2 players with chips to start.");
        return;
      }

      await startHand(room);
      io.to(room.id).emit("gameMessage", room.status);
      emitRoom(room);
    } catch (error) {
      console.error("Start hand error:", error);
      socket.emit("gameMessage", "Failed to start hand.");
    }
  });

  socket.on("playerAction", async ({ roomId, action, amount }) => {
    try {
      const room = rooms[roomId];

      if (!room) return;

      const player = room.players.find((p) => p.socketId === socket.id);

      if (!player) {
        socket.emit("gameMessage", "You are not seated in this room.");
        return;
      }

      if (room.phase === "waiting" || room.phase === "showdown") {
        socket.emit("gameMessage", "Hand is not active.");
        return;
      }

      if (!player.isTurn) {
        socket.emit("gameMessage", "It is not your turn.");
        return;
      }

      if (player.allIn || player.folded) {
        socket.emit("gameMessage", "You cannot act now.");
        return;
      }

      if (action === "Fold") {
        player.folded = true;
        player.hasActed = true;
        player.status = "Folded";
        room.status = player.name + " folded";
        io.to(room.id).emit("gameMessage", player.name + " folded.");
        await proceedAfterAction(room);
        emitRoom(room);
        return;
      }

      if (action === "Call") {
        const callAmount = Math.max(0, room.currentBet - player.bet);
        const paidAmount = await takeChips(player, callAmount);

        room.pot += paidAmount;
        player.hasActed = true;

        if (paidAmount < callAmount && player.allIn) {
          player.status = "All-in";
          room.status = player.name + " calls all-in for " + paidAmount;
          io.to(room.id).emit("gameMessage", player.name + " calls all-in for " + paidAmount + ".");
        } else if (callAmount === 0) {
          player.status = "Checked";
          room.status = player.name + " checked";
          io.to(room.id).emit("gameMessage", player.name + " checked.");
        } else {
          player.status = "Called";
          room.status = player.name + " called " + paidAmount;
          io.to(room.id).emit("gameMessage", player.name + " called " + paidAmount + ".");
        }

        await proceedAfterAction(room);
        emitRoom(room);
        return;
      }

      if (action === "Raise") {
        const raiseToAmount = Number(amount);

        if (!Number.isFinite(raiseToAmount) || raiseToAmount <= room.currentBet) {
          socket.emit("gameMessage", "Raise must be higher than current bet.");
          return;
        }

        const neededAmount = raiseToAmount - player.bet;

        if (neededAmount <= 0) {
          socket.emit("gameMessage", "Invalid raise amount.");
          return;
        }

        if (player.chips < neededAmount) {
          socket.emit("gameMessage", "Not enough chips. Use All-in instead.");
          return;
        }

        const paidAmount = await takeChips(player, neededAmount);

        room.pot += paidAmount;
        room.currentBet = raiseToAmount;

        room.players.forEach((p) => {
          if (!p.folded && !p.allIn && p.chips > 0) {
            p.hasActed = false;
          }
        });

        player.hasActed = true;
        player.status = player.allIn ? "All-in Raise" : "Raised";
        room.status = player.name + " raised to " + raiseToAmount;

        io.to(room.id).emit("gameMessage", player.name + " raised to " + raiseToAmount + ".");

        await proceedAfterAction(room);
        emitRoom(room);
        return;
      }

      if (action === "AllIn") {
        const allInBefore = player.chips;
        const targetBet = player.bet + allInBefore;
        const paidAmount = await takeChips(player, allInBefore);

        room.pot += paidAmount;
        player.hasActed = true;
        player.status = "All-in";

        if (targetBet > room.currentBet) {
          room.currentBet = targetBet;

          room.players.forEach((p) => {
            if (!p.folded && !p.allIn && p.chips > 0) {
              p.hasActed = false;
            }
          });

          player.hasActed = true;
          room.status = player.name + " goes all-in raising to " + targetBet;
          io.to(room.id).emit("gameMessage", player.name + " goes all-in raising to " + targetBet + ".");
        } else {
          room.status = player.name + " goes all-in for " + paidAmount;
          io.to(room.id).emit("gameMessage", player.name + " goes all-in for " + paidAmount + ".");
        }

        await proceedAfterAction(room);
        emitRoom(room);
        return;
      }
    } catch (error) {
      console.error("Player action error:", error);
      socket.emit("gameMessage", "Action failed.");
    }
  });

  socket.on("disconnect", () => {
    console.log("Disconnected:", socket.id);

    const result = removePlayer(socket.id);

    if (result) {
      io.to(result.room.id).emit("gameMessage", result.removedPlayer.name + " left the table.");
      emitRoom(result.room);
    }

    io.emit("onlineCount", io.engine.clientsCount);
  });
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log("Poker Royale server running on port " + PORT);
    });
  })
  .catch((error) => {
    console.error("Database init failed:", error);
    process.exit(1);
  });
