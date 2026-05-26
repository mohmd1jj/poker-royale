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
          background: linear-gradient(135deg,#0f172a,#111827,#14532d);
          min-height:100vh;
          color:white;
          font-family:Arial;
          overflow-x:hidden;
        }

        .container{
          max-width:1200px;
          margin:auto;
          padding:60px 20px;
          text-align:center;
        }

        .badge{
          display:inline-block;
          background:#16a34a;
          padding:10px 18px;
          border-radius:999px;
          font-weight:bold;
          margin-bottom:30px;
        }

        h1{
          font-size:72px;
          line-height:1.1;
          margin-bottom:20px;
        }

        p{
          color:#d1d5db;
          font-size:20px;
          line-height:1.8;
          max-width:700px;
          margin:auto;
        }

        .buttons{
          margin-top:40px;
          display:flex;
          justify-content:center;
          gap:16px;
          flex-wrap:wrap;
        }

        button{
          padding:14px 28px;
          border:none;
          border-radius:14px;
          font-size:16px;
          font-weight:bold;
          cursor:pointer;
        }

        .primary{
          background:#22c55e;
          color:black;
        }

        .secondary{
          background:transparent;
          color:white;
          border:1px solid #4b5563;
        }

        .cards{
          display:grid;
          grid-template-columns:repeat(auto-fit,minmax(250px,1fr));
          gap:20px;
          margin-top:100px;
        }

        .card{
          background:rgba(255,255,255,0.05);
          border:1px solid rgba(255,255,255,0.1);
          border-radius:20px;
          padding:30px;
          backdrop-filter:blur(8px);
          text-align:left;
        }

        .card h3{
          margin-bottom:15px;
        }

      </style>
    </head>

    <body>

      <div class="container">

        <div class="badge">♠ Poker Royale</div>

        <h1>
          Play Smart.<br/>
          Win Big.
        </h1>

        <p>
          Real-time Texas Hold'em experience with multiplayer poker tables,
          live voice chat and smooth casino gameplay.
        </p>

        <div class="buttons">
          <button class="primary">Start Playing</button>
          <button class="secondary">Watch Demo</button>
        </div>

        <div class="cards">

          <div class="card">
            <h3>🎮 Multiplayer</h3>
            <p>Join live poker rooms and challenge real players.</p>
          </div>

          <div class="card">
            <h3>🎤 Voice Chat</h3>
            <p>Talk with friends during gameplay using WebRTC.</p>
          </div>

          <div class="card">
            <h3>🏆 Ranked Tables</h3>
            <p>Climb the leaderboard and become the poker king.</p>
          </div>

        </div>

      </div>

    </body>
  </html>
  `);
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
