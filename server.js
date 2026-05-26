const express = require("express");
const app = express();

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head>
        <title>Poker Royale</title>
        <style>
          body{
            background:#0b1020;
            color:white;
            font-family:sans-serif;
            display:flex;
            justify-content:center;
            align-items:center;
            height:100vh;
            flex-direction:column;
          }
          h1{
            color:#00ff99;
          }
        </style>
      </head>
      <body>
        <h1>♠ Poker Royale ♥</h1>
        <p>Server is running successfully</p>
      </body>
    </html>
  `);
});

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
