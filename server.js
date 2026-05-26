const express = require("express");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 8080;

function homePage() {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#07150d" />
  <title>Poker Royale</title>
  <style>
    :root {
      --bg: #06120b;
      --bg2: #020403;
      --card: rgba(2, 16, 10, 0.82);
      --card2: rgba(255, 255, 255, 0.055);
      --gold: #facc15;
      --gold2: #d97706;
      --green: #22c55e;
      --green2: #14532d;
      --text: #fff7ad;
      --muted: #cbd5e1;
      --border: rgba(250, 204, 21, 0.24);
      --shadow: rgba(0, 0, 0, 0.42);
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    html, body {
      margin: 0;
      min-height: 100%;
      font-family: Tahoma, Arial, sans-serif;
      background:
        radial-gradient(circle at 20% 0%, rgba(250, 204, 21, 0.18), transparent 28%),
        radial-gradient(circle at 82% 10%, rgba(34, 197, 94, 0.18), transparent 32%),
        radial-gradient(circle at center, #0f5132 0%, #07150d 45%, #020403 100%);
      color: white;
    }

    body {
      padding: calc(18px + env(safe-area-inset-top)) 14px calc(22px + env(safe-area-inset-bottom));
      overflow-x: hidden;
    }

    .page {
      width: 100%;
      max-width: 960px;
      margin: 0 auto;
    }

    .hero {
      position: relative;
      border: 1px solid var(--border);
      border-radius: 30px;
      padding: 22px 18px;
      background:
        linear-gradient(145deg, rgba(0, 0, 0, 0.62), rgba(2, 18, 10, 0.72)),
        radial-gradient(circle at top right, rgba(250, 204, 21, 0.18), transparent 42%),
        radial-gradient(circle at bottom left, rgba(34, 197, 94, 0.16), transparent 48%);
      box-shadow: 0 22px 70px var(--shadow), inset 0 1px 0 rgba(255,255,255,0.08);
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: -80px -120px auto auto;
      width: 240px;
      height: 240px;
      border-radius: 50%;
      background: rgba(250, 204, 21, 0.10);
      filter: blur(6px);
    }

    .topbar {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 13px;
      min-width: 0;
    }

    .logo-mark {
      width: 64px;
      height: 64px;
      flex: 0 0 64px;
      border-radius: 22px;
      display: grid;
      place-items: center;
      background: linear-gradient(160deg, #fff7ad 0%, var(--gold) 42%, #b45309 100%);
      color: #08111f;
      font-weight: 1000;
      font-size: 25px;
      letter-spacing: 1px;
      box-shadow: 0 14px 34px rgba(250, 204, 21, 0.26);
    }

    .brand h1 {
      margin: 0;
      font-family: Arial, Tahoma, sans-serif;
      direction: ltr;
      text-align: right;
      font-size: clamp(34px, 8vw, 64px);
      line-height: 0.95;
      color: var(--text);
      text-shadow: 0 0 26px rgba(250, 204, 21, 0.20);
      white-space: nowrap;
    }

    .brand p {
      margin: 9px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
    }

    .lang {
      border: 1px solid rgba(250, 204, 21, 0.45);
      background: rgba(0, 0, 0, 0.45);
      color: var(--gold);
      border-radius: 999px;
      padding: 12px 16px;
      min-width: 62px;
      font-weight: 900;
      font-size: 16px;
      box-shadow: inset 0 0 0 1px rgba(250,204,21,0.10);
    }

    .hero-title {
      position: relative;
      margin: 28px 0 8px;
      color: var(--gold);
      font-size: clamp(24px, 6vw, 42px);
      line-height: 1.35;
      font-weight: 1000;
      letter-spacing: -0.5px;
    }

    .hero-subtitle {
      position: relative;
      margin: 0;
      color: #e5e7eb;
      font-size: 15px;
      line-height: 1.9;
      max-width: 720px;
    }

    .games-section {
      margin-top: 22px;
    }

    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 12px;
      margin: 0 4px 14px;
    }

    .section-head h2 {
      margin: 0;
      color: var(--text);
      font-size: 22px;
    }

    .section-head span {
      color: var(--muted);
      font-size: 13px;
    }

    .games-grid {
      display: grid;
      grid-template-columns: 1fr;
      gap: 15px;
    }

    .game-card {
      position: relative;
      min-height: 150px;
      border: 1px solid var(--border);
      border-radius: 30px;
      padding: 20px;
      display: flex;
      align-items: center;
      gap: 18px;
      overflow: hidden;
      background:
        linear-gradient(145deg, rgba(255,255,255,0.075), rgba(255,255,255,0.025)),
        radial-gradient(circle at 12% 50%, var(--glow), transparent 36%),
        var(--card);
      box-shadow: 0 16px 46px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.07);
      text-decoration: none;
      color: white;
      transition: transform 0.18s ease, border-color 0.18s ease;
    }

    .game-card:active {
      transform: scale(0.985);
      border-color: rgba(250,204,21,0.72);
    }

    .game-icon {
      width: 88px;
      height: 88px;
      flex: 0 0 88px;
      border-radius: 28px;
      display: grid;
      place-items: center;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.16);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 14px 30px rgba(0,0,0,0.28);
      font-size: 44px;
    }

    .game-info {
      min-width: 0;
      flex: 1;
    }

    .game-info h3 {
      margin: 0;
      color: #fff7ad;
      font-size: clamp(28px, 8vw, 46px);
      line-height: 1.1;
      font-weight: 1000;
      letter-spacing: -0.8px;
    }

    .game-info p {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.7;
    }

    .game-status {
      position: absolute;
      top: 16px;
      left: 16px;
      border: 1px solid rgba(250,204,21,0.32);
      background: rgba(250,204,21,0.10);
      color: var(--gold);
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 900;
      white-space: nowrap;
    }

    .footer-nav {
      position: sticky;
      bottom: calc(10px + env(safe-area-inset-bottom));
      margin-top: 22px;
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 10px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      background: rgba(0,0,0,0.62);
      backdrop-filter: blur(16px);
      box-shadow: 0 -12px 38px rgba(0,0,0,0.34);
    }

    .nav-item {
      border: 0;
      border-radius: 18px;
      padding: 12px 8px;
      background: rgba(255,255,255,0.055);
      color: #e5e7eb;
      font-weight: 900;
      font-size: 13px;
    }

    .nav-item.active {
      background: linear-gradient(135deg, var(--gold), var(--gold2));
      color: #111827;
    }

    .toast {
      position: fixed;
      right: 14px;
      left: 14px;
      bottom: calc(86px + env(safe-area-inset-bottom));
      z-index: 20;
      border-radius: 18px;
      padding: 13px 15px;
      background: rgba(0,0,0,0.78);
      border: 1px solid rgba(250,204,21,0.32);
      color: white;
      text-align: center;
      transform: translateY(20px);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.22s ease, transform 0.22s ease;
    }

    .toast.show {
      opacity: 1;
      transform: translateY(0);
    }

    @media (min-width: 760px) {
      .games-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 430px) {
      body { padding-left: 12px; padding-right: 12px; }
      .hero { border-radius: 26px; padding: 18px 16px; }
      .logo-mark { width: 56px; height: 56px; flex-basis: 56px; border-radius: 19px; }
      .brand { gap: 10px; }
      .brand h1 { font-size: 38px; }
      .brand p { font-size: 13px; }
      .game-card { min-height: 142px; border-radius: 26px; padding: 18px; gap: 14px; }
      .game-icon { width: 76px; height: 76px; flex-basis: 76px; border-radius: 24px; font-size: 38px; }
      .game-info h3 { font-size: 31px; }
      .game-info p { font-size: 13px; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section class="hero">
      <div class="topbar">
        <div class="brand">
          <div class="logo-mark">PR</div>
          <div>
            <h1>Poker Royale</h1>
            <p>ÙØ±Ú©Ø² Ø¨Ø§Ø²ÛâÙØ§Û Ø¢ÙÙØ§ÛÙ Ú©ÙØ§Ø³ÛÚ©Ø Ø±ÙØ§Ø¨ØªØ Ø³Ø±Ú¯Ø±ÙÛ Ù ÙÛØ¬Ø§Ù Ø¯Ø± ÛÚ© ØµÙØ­Ù ØªÙÛØ² Ù Ø³Ø±ÛØ¹.</p>
          </div>
        </div>
        <button class="lang" type="button" onclick="toggleLang()">FA</button>
      </div>

      <h2 class="hero-title">Ø¨Ø§Ø²Û ÙÙØ±Ø¯ Ø¹ÙØ§ÙÙâØ§Øª Ø±Ø§ Ø§ÙØªØ®Ø§Ø¨ Ú©Ù</h2>
      <p class="hero-subtitle">ÙØ¹ÙØ§Ù ØµÙØ­Ù Ø§ØµÙÛ Ø±Ø§ Ø­Ø±ÙÙâØ§Û ÙÛâÚ©ÙÛÙØ Ø¨Ø¹Ø¯ Ø¨Ø§Ø²ÛâÙØ§ Ø±Ø§ ÛÚ©ÛâÛÚ©Û Ú©Ø§ÙÙ Ù Ø¢ÙÙØ§ÛÙ ÙÛâØ³Ø§Ø²ÛÙ.</p>
    </section>

    <section class="games-section">
      <div class="section-head">
        <h2>ÙÛØ³Øª Ø¨Ø§Ø²ÛâÙØ§</h2>
        <span>Ûµ Ø¨Ø§Ø²Û Ú©ÙØ§Ø³ÛÚ©</span>
      </div>

      <div class="games-grid">
        <a class="game-card" href="#" style="--glow: rgba(250,204,21,0.18)" onclick="soon(event, 'Ø´Ø·Ø±ÙØ¬')">
          <div class="game-status">Ø¨ÙâØ²ÙØ¯Û</div>
          <div class="game-icon">âï¸</div>
          <div class="game-info">
            <h3>Ø´Ø·Ø±ÙØ¬</h3>
            <p>Ø±ÙØ§Ø¨Øª ÙÚ©Ø±Û Ø¯Ù ÙÙØ±Ù Ø¨Ø§ ÙÛØ² Ø¢ÙÙØ§ÛÙ Ù Ø²ÙØ§ÙâØ¨ÙØ¯Û Ø§Ø®ØªØµØ§ØµÛ.</p>
          </div>
        </a>

        <a class="game-card" href="#" style="--glow: rgba(34,197,94,0.18)" onclick="soon(event, 'ÙÙÚ')">
          <div class="game-status">Ø¨ÙâØ²ÙØ¯Û</div>
          <div class="game-icon">ð²</div>
          <div class="game-info">
            <h3>ÙÙÚ</h3>
            <p>Ø¨Ø§Ø²Û ÙÙØ³ØªØ§ÙÚÛÚ© Ø®Ø§ÙÙØ§Ø¯Ú¯Û Ø¨Ø§ ØªØ§Ø³Ø ÙÙØ±Ù Ù Ø§ØªØ§ÙâÙØ§Û ÚÙØ¯ ÙÙØ±Ù.</p>
          </div>
        </a>

        <a class="game-card" href="#" style="--glow: rgba(245,158,11,0.20)" onclick="soon(event, 'ØªØ®ØªÙ ÙØ±Ø¯')">
          <div class="game-status">Ø¨ÙâØ²ÙØ¯Û</div>
          <div class="game-icon">â«</div>
          <div class="game-info">
            <h3>ØªØ®ØªÙ ÙØ±Ø¯</h3>
            <p>ÙÛØ² Ú©ÙØ§Ø³ÛÚ©Ø ØªØ§Ø³ ÙØ§ÙØ¹ÛØ ÙØ³Ø§Ø¨ÙÙ Ø¯Ù ÙÙØ±Ù Ù Ø§ÙØªÛØ§Ø²Ø¯ÙÛ Ø¢ÙÙØ§ÛÙ.</p>
          </div>
        </a>

        <a class="game-card" href="#" style="--glow: rgba(239,68,68,0.18)" onclick="soon(event, 'Ø­Ú©Ù')">
          <div class="game-status">Ø¨ÙâØ²ÙØ¯Û</div>
          <div class="game-icon">ð¡</div>
          <div class="game-info">
            <h3>Ø­Ú©Ù</h3>
            <p>Ø¨Ø§Ø²Û Ú©Ø§Ø±Øª ÚÙØ§Ø± ÙÙØ±Ù Ø¨Ø§ ØªÛÙâØ¨ÙØ¯ÛØ Ø­Ú©ÙâÚ¯ÛØ±Û Ù Ø¯Ø³ØªâÙØ§Û Ø¢ÙÙØ§ÛÙ.</p>
          </div>
        </a>

        <a class="game-card" href="#" style="--glow: rgba(59,130,246,0.18)" onclick="soon(event, 'ÚÙØ§Ø± Ø¨Ø±Ú¯')">
          <div class="game-status">Ø¨ÙâØ²ÙØ¯Û</div>
          <div class="game-icon">â£ï¸</div>
          <div class="game-info">
            <h3>ÚÙØ§Ø± Ø¨Ø±Ú¯</h3>
            <p>Ø¨Ø§Ø²Û Ø³Ø±ÛØ¹ Ú©Ø§Ø±ØªÛ Ø¨Ø§ Ø§ÙØªÛØ§Ø²Ú¯ÛØ±ÛØ Ø±ÙØ§Ø¨Øª Ù ÙÛØ²ÙØ§Û Ø¢ÙÙØ§ÛÙ.</p>
          </div>
        </a>
      </div>
    </section>

    <nav class="footer-nav">
      <button class="nav-item active" type="button">Ø®Ø§ÙÙ</button>
      <button class="nav-item" type="button" onclick="soon(event, 'Ù¾Ø±ÙÙØ§ÛÙ')">Ù¾Ø±ÙÙØ§ÛÙ</button>
      <button class="nav-item" type="button" onclick="soon(event, 'Ø±ØªØ¨ÙâØ¨ÙØ¯Û')">Ø±ØªØ¨ÙâØ¨ÙØ¯Û</button>
    </nav>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    function soon(event, name) {
      if (event) event.preventDefault();
      const toast = document.getElementById('toast');
      toast.textContent = name + ' Ø¨ÙâØ²ÙØ¯Û ÙØ¹Ø§Ù ÙÛâØ´ÙØ¯';
      toast.classList.add('show');
      clearTimeout(window.__toastTimer);
      window.__toastTimer = setTimeout(function () {
        toast.classList.remove('show');
      }, 2200);
    }

    function toggleLang() {
      soon(null, 'Ø²Ø¨Ø§Ù Ø§ÙÚ¯ÙÛØ³Û');
    }
  </script>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(homePage());
});

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "Poker Royale", version: "home-ui-v2-fixed" });
});

app.use((req, res) => {
  res.redirect("/");
});

app.listen(PORT, () => {
  console.log("Poker Royale home UI running on port " + PORT);
});
