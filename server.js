const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html>

  <head>
    <title>Poker Royale</title>

    <style>

      *{
        margin:0;
        padding:0;
        box-sizing:border-box;
      }

      body{
        background:
        radial-gradient(circle at top,#14532d,#0f172a 70%);
        min-height:100vh;
        font-family:Arial;
        color:white;
        overflow:hidden;
      }

      .topbar{
        width:100%;
        padding:20px 40px;
        display:flex;
        justify-content:space-between;
        align-items:center;
      }

      .logo{
        font-size:28px;
        font-weight:bold;
        color:#22c55e;
      }

      .balance{
        background:#111827;
        padding:12px 18px;
        border-radius:14px;
      }

      .table-wrapper{
        width:100%;
        display:flex;
        justify-content:center;
        margin-top:40px;
      }

      .table{
        width:900px;
        height:500px;
        background:#166534;
        border:18px solid #3f2a14;
        border-radius:300px;
        position:relative;
        box-shadow:0 0 60px rgba(0,0,0,0.5);
      }

      .pot{
        position:absolute;
        top:50%;
        left:50%;
        transform:translate(-50%,-50%);
        text-align:center;
      }

      .pot h2{
        color:#facc15;
        margin-bottom:10px;
      }

      .cards{
        display:flex;
        gap:10px;
        justify-content:center;
      }

      .card{
        width:70px;
        height:100px;
        background:white;
        border-radius:10px;
        color:black;
        display:flex;
        align-items:center;
        justify-content:center;
        font-size:28px;
        font-weight:bold;
      }

      .player{
        position:absolute;
        width:140px;
        text-align:center;
      }

      .avatar{
        width:70px;
        height:70px;
        border-radius:50%;
        background:#1f2937;
        margin:auto;
        border:4px solid #22c55e;
      }

      .player-name{
        margin-top:10px;
        font-weight:bold;
      }

      .chips{
        color:#facc15;
        margin-top:5px;
      }

      .p1{ bottom:-20px; left:50%; transform:translateX(-50%); }
      .p2{ top:20px; left:80px; }
      .p3{ top:20px; right:80px; }

      .controls{
        position:fixed;
        bottom:30px;
        width:100%;
        display:flex;
        justify-content:center;
        gap:20px;
      }

      button{
        border:none;
        padding:16px 28px;
        border-radius:14px;
        font-size:16px;
        font-weight:bold;
        cursor:pointer;
      }

      .fold{
        background:#ef4444;
        color:white;
      }

      .call{
        background:#22c55e;
        color:black;
      }

      .raise{
        background:#facc15;
        color:black;
      }

      .voice{
        position:fixed;
        top:100px;
        right:30px;
        background:#111827;
        padding:20px;
        border-radius:20px;
        width:220px;
      }

      .voice h3{
        margin-bottom:15px;
      }

      .mic{
        width:50px;
        height:50px;
        border-radius:50%;
        background:#22c55e;
        display:flex;
        align-items:center;
        justify-content:center;
        margin:auto;
        font-size:22px;
      }

    </style>
  </head>

  <body>

    <div class="topbar">
      <div class="logo">♠ Poker Royale</div>

      <div class="balance">
        Chips: $25,000
      </div>
    </div>

    <div class="table-wrapper">

      <div class="table">

        <div class="pot">
          <h2>Pot: $3,200</h2>

          <div class="cards">
            <div class="card">A♠</div>
            <div class="card">K♥</div>
            <div class="card">10♣</div>
            <div class="card">7♦</div>
            <div class="card">Q♠</div>
          </div>
        </div>

        <div class="player p1">
          <div class="avatar"></div>
          <div class="player-name">You</div>
          <div class="chips">$12,500</div>
        </div>

        <div class="player p2">
          <div class="avatar"></div>
          <div class="player-name">Alex</div>
          <div class="chips">$9,800</div>
        </div>

        <div class="player p3">
          <div class="avatar"></div>
          <div class="player-name">Daniel</div>
          <div class="chips">$15,400</div>
        </div>

      </div>

    </div>

    <div class="voice">
      <h3>🎤 Voice Chat</h3>

      <div class="mic">
        🎙️
      </div>
    </div>

    <div class="controls">
      <button class="fold">Fold</button>
      <button class="call">Call</button>
      <button class="raise">Raise</button>
    </div>

  </body>

  </html>
  `);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Poker Royale running on port " + PORT);
});
