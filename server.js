const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;

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
    currentBet: 20,
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

function sanitizePlayerName(name) {
  if (!name || typeof name !== "string") return "Player";
  return name.trim().slice(0, 14) || "Player";
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
      name: player.name,
      chips: player.chips,
      seat: player.seat,
      bet: player.bet,
      folded: player.folded,
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

    if (player) {
      return { room, player };
    }
  }

  return null;
}

function resetRoomToWaiting(room) {
  room.deck = [];
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 20;
  room.turnIndex = 0;
  room.phase = "waiting";
  room.status = "Waiting for players";
  room.handStarted = false;

  room.players.forEach((player) => {
    player.cards = [];
    player.bet = 0;
    player.folded = false;
    player.isTurn = false;
    player.status = "Waiting";
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
        if (room.turnIndex >= room.players.length) {
          room.turnIndex = 0;
        }

        room.status = removedPlayer.name + " left the table";
      }

      return { room, removedPlayer };
    }
  }

  return null;
}

function startHand(room) {
  if (room.players.length < 2) {
    room.status = "Need at least 2 players";
    room.phase = "waiting";
    room.handStarted = false;
    return;
  }

  room.deck = shuffle(createDeck());
  room.communityCards = [];
  room.pot = 0;
  room.currentBet = 20;
  room.phase = "preflop";
  room.handStarted = true;
  room.turnIndex = 0;
  room.status = "New hand started";

  room.players.forEach((player, index) => {
    player.cards = [room.deck.pop(), room.deck.pop()];
    player.bet = 0;
    player.folded = false;
    player.status = "In hand";
    player.isTurn = index === room.turnIndex;
  });

  setCurrentTurn(room);
}

function setCurrentTurn(room) {
  room.players.forEach((player) => {
    player.isTurn = false;
  });

  const activePlayers = room.players.filter((player) => !player.folded && player.chips > 0);

  if (activePlayers.length <= 1) {
    finishHand(room);
    return;
  }

  let safety = 0;

  while (
    room.players[room.turnIndex] &&
    (room.players[room.turnIndex].folded || room.players[room.turnIndex].chips <= 0) &&
    safety < room.players.length
  ) {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    safety++;
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

  room.turnIndex = (room.turnIndex + 1) % room.players.length;
  setCurrentTurn(room);
}

function advancePhase(room) {
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

  room.currentBet = 20;

  room.players.forEach((player) => {
    player.bet = 0;
  });

  room.turnIndex = 0;
  setCurrentTurn(room);
}

/**
 * Texas Hold'em Hand Evaluator
 * این بخش برنده واقعی را تشخیص می‌دهد.
 */

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

  return {
    card,
    rank,
    suit,
    value: RANK_VALUES[rank]
  };
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

  if (unique.includes(14)) {
    unique.push(1);
  }

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
    .map(([value, count]) => ({
      value: Number(value),
      count
    }))
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
      flushValues = suitValues.sort((a, b) => b - a);
    }
  });

  if (flushValues) {
    const straightFlushHigh = getStraightHigh(flushValues);

    if (straightFlushHigh === 14) {
      return {
        rank: HAND_RANKS.ROYAL_FLUSH,
        name: "Royal Flush",
        values: [14]
      };
    }

    if (straightFlushHigh) {
      return {
        rank: HAND_RANKS.STRAIGHT_FLUSH,
        name: "Straight Flush",
        values: [straightFlushHigh]
      };
    }
  }

  const four = groups.find((group) => group.count === 4);

  if (four) {
    const kicker = values.find((value) => value !== four.value);

    return {
      rank: HAND_RANKS.FOUR_OF_A_KIND,
      name: "Four of a Kind",
      values: [four.value, kicker]
    };
  }

  const threeGroups = groups.filter((group) => group.count === 3);
  const pairGroups = groups.filter((group) => group.count === 2);

  if (threeGroups.length >= 1 && (pairGroups.length >= 1 || threeGroups.length >= 2)) {
    const three = threeGroups[0];
    const pair = pairGroups[0] || threeGroups[1];

    return {
      rank: HAND_RANKS.FULL_HOUSE,
      name: "Full House",
      values: [three.value, pair.value]
    };
  }

  if (flushValues) {
    return {
      rank: HAND_RANKS.FLUSH,
      name: "Flush",
      values: flushValues.slice(0, 5)
    };
  }

  const straightHigh = getStraightHigh(values);

  if (straightHigh) {
    return {
      rank: HAND_RANKS.STRAIGHT,
      name: "Straight",
      values: [straightHigh]
    };
  }

  if (threeGroups.length >= 1) {
    const three = threeGroups[0];
    const kickers = values.filter((value) => value !== three.value).slice(0, 2);

    return {
      rank: HAND_RANKS.THREE_OF_A_KIND,
      name: "Three of a Kind",
      values: [three.value, ...kickers]
    };
  }

  if (pairGroups.length >= 2) {
    const firstPair = pairGroups[0];
    const secondPair = pairGroups[1];
    const kicker = values.find((value) => value !== firstPair.value && value !== secondPair.value);

    return {
      rank: HAND_RANKS.TWO_PAIR,
      name: "Two Pair",
      values: [firstPair.value, secondPair.value, kicker]
    };
  }

  if (pairGroups.length === 1) {
    const pair = pairGroups[0];
    const kickers = values.filter((value) => value !== pair.value).slice(0, 3);

    return {
      rank: HAND_RANKS.ONE_PAIR,
      name: "One Pair",
      values: [pair.value, ...kickers]
    };
  }

  return {
    rank: HAND_RANKS.HIGH_CARD,
    name: "High Card",
    values: values.slice(0, 5)
  };
}

function compareHands(handA, handB) {
  if (handA.rank !== handB.rank) {
    return handA.rank - handB.rank;
  }

  for (let i = 0; i < Math.max(handA.values.length, handB.values.length); i++) {
    const valueA = handA.values[i] || 0;
    const valueB = handB.values[i] || 0;

    if (valueA !== valueB) {
      return valueA - valueB;
    }
  }

  return 0;
}

function findWinner(room) {
  const activePlayers = room.players.filter((player) => !player.folded);

  if (activePlayers.length === 0) return null;

  let bestPlayer = activePlayers[0];
  let bestHand = evaluateSevenCards([
    ...(bestPlayer.cards || []),
    ...room.communityCards
  ]);

  activePlayers.slice(1).forEach((player) => {
    const playerHand = evaluateSevenCards([
      ...(player.cards || []),
      ...room.communityCards
    ]);

    if (compareHands(playerHand, bestHand) > 0) {
      bestPlayer = player;
      bestHand = playerHand;
    }
  });

  return {
    player: bestPlayer,
    hand: bestHand
  };
}

function finishHand(room) {
  const activePlayers = room.players.filter((player) => !player.folded);

  if (activePlayers.length === 0) {
    resetRoomToWaiting(room);
    return;
  }

  let result;

  if (activePlayers.length === 1) {
    result = {
      player: activePlayers[0],
      hand: {
        name: "Everyone else folded"
      }
    };
  } else {
    result = findWinner(room);
  }

  if (!result || !result.player) {
    resetRoomToWaiting(room);
    return;
  }

  const winner = result.player;
  winner.chips += room.pot;

  room.status = winner.name + " wins " + room.pot + " with " + result.hand.name;
  room.phase = "showdown";
  room.handStarted = false;

  room.players.forEach((player) => {
    player.isTurn = false;
    player.status = player.socketId === winner.socketId ? "Winner" : "Finished";
  });

  io.to(room.id).emit(
    "gameMessage",
    winner.name + " wins " + room.pot + " with " + result.hand.name + "."
  );

  setTimeout(() => {
    if (room.players.length >= 2) {
      startHand(room);
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
    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, sans-serif;
      background:
        radial-gradient(circle at top, #0f5132 0%, #07150d 45%, #020403 100%);
      color: white;
      overflow-x: hidden;
      padding-bottom: calc(118px + env(safe-area-inset-bottom));
    }

    body.rtl {
      direction: rtl;
      font-family: Arial, Tahoma, sans-serif;
    }

    .app {
      width: 100%;
      max-width: 1100px;
      margin: 0 auto;
      padding: 16px;
    }

    .header {
      text-align: center;
      margin-bottom: 14px;
    }

    .top-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }

    .logo {
      color: #facc15;
      font-size: 30px;
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

    .subtitle {
      font-size: 13px;
      color: #d1d5db;
    }

    .top-status {
      margin: 12px auto 0;
      max-width: 620px;
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

    .status-pill strong {
      color: #facc15;
    }

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
      box-shadow: 0 18px 55px rgba(0, 0, 0, 0.35);
    }

    .panel h2 {
      margin: 0 0 12px;
      color: #facc15;
      font-size: 17px;
    }

    .input {
      width: 100%;
      border: 1px solid rgba(250, 204, 21, 0.35);
      background: rgba(0, 0, 0, 0.45);
      color: white;
      border-radius: 12px;
      padding: 12px;
      outline: none;
      margin-bottom: 12px;
      font-size: 15px;
    }

    .room-card {
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      border-radius: 14px;
      padding: 12px;
      margin-bottom: 10px;
      cursor: pointer;
      transition: 0.2s;
    }

    .room-card.active {
      border-color: #facc15;
      background: rgba(250, 204, 21, 0.12);
    }

    .room-title {
      font-weight: 900;
      margin-bottom: 5px;
    }

    .room-meta {
      color: #d1d5db;
      font-size: 12px;
      line-height: 1.55;
    }

    .poker-table {
      position: relative;
      min-height: 560px;
      border-radius: 48%;
      background:
        radial-gradient(circle at center, #15803d 0%, #166534 45%, #052e16 100%);
      border: 12px solid #7c2d12;
      box-shadow:
        inset 0 0 48px rgba(0, 0, 0, 0.56),
        0 25px 70px rgba(0, 0, 0, 0.55);
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
      box-shadow: 0 0 18px rgba(250, 204, 21, 0.55);
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
      box-shadow: 0 12px 22px rgba(0, 0, 0, 0.38);
    }

    .card.red {
      color: #dc2626;
    }

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
      background: rgba(0, 0, 0, 0.58);
      border: 1px solid rgba(250, 204, 21, 0.55);
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
      background: rgba(2, 6, 23, 0.68);
      border: 1px solid rgba(34, 197, 94, 0.5);
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
      box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.55), 0 0 24px rgba(34, 197, 94, 0.65);
    }

    .player.folded {
      opacity: 0.45;
    }

    .player-name {
      background: rgba(0, 0, 0, 0.7);
      border-radius: 999px;
      padding: 5px 8px;
      font-size: 12px;
      font-weight: 900;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chips {
      margin-top: 4px;
      color: #facc15;
      font-size: 12px;
    }

    .bet {
      margin-top: 2px;
      color: #93c5fd;
      font-size: 11px;
    }

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
      gap: 10px;
      flex-wrap: wrap;
      width: min(96%, 580px);
      background: rgba(0, 0, 0, 0.5);
      border: 1px solid rgba(250, 204, 21, 0.25);
      border-radius: 22px;
      padding: 10px;
      backdrop-filter: blur(10px);
    }

    .btn {
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      min-width: 92px;
      color: white;
      font-weight: 900;
      cursor: pointer;
      font-size: 14px;
    }

    .btn:disabled {
      opacity: 0.42;
      cursor: not-allowed;
    }

    .fold { background: #991b1b; }
    .call { background: #166534; }
    .raise { background: #ca8a04; color: #111827; }
    .start { background: #2563eb; }

    .voice-log {
      margin-top: 14px;
      display: grid;
      grid-template-columns: 1fr 1.3fr;
      gap: 12px;
    }

    .voice-box,
    .log {
      background: rgba(0, 0, 0, 0.42);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 12px;
      font-size: 13px;
      color: #d1d5db;
    }

    .log {
      max-height: 155px;
      overflow-y: auto;
      line-height: 1.55;
    }

    .log-item {
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 5px 0;
    }

    .log-item:last-child {
      border-bottom: none;
    }

    @media (max-width: 850px) {
      .main-layout {
        grid-template-columns: 1fr;
      }

      .top-row {
        align-items: flex-start;
      }

      .logo {
        font-size: 24px;
        text-align: left;
      }

      body.rtl .logo {
        text-align: right;
      }

      .top-status {
        grid-template-columns: 1fr;
      }

      .poker-table {
        min-height: 520px;
        border-width: 8px;
      }

      .community {
        top: 178px;
        gap: 6px;
      }

      .card {
        width: 43px;
        height: 62px;
        font-size: 17px;
      }

      .pot {
        top: 260px;
      }

      .turn-status {
        top: 314px;
        min-width: 215px;
      }

      .my-cards {
        bottom: 100px;
      }

      .player {
        width: 100px;
      }

      .avatar {
        width: 50px;
        height: 50px;
      }

      .seat-0 { left: 50%; bottom: 22px; transform: translateX(-50%); }
      .seat-1 { left: 10px; bottom: 112px; }
      .seat-2 { left: 10px; top: 108px; }
      .seat-3 { right: 10px; top: 108px; }
      .seat-4 { right: 10px; bottom: 112px; }
      .seat-5 { left: 50%; top: 66px; transform: translateX(-50%); }

      .voice-log {
        grid-template-columns: 1fr;
      }

      .btn {
        min-width: 75px;
        padding: 11px 12px;
      }
    }
  </style>
</head>

<body>
  <div class="app">
    <header class="header">
      <div class="top-row">
        <div class="logo">♠ Poker Royale ♣</div>
        <button class="lang-btn" id="langBtn">FA</button>
      </div>

      <div class="subtitle" id="subtitle">Real-time Multiplayer Texas Hold'em Foundation</div>

      <div class="top-status">
        <div class="status-pill"><span id="connectionLabel">Connection</span>: <strong id="connectionStatus">Connecting...</strong></div>
        <div class="status-pill"><span id="onlineLabel">Online</span>: <strong id="onlineCount">0</strong></div>
        <div class="status-pill"><span id="phaseLabel">Phase</span>: <strong id="phaseStatus">waiting</strong></div>
      </div>
    </header>

    <div class="main-layout">
      <aside class="panel">
        <h2 id="lobbyTitle">Lobby Rooms</h2>
        <input id="playerName" class="input" maxlength="14" placeholder="Enter your name" />
        <div id="rooms"></div>
      </aside>

      <main class="table-area">
        <div class="poker-table">
          <div class="table-line"></div>
          <div class="dealer" id="dealerLabel">DEALER</div>

          <div class="community" id="communityCards">
            <div class="card back">♠</div>
            <div class="card back">♥</div>
            <div class="card back">♦</div>
            <div class="card back">♣</div>
            <div class="card back">★</div>
          </div>

          <div class="pot" id="potDisplay">POT: 0</div>
          <div class="turn-status" id="turnStatus">Choose a room to join</div>
          <div class="my-cards" id="myCards"></div>
          <div id="players"></div>
        </div>

        <div class="voice-log">
          <div class="voice-box">
            <strong id="voiceTitle">🎙 Voice Chat</strong><br />
            <span id="voiceText">UI ready. WebRTC will be added later.</span>
          </div>

          <div class="log" id="gameLog">
            <div class="log-item" id="welcomeLog">Welcome to Poker Royale.</div>
          </div>
        </div>
      </main>
    </div>
  </div>

  <div class="actions">
    <button class="btn start" id="startBtn" disabled>Start</button>
    <button class="btn fold" id="foldBtn" disabled>Fold</button>
    <button class="btn call" id="callBtn" disabled>Call</button>
    <button class="btn raise" id="raiseBtn" disabled>Raise</button>
  </div>

  <script src="/socket.io/socket.io.js"></script>

  <script>
    const socket = io();

    let currentRoomId = null;
    let joined = false;
    let mySocketId = null;
    let latestRoom = null;
    let currentLang = localStorage.getItem("pokerLang") || "en";

    const t = {
      en: {
        langButton: "FA",
        subtitle: "Real-time Multiplayer Texas Hold'em Foundation",
        connection: "Connection",
        connecting: "Connecting...",
        connected: "Connected",
        disconnected: "Disconnected",
        online: "Online",
        phase: "Phase",
        lobbyRooms: "Lobby Rooms",
        enterName: "Enter your name",
        dealer: "DEALER",
        chooseRoom: "Choose a room to join",
        voiceTitle: "🎙 Voice Chat",
        voiceText: "UI ready. WebRTC will be added later.",
        welcome: "Welcome to Poker Royale.",
        start: "Start",
        fold: "Fold",
        call: "Call",
        raise: "Raise",
        players: "Players",
        pot: "Pot",
        status: "Status",
        needName: "Please enter your name first.",
        roomFull: "This room is full.",
        joined: "You joined",
        bet: "Bet",
        you: "You",
        raiseAmount: "Raise amount:"
      },
      fa: {
        langButton: "EN",
        subtitle: "بنیاد بازی چندنفره آنلاین Texas Hold'em",
        connection: "اتصال",
        connecting: "در حال اتصال...",
        connected: "وصل شد",
        disconnected: "قطع شد",
        online: "آنلاین",
        phase: "مرحله",
        lobbyRooms: "اتاق‌های لابی",
        enterName: "نام خود را وارد کنید",
        dealer: "دیلر",
        chooseRoom: "یک اتاق انتخاب کنید",
        voiceTitle: "🎙 گفتگوی صوتی",
        voiceText: "ظاهر آماده است. WebRTC بعداً اضافه می‌شود.",
        welcome: "به Poker Royale خوش آمدید.",
        start: "شروع",
        fold: "انصراف",
        call: "کال",
        raise: "افزایش",
        players: "بازیکن‌ها",
        pot: "پات",
        status: "وضعیت",
        needName: "اول نام خود را وارد کنید.",
        roomFull: "این اتاق پر است.",
        joined: "وارد شدی به",
        bet: "شرط",
        you: "شما",
        raiseAmount: "مقدار افزایش:"
      }
    };

    const connectionStatus = document.getElementById("connectionStatus");
    const onlineCount = document.getElementById("onlineCount");
    const phaseStatus = document.getElementById("phaseStatus");
    const roomsEl = document.getElementById("rooms");
    const playersEl = document.getElementById("players");
    const playerNameInput = document.getElementById("playerName");
    const communityCardsEl = document.getElementById("communityCards");
    const myCardsEl = document.getElementById("myCards");
    const potDisplay = document.getElementById("potDisplay");
    const turnStatus = document.getElementById("turnStatus");
    const gameLog = document.getElementById("gameLog");

    const langBtn = document.getElementById("langBtn");
    const startBtn = document.getElementById("startBtn");
    const foldBtn = document.getElementById("foldBtn");
    const callBtn = document.getElementById("callBtn");
    const raiseBtn = document.getElementById("raiseBtn");

    function applyLanguage() {
      const tr = t[currentLang];

      document.documentElement.lang = currentLang;
      document.documentElement.dir = currentLang === "fa" ? "rtl" : "ltr";
      document.body.classList.toggle("rtl", currentLang === "fa");

      langBtn.textContent = tr.langButton;
      document.getElementById("subtitle").textContent = tr.subtitle;
      document.getElementById("connectionLabel").textContent = tr.connection;
      document.getElementById("onlineLabel").textContent = tr.online;
      document.getElementById("phaseLabel").textContent = tr.phase;
      document.getElementById("lobbyTitle").textContent = tr.lobbyRooms;
      document.getElementById("dealerLabel").textContent = tr.dealer;
      document.getElementById("voiceTitle").textContent = tr.voiceTitle;
      document.getElementById("voiceText").textContent = tr.voiceText;
      document.getElementById("welcomeLog").textContent = tr.welcome;

      playerNameInput.placeholder = tr.enterName;

      startBtn.textContent = tr.start;
      foldBtn.textContent = tr.fold;
      callBtn.textContent = tr.call;
      raiseBtn.textContent = tr.raise;

      if (!joined) {
        turnStatus.textContent = tr.chooseRoom;
      }

      if (latestRoom) {
        renderRooms(window.latestRooms || []);
        renderPlayers(latestRoom.players);
        updateTableText(latestRoom);
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

    function cardIsRed(card) {
      return card.includes("♥") || card.includes("♦");
    }

    function renderCard(card) {
      if (!card) {
        return '<div class="card back">★</div>';
      }

      const redClass = cardIsRed(card) ? " red" : "";
      return '<div class="card' + redClass + '">' + card + '</div>';
    }

    function renderRooms(rooms) {
      window.latestRooms = rooms;
      roomsEl.innerHTML = "";

      rooms.forEach(function(room) {
        const tr = t[currentLang];
        const card = document.createElement("div");
        card.className = "room-card" + (room.id === currentRoomId ? " active" : "");

        card.innerHTML =
          '<div class="room-title">' + room.name + '</div>' +
          '<div class="room-meta">' +
          tr.players + ': ' + room.playerCount + '/6<br />' +
          tr.pot + ': ' + room.pot + '<br />' +
          tr.phase + ': ' + room.phase + '<br />' +
          tr.status + ': ' + room.status +
          '</div>';

        card.onclick = function() {
          const name = playerNameInput.value.trim();

          if (!name) {
            alert(t[currentLang].needName);
            return;
          }

          if (room.playerCount >= 6 && room.id !== currentRoomId) {
            alert(t[currentLang].roomFull);
            return;
          }

          currentRoomId = room.id;

          socket.emit("joinRoom", {
            roomId: room.id,
            name: name
          });
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
        const youLabel = player.socketId === mySocketId ? " (" + t[currentLang].you + ")" : "";

        el.innerHTML =
          '<div class="avatar">' + initial + '</div>' +
          '<div class="player-name">' + player.name + youLabel + '</div>' +
          '<div class="chips">🟡 ' + player.chips + '</div>' +
          '<div class="bet">' + t[currentLang].bet + ': ' + player.bet + '</div>';

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
      potDisplay.textContent = t[currentLang].pot.toUpperCase() + ": " + room.pot;
      turnStatus.textContent = room.status;
      phaseStatus.textContent = room.phase;
    }

    function updateButtons(room) {
      startBtn.disabled = !joined;

      if (!room || !joined) {
        foldBtn.disabled = true;
        callBtn.disabled = true;
        raiseBtn.disabled = true;
        return;
      }

      const me = room.players.find(function(player) {
        return player.socketId === mySocketId;
      });

      const isMyTurn = me && me.isTurn && !me.folded && room.phase !== "waiting" && room.phase !== "showdown";

      foldBtn.disabled = !isMyTurn;
      callBtn.disabled = !isMyTurn;
      raiseBtn.disabled = !isMyTurn;
    }

    socket.on("connect", function() {
      mySocketId = socket.id;
      connectionStatus.textContent = t[currentLang].connected;
      connectionStatus.style.color = "#22c55e";
      addLog(t[currentLang].connected);
    });

    socket.on("disconnect", function() {
      connectionStatus.textContent = t[currentLang].disconnected;
      connectionStatus.style.color = "#ef4444";
      addLog(t[currentLang].disconnected);
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

      addLog(t[currentLang].joined + " " + room.name);
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

    socket.on("gameMessage", function(message) {
      addLog(message);
    });

    startBtn.onclick = function() {
      if (!joined || !currentRoomId) return;
      socket.emit("startHand", { roomId: currentRoomId });
    };

    foldBtn.onclick = function() {
      if (!joined || !currentRoomId) return;

      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Fold"
      });
    };

    callBtn.onclick = function() {
      if (!joined || !currentRoomId) return;

      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Call"
      });
    };

    raiseBtn.onclick = function() {
      if (!joined || !currentRoomId) return;

      const amount = prompt(t[currentLang].raiseAmount, "50");

      if (!amount) return;

      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Raise",
        amount: Number(amount)
      });
    };

    applyLanguage();
  </script>
</body>
</html>
  `);
});

io.on("connection", (socket) => {
  console.log("Connected:", socket.id);

  io.emit("onlineCount", io.engine.clientsCount);
  socket.emit("roomsUpdate", getPublicRooms());

  socket.on("joinRoom", ({ roomId, name }) => {
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

    if (room.players.length >= 6) {
      socket.emit("gameMessage", "This room is full.");
      return;
    }

    const cleanName = sanitizePlayerName(name);

    const player = {
      socketId: socket.id,
      name: cleanName,
      chips: 1000,
      seat: room.players.length,
      cards: [],
      bet: 0,
      folded: false,
      isTurn: false,
      status: "Waiting"
    };

    room.players.push(player);
    room.status = cleanName + " joined the table";

    socket.join(room.id);

    socket.emit("roomJoined", getPublicRoomState(room));
    io.to(room.id).emit("gameMessage", cleanName + " joined " + room.name + ".");

    emitRoom(room);
  });

  socket.on("startHand", ({ roomId }) => {
    const room = rooms[roomId];

    if (!room) return;

    const player = room.players.find((p) => p.socketId === socket.id);

    if (!player) {
      socket.emit("gameMessage", "Join a room first.");
      return;
    }

    if (room.players.length < 2) {
      socket.emit("gameMessage", "Need at least 2 players to start.");
      return;
    }

    startHand(room);
    io.to(room.id).emit("gameMessage", "New hand started.");
    emitRoom(room);
  });

  socket.on("playerAction", ({ roomId, action, amount }) => {
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

    if (action === "Fold") {
      player.folded = true;
      player.status = "Folded";
      room.status = player.name + " folded";
      io.to(room.id).emit("gameMessage", player.name + " folded.");
      nextTurn(room);
      emitRoom(room);
      return;
    }

    if (action === "Call") {
      const callAmount = room.currentBet;

      if (player.chips < callAmount) {
        socket.emit("gameMessage", "Not enough chips.");
        return;
      }

      player.chips -= callAmount;
      player.bet += callAmount;
      room.pot += callAmount;
      player.status = "Called";
      room.status = player.name + " called " + callAmount;

      io.to(room.id).emit("gameMessage", player.name + " called " + callAmount + ".");

      const activePlayers = room.players.filter((p) => !p.folded);

      if (activePlayers.every((p) => p.bet >= room.currentBet)) {
        advancePhase(room);
      } else {
        nextTurn(room);
      }

      emitRoom(room);
      return;
    }

    if (action === "Raise") {
      const raiseAmount = Number(amount);

      if (!Number.isFinite(raiseAmount) || raiseAmount <= room.currentBet) {
        socket.emit("gameMessage", "Raise must be higher than current bet.");
        return;
      }

      if (player.chips < raiseAmount) {
        socket.emit("gameMessage", "Not enough chips.");
        return;
      }

      player.chips -= raiseAmount;
      player.bet += raiseAmount;
      room.pot += raiseAmount;
      room.currentBet = raiseAmount;
      player.status = "Raised";
      room.status = player.name + " raised to " + raiseAmount;

      io.to(room.id).emit("gameMessage", player.name + " raised to " + raiseAmount + ".");

      nextTurn(room);
      emitRoom(room);
      return;
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

server.listen(PORT, () => {
  console.log("Poker Royale server running on port " + PORT);
});
