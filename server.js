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

/**
 * Poker Royale - Temporary In-Memory State
 * فعلاً دیتابیس نداریم، پس اطلاعات بازیکنان و روم‌ها داخل RAM سرور نگهداری می‌شود.
 * بعداً همین بخش را به Database وصل می‌کنیم.
 */
const rooms = {
  "royal-room": {
    id: "royal-room",
    name: "Royal Room",
    players: [],
    pot: 0,
    status: "Waiting for players"
  },
  "vip-room": {
    id: "vip-room",
    name: "VIP Room",
    players: [],
    pot: 0,
    status: "Waiting for players"
  },
  "beginner-room": {
    id: "beginner-room",
    name: "Beginner Room",
    players: [],
    pot: 0,
    status: "Waiting for players"
  }
};

function getPublicRooms() {
  return Object.values(rooms).map((room) => ({
    id: room.id,
    name: room.name,
    playerCount: room.players.length,
    pot: room.pot,
    status: room.status
  }));
}

function findPlayerBySocketId(socketId) {
  for (const room of Object.values(rooms)) {
    const player = room.players.find((p) => p.socketId === socketId);
    if (player) {
      return { player, room };
    }
  }

  return null;
}

function removePlayer(socketId) {
  for (const room of Object.values(rooms)) {
    const playerIndex = room.players.findIndex((p) => p.socketId === socketId);

    if (playerIndex !== -1) {
      const removedPlayer = room.players.splice(playerIndex, 1)[0];

      if (room.players.length === 0) {
        room.pot = 0;
        room.status = "Waiting for players";
      } else {
        room.status = `${removedPlayer.name} left the table`;
      }

      return { removedPlayer, room };
    }
  }

  return null;
}

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>Poker Royale</title>

  <style>
    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      font-family: Arial, sans-serif;
      background:
        radial-gradient(circle at top, #14532d 0%, #07140c 45%, #020403 100%);
      color: #fff;
      min-height: 100vh;
      overflow-x: hidden;
    }

    .app {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      padding: 18px;
    }

    .header {
      text-align: center;
      margin-bottom: 18px;
    }

    .logo {
      font-size: 34px;
      font-weight: 900;
      color: #facc15;
      text-shadow: 0 0 18px rgba(250, 204, 21, 0.65);
      margin-bottom: 6px;
    }

    .subtitle {
      color: #d1d5db;
      font-size: 14px;
    }

    .status-bar {
      margin: 12px auto 0;
      max-width: 520px;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(250, 204, 21, 0.35);
      border-radius: 14px;
      padding: 10px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      font-size: 13px;
    }

    .status-online {
      color: #22c55e;
      font-weight: bold;
    }

    .layout {
      display: grid;
      grid-template-columns: 280px 1fr;
      gap: 18px;
      align-items: start;
    }

    .panel {
      background: rgba(0, 0, 0, 0.42);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 18px;
      padding: 16px;
      box-shadow: 0 18px 60px rgba(0, 0, 0, 0.35);
    }

    .panel h2 {
      margin: 0 0 12px;
      color: #facc15;
      font-size: 18px;
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

    .room-card:hover {
      border-color: rgba(250, 204, 21, 0.7);
      transform: translateY(-1px);
    }

    .room-card.active {
      border-color: #facc15;
      background: rgba(250, 204, 21, 0.12);
    }

    .room-title {
      font-weight: 800;
      color: white;
      margin-bottom: 5px;
    }

    .room-meta {
      color: #d1d5db;
      font-size: 13px;
      line-height: 1.5;
    }

    .table-wrap {
      min-height: 620px;
      position: relative;
    }

    .poker-table {
      position: relative;
      width: 100%;
      min-height: 560px;
      border-radius: 48%;
      background:
        radial-gradient(circle at center, #15803d 0%, #166534 45%, #052e16 100%);
      border: 14px solid #78350f;
      box-shadow:
        inset 0 0 45px rgba(0, 0, 0, 0.55),
        0 25px 70px rgba(0, 0, 0, 0.55);
      overflow: hidden;
    }

    .table-inner {
      position: absolute;
      inset: 34px;
      border-radius: 48%;
      border: 2px dashed rgba(250, 204, 21, 0.35);
    }

    .dealer-badge {
      position: absolute;
      top: 44px;
      left: 50%;
      transform: translateX(-50%);
      background: #facc15;
      color: #111827;
      padding: 8px 14px;
      border-radius: 999px;
      font-weight: 900;
      box-shadow: 0 0 20px rgba(250, 204, 21, 0.55);
      z-index: 5;
    }

    .community {
      position: absolute;
      top: 205px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 10px;
      z-index: 5;
    }

    .card {
      width: 54px;
      height: 76px;
      background: white;
      color: #111827;
      border-radius: 9px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 900;
      font-size: 22px;
      box-shadow: 0 10px 22px rgba(0, 0, 0, 0.35);
    }

    .card.back {
      background:
        linear-gradient(135deg, #991b1b, #450a0a);
      color: #facc15;
      border: 2px solid rgba(250, 204, 21, 0.8);
    }

    .pot {
      position: absolute;
      top: 305px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.55);
      border: 1px solid rgba(250, 204, 21, 0.55);
      border-radius: 18px;
      padding: 12px 20px;
      color: #facc15;
      font-weight: 900;
      z-index: 5;
    }

    .turn-status {
      position: absolute;
      top: 365px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(2, 6, 23, 0.65);
      border: 1px solid rgba(34, 197, 94, 0.55);
      border-radius: 14px;
      padding: 10px 16px;
      color: #bbf7d0;
      font-size: 14px;
      min-width: 230px;
      text-align: center;
      z-index: 5;
    }

    .player {
      position: absolute;
      width: 125px;
      text-align: center;
      z-index: 6;
    }

    .avatar {
      width: 58px;
      height: 58px;
      margin: 0 auto 6px;
      border-radius: 50%;
      background:
        radial-gradient(circle at top, #facc15, #a16207);
      border: 3px solid #fff7ed;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #111827;
      font-weight: 900;
      font-size: 20px;
    }

    .player-name {
      font-weight: 800;
      font-size: 13px;
      background: rgba(0, 0, 0, 0.65);
      border-radius: 999px;
      padding: 5px 8px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .chips {
      color: #facc15;
      font-size: 12px;
      margin-top: 4px;
    }

    .seat-0 { left: 50%; bottom: 28px; transform: translateX(-50%); }
    .seat-1 { left: 55px; bottom: 120px; }
    .seat-2 { left: 55px; top: 105px; }
    .seat-3 { right: 55px; top: 105px; }
    .seat-4 { right: 55px; bottom: 120px; }
    .seat-5 { left: 50%; top: 78px; transform: translateX(-50%); }

    .actions {
      margin-top: 18px;
      display: flex;
      justify-content: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .btn {
      border: none;
      color: white;
      font-weight: 900;
      padding: 12px 22px;
      border-radius: 999px;
      cursor: pointer;
      font-size: 15px;
      min-width: 95px;
      box-shadow: 0 12px 25px rgba(0, 0, 0, 0.3);
    }

    .btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }

    .fold { background: #991b1b; }
    .call { background: #166534; }
    .raise { background: #ca8a04; color: #111827; }

    .voice-box {
      margin-top: 16px;
      background: rgba(0, 0, 0, 0.38);
      border: 1px solid rgba(255, 255, 255, 0.12);
      border-radius: 16px;
      padding: 12px;
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: center;
      color: #d1d5db;
      font-size: 14px;
    }

    .log {
      margin-top: 16px;
      max-height: 170px;
      overflow-y: auto;
      background: rgba(0, 0, 0, 0.35);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 14px;
      padding: 12px;
      font-size: 13px;
      color: #d1d5db;
      line-height: 1.6;
    }

    .log-item {
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding: 5px 0;
    }

    .log-item:last-child {
      border-bottom: none;
    }

    @media (max-width: 850px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .poker-table {
        min-height: 520px;
        border-width: 9px;
      }

      .community {
        top: 195px;
      }

      .card {
        width: 44px;
        height: 64px;
        font-size: 18px;
      }

      .player {
        width: 104px;
      }

      .seat-1 { left: 12px; bottom: 120px; }
      .seat-2 { left: 12px; top: 112px; }
      .seat-3 { right: 12px; top: 112px; }
      .seat-4 { right: 12px; bottom: 120px; }
    }
  </style>
</head>

<body>
  <div class="app">
    <div class="header">
      <div class="logo">♠ Poker Royale ♣</div>
      <div class="subtitle">Real-time Multiplayer Lobby - Phase 1</div>

      <div class="status-bar">
        <div>Connection: <span id="connectionStatus">Connecting...</span></div>
        <div>Online: <span id="onlineCount" class="status-online">0</span></div>
      </div>
    </div>

    <div class="layout">
      <aside class="panel">
        <h2>Lobby Rooms</h2>

        <input
          id="playerName"
          class="input"
          maxlength="14"
          placeholder="Enter your name"
        />

        <div id="rooms"></div>
      </aside>

      <main class="table-wrap">
        <div class="poker-table">
          <div class="table-inner"></div>
          <div class="dealer-badge">DEALER</div>

          <div class="community">
            <div class="card back">♠</div>
            <div class="card back">♥</div>
            <div class="card back">♦</div>
            <div class="card back">♣</div>
            <div class="card back">★</div>
          </div>

          <div class="pot" id="potDisplay">POT: 0</div>
          <div class="turn-status" id="turnStatus">Choose a room to join</div>

          <div id="players"></div>
        </div>

        <div class="actions">
          <button class="btn fold" id="foldBtn" disabled>Fold</button>
          <button class="btn call" id="callBtn" disabled>Call</button>
          <button class="btn raise" id="raiseBtn" disabled>Raise</button>
        </div>

        <div class="voice-box">
          <div>🎙 Voice Chat UI</div>
          <div id="voiceStatus">Not connected yet</div>
        </div>

        <div class="log" id="gameLog">
          <div class="log-item">Welcome to Poker Royale.</div>
        </div>
      </main>
    </div>
  </div>

  <script src="/socket.io/socket.io.js"></script>

  <script>
    const socket = io();

    let currentRoomId = null;
    let joined = false;

    const connectionStatus = document.getElementById("connectionStatus");
    const onlineCount = document.getElementById("onlineCount");
    const roomsEl = document.getElementById("rooms");
    const playersEl = document.getElementById("players");
    const playerNameInput = document.getElementById("playerName");
    const potDisplay = document.getElementById("potDisplay");
    const turnStatus = document.getElementById("turnStatus");
    const gameLog = document.getElementById("gameLog");
    const voiceStatus = document.getElementById("voiceStatus");

    const foldBtn = document.getElementById("foldBtn");
    const callBtn = document.getElementById("callBtn");
    const raiseBtn = document.getElementById("raiseBtn");

    function addLog(message) {
      const item = document.createElement("div");
      item.className = "log-item";
      item.textContent = message;
      gameLog.prepend(item);
    }

    function enableActions() {
      foldBtn.disabled = false;
      callBtn.disabled = false;
      raiseBtn.disabled = false;
    }

    function disableActions() {
      foldBtn.disabled = true;
      callBtn.disabled = true;
      raiseBtn.disabled = true;
    }

    function renderRooms(rooms) {
      roomsEl.innerHTML = "";

      rooms.forEach((room) => {
        const card = document.createElement("div");
        card.className = "room-card" + (room.id === currentRoomId ? " active" : "");

        card.innerHTML = \`
          <div class="room-title">\${room.name}</div>
          <div class="room-meta">
            Players: \${room.playerCount}/6<br />
            Pot: \${room.pot}<br />
            Status: \${room.status}
          </div>
        \`;

        card.onclick = () => {
          const playerName = playerNameInput.value.trim();

          if (!playerName) {
            alert("Please enter your name first.");
            return;
          }

          if (room.playerCount >= 6 && room.id !== currentRoomId) {
            alert("This room is full.");
            return;
          }

          currentRoomId = room.id;
          socket.emit("joinRoom", {
            roomId: room.id,
            name: playerName
          });
        };

        roomsEl.appendChild(card);
      });
    }

    function renderPlayers(players) {
      playersEl.innerHTML = "";

      players.forEach((player, index) => {
        const el = document.createElement("div");
        el.className = "player seat-" + index;

        const initial = player.name ? player.name.charAt(0).toUpperCase() : "?";

        el.innerHTML = \`
          <div class="avatar">\${initial}</div>
          <div class="player-name">\${player.name}</div>
          <div class="chips">🟡 \${player.chips}</div>
        \`;

        playersEl.appendChild(el);
      });
    }

    socket.on("connect", () => {
      connectionStatus.textContent = "Connected";
      connectionStatus.style.color = "#22c55e";
      addLog("Connected to Poker Royale server.");
    });

    socket.on("disconnect", () => {
      connectionStatus.textContent = "Disconnected";
      connectionStatus.style.color = "#ef4444";
      addLog("Disconnected from server.");
      disableActions();
    });

    socket.on("onlineCount", (count) => {
      onlineCount.textContent = count;
    });

    socket.on("roomsUpdate", (rooms) => {
      renderRooms(rooms);
    });

    socket.on("roomJoined", (room) => {
      joined = true;
      currentRoomId = room.id;
      enableActions();
      voiceStatus.textContent = "Voice placeholder active";
      potDisplay.textContent = "POT: " + room.pot;
      turnStatus.textContent = room.status;
      renderPlayers(room.players);
      addLog("You joined " + room.name + ".");
    });

    socket.on("roomState", (room) => {
      if (!currentRoomId || currentRoomId !== room.id) return;

      potDisplay.textContent = "POT: " + room.pot;
      turnStatus.textContent = room.status;
      renderPlayers(room.players);
    });

    socket.on("gameMessage", (message) => {
      addLog(message);
    });

    foldBtn.onclick = () => {
      if (!joined || !currentRoomId) return;
      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Fold"
      });
    };

    callBtn.onclick = () => {
      if (!joined || !currentRoomId) return;
      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Call"
      });
    };

    raiseBtn.onclick = () => {
      if (!joined || !currentRoomId) return;

      const amount = prompt("Raise amount:", "50");

      if (!amount) return;

      socket.emit("playerAction", {
        roomId: currentRoomId,
        action: "Raise",
        amount: Number(amount)
      });
    };
  </script>
</body>
</html>
  `);
});

io.on("connection", (socket) => {
  console.log("Player connected:", socket.id);

  io.emit("onlineCount", io.engine.clientsCount);
  socket.emit("roomsUpdate", getPublicRooms());

  socket.on("joinRoom", ({ roomId, name }) => {
    const room = rooms[roomId];

    if (!room) {
      socket.emit("gameMessage", "Room not found.");
      return;
    }

    if (!name || typeof name !== "string") {
      socket.emit("gameMessage", "Invalid player name.");
      return;
    }

    const cleanName = name.trim().slice(0, 14);

    if (!cleanName) {
      socket.emit("gameMessage", "Please enter a valid name.");
      return;
    }

    const existingLocation = findPlayerBySocketId(socket.id);

    if (existingLocation) {
      socket.leave(existingLocation.room.id);
      removePlayer(socket.id);
      io.to(existingLocation.room.id).emit("roomState", existingLocation.room);
    }

    if (room.players.length >= 6) {
      socket.emit("gameMessage", "This room is full.");
      return;
    }

    const player = {
      socketId: socket.id,
      name: cleanName,
      chips: 1000,
      seat: room.players.length
    };

    room.players.push(player);
    room.status = `${cleanName} joined the table`;

    socket.join(room.id);

    socket.emit("roomJoined", room);
    io.to(room.id).emit("roomState", room);
    io.to(room.id).emit("gameMessage", `${cleanName} joined ${room.name}.`);
    io.emit("roomsUpdate", getPublicRooms());
  });

  socket.on("playerAction", ({ roomId, action, amount }) => {
    const room = rooms[roomId];

    if (!room) return;

    const player = room.players.find((p) => p.socketId === socket.id);

    if (!player) {
      socket.emit("gameMessage", "You are not seated in this room.");
      return;
    }

    if (action === "Fold") {
      room.status = `${player.name} folded`;
      io.to(room.id).emit("gameMessage", `${player.name} folded.`);
    }

    if (action === "Call") {
      const callAmount = 20;

      if (player.chips >= callAmount) {
        player.chips -= callAmount;
        room.pot += callAmount;
        room.status = `${player.name} called ${callAmount}`;
        io.to(room.id).emit("gameMessage", `${player.name} called ${callAmount}.`);
      } else {
        room.status = `${player.name} does not have enough chips`;
        socket.emit("gameMessage", "Not enough chips.");
      }
    }

    if (action === "Raise") {
      const raiseAmount = Number(amount);

      if (!Number.isFinite(raiseAmount) || raiseAmount <= 0) {
        socket.emit("gameMessage", "Invalid raise amount.");
        return;
      }

      if (player.chips >= raiseAmount) {
        player.chips -= raiseAmount;
        room.pot += raiseAmount;
        room.status = `${player.name} raised ${raiseAmount}`;
        io.to(room.id).emit("gameMessage", `${player.name} raised ${raiseAmount}.`);
      } else {
        room.status = `${player.name} does not have enough chips`;
        socket.emit("gameMessage", "Not enough chips.");
      }
    }

    io.to(room.id).emit("roomState", room);
    io.emit("roomsUpdate", getPublicRooms());
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const result = removePlayer(socket.id);

    if (result) {
      io.to(result.room.id).emit("roomState", result.room);
      io.to(result.room.id).emit(
        "gameMessage",
        `${result.removedPlayer.name} left the table.`
      );
      io.emit("roomsUpdate", getPublicRooms());
    }

    io.emit("onlineCount", io.engine.clientsCount);
  });
});

server.listen(PORT, () => {
  console.log(`Poker Royale server running on port ${PORT}`);
});
