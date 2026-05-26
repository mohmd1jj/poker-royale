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
background: radial-gradient(circle at top,#14532d,#0f172a 70%);
min-height:100vh;
font-family:Arial;
color:white;
overflow-x:hidden;
}

.topbar{
display:flex;
justify-content:space-between;
align-items:center;
padding:20px 40px;
}

.logo{
font-size:32px;
font-weight:bold;
color:#22c55e;
}

.balance{
background:#111827;
padding:12px 20px;
border-radius:14px;
}

.lobby{
display:flex;
justify-content:center;
gap:20px;
margin-top:20px;
flex-wrap:wrap;
}

.room{
background:rgba(255,255,255,0.08);
padding:20px;
border-radius:20px;
width:220px;
border:1px solid rgba(255,255,255,0.1);
}

.room h3{
margin-bottom:10px;
}

.join-btn{
margin-top:15px;
width:100%;
padding:12px;
border:none;
border-radius:12px;
background:#22c55e;
font-weight:bold;
cursor:pointer;
}

.table-wrapper{
display:flex;
justify-content:center;
margin-top:50px;
}

.table{
width:950px;
height:520px;
background:#166534;
border:18px solid #3f2a14;
border-radius:300px;
position:relative;
box-shadow:0 0 60px rgba(0,0,0,0.5);
}

.community{
position:absolute;
top:50%;
left:50%;
transform:translate(-50%,-50%);
text-align:center;
}

.community h2{
color:#facc15;
margin-bottom:15px;
}

.cards{
display:flex;
gap:10px;
}

.card{
width:72px;
height:102px;
background:white;
border-radius:12px;
color:black;
display:flex;
justify-content:center;
align-items:center;
font-size:28px;
font-weight:bold;
}

.player{
position:absolute;
width:160px;
text-align:center;
}

.avatar{
width:74px;
height:74px;
border-radius:50%;
background:#1f2937;
border:4px solid #22c55e;
margin:auto;
}

.player-name{
margin-top:10px;
font-weight:bold;
}

.chips{
color:#facc15;
margin-top:6px;
}

.player-cards{
display:flex;
justify-content:center;
gap:6px;
margin-top:10px;
}

.mini-card{
width:40px;
height:56px;
background:white;
border-radius:8px;
color:black;
display:flex;
justify-content:center;
align-items:center;
font-size:18px;
font-weight:bold;
}

.p1{
bottom:-20px;
left:50%;
transform:translateX(-50%);
}

.p2{
top:20px;
left:80px;
}

.p3{
top:20px;
right:80px;
}

.dealer{
background:#facc15;
color:black;
display:inline-block;
padding:4px 10px;
border-radius:999px;
font-size:12px;
font-weight:bold;
margin-top:8px;
}

.controls{
position:fixed;
bottom:30px;
width:100%;
display:flex;
justify-content:center;
gap:20px;
flex-wrap:wrap;
}

button.action{
padding:16px 28px;
border:none;
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
right:30px;
top:120px;
background:#111827;
padding:20px;
border-radius:20px;
width:220px;
}

.voice h3{
margin-bottom:15px;
}

.mic{
width:60px;
height:60px;
border-radius:50%;
background:#22c55e;
display:flex;
justify-content:center;
align-items:center;
font-size:28px;
margin:auto;
}

.status{
text-align:center;
margin-top:20px;
color:#22c55e;
font-weight:bold;
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

<div class="lobby">

<div class="room">
<h3>🔥 High Stakes</h3>
<p>Players: 5/6</p>
<p>Blind: $500 / $1000</p>
<button class="join-btn">Join Table</button>
</div>

<div class="room">
<h3>🎯 Casual Room</h3>
<p>Players: 3/6</p>
<p>Blind: $50 / $100</p>
<button class="join-btn">Join Table</button>
</div>

<div class="room">
<h3>👑 VIP Room</h3>
<p>Players: 2/6</p>
<p>Blind: $2000 / $4000</p>
<button class="join-btn">Join Table</button>
</div>

</div>

<div class="table-wrapper">

<div class="table">

<div class="community">
<h2>Pot: $8,400</h2>

<div class="cards">
<div class="card">A♠</div>
<div class="card">K♥</div>
<div class="card">10♣</div>
<div class="card">7♦</div>
<div class="card">Q♠</div>
</div>

<div class="status">
Current Turn: You
</div>

</div>

<div class="player p1">
<div class="avatar"></div>
<div class="player-name">You</div>
<div class="chips">$12,500</div>

<div class="player-cards">
<div class="mini-card">A♦</div>
<div class="mini-card">K♦</div>
</div>

<div class="dealer">DEALER</div>

</div>

<div class="player p2">
<div class="avatar"></div>
<div class="player-name">Alex</div>
<div class="chips">$9,800</div>

<div class="player-cards">
<div class="mini-card">?</div>
<div class="mini-card">?</div>
</div>

</div>

<div class="player p3">
<div class="avatar"></div>
<div class="player-name">Daniel</div>
<div class="chips">$15,400</div>

<div class="player-cards">
<div class="mini-card">?</div>
<div class="mini-card">?</div>
</div>

</div>

</div>

</div>

<div class="voice">
<h3>🎤 Voice Chat</h3>

<div class="mic">
🎙️
</div>

<p style="margin-top:15px;text-align:center;">
Voice Connected
</p>

</div>

<div class="controls">

<button class="action fold">
Fold
</button>

<button class="action call">
Call $500
</button>

<button class="action raise">
Raise
</button>

</div>

</body>
</html>
`);
});

const PORT = process.env.PORT || 8080;

app.listen(PORT, () => {
  console.log("Poker Royale running on port " + PORT);
});
