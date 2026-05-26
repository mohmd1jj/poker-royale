const express = require('express');
const app = express();

const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ ok: true, service: 'poker-royale-home', time: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <meta name="theme-color" content="#04130b" />
  <title>Poker Royale</title>
  <style>
    :root {
      --bg: #04130b;
      --bg2: #071f13;
      --panel: rgba(2, 13, 8, 0.78);
      --panel2: rgba(7, 31, 19, 0.88);
      --gold: #facc15;
      --gold2: #d97706;
      --green: #22c55e;
      --green2: #14532d;
      --muted: #cbd5e1;
      --line: rgba(250, 204, 21, 0.22);
      --white: #fff7cc;
      --shadow: rgba(0, 0, 0, 0.45);
    }

    * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }

    html, body { margin: 0; min-height: 100%; }

    body {
      font-family: Tahoma, Arial, sans-serif;
      color: white;
      background:
        radial-gradient(circle at 20% 0%, rgba(250, 204, 21, 0.18), transparent 28%),
        radial-gradient(circle at 84% 10%, rgba(34, 197, 94, 0.18), transparent 34%),
        linear-gradient(180deg, #0b2416 0%, #04130b 50%, #010603 100%);
      padding: calc(14px + env(safe-area-inset-top)) 14px calc(26px + env(safe-area-inset-bottom));
      overflow-x: hidden;
    }

    .shell { width: 100%; max-width: 1020px; margin: 0 auto; }

    .hero {
      position: relative;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 30px;
      padding: 20px;
      background:
        radial-gradient(circle at 15% 20%, rgba(250, 204, 21, 0.18), transparent 34%),
        linear-gradient(145deg, rgba(0, 0, 0, 0.78), rgba(5, 46, 22, 0.46));
      box-shadow: 0 22px 70px var(--shadow), inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }

    .hero-top { display: flex; align-items: center; justify-content: space-between; gap: 14px; }

    .brand { display: flex; align-items: center; gap: 12px; min-width: 0; }

    .brand-mark {
      width: 64px;
      height: 64px;
      border-radius: 20px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #fff7ad, #facc15 48%, #b45309 100%);
      color: #07111f;
      font-weight: 1000;
      letter-spacing: -2px;
      font-size: 24px;
      box-shadow: 0 0 34px rgba(250, 204, 21, 0.28);
      flex: 0 0 auto;
    }

    .brand h1 {
      margin: 0;
      font-size: clamp(30px, 9vw, 58px);
      line-height: 0.95;
      color: var(--gold);
      text-shadow: 0 0 26px rgba(250, 204, 21, 0.28);
      direction: ltr;
      text-align: left;
    }

    .brand p {
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
    }

    .lang {
      border: 1px solid rgba(250, 204, 21, 0.45);
      background: rgba(0, 0, 0, 0.4);
      color: var(--gold);
      border-radius: 999px;
      padding: 12px 16px;
      font-weight: 1000;
      box-shadow: inset 0 0 0 1px rgba(250,204,21,0.12);
    }

    .headline { margin: 22px 0 0; }

    .headline h2 {
      margin: 0;
      font-size: clamp(25px, 7vw, 46px);
      line-height: 1.35;
      color: var(--white);
    }

    .headline p {
      margin: 10px 0 0;
      color: var(--muted);
      line-height: 1.9;
      font-size: 15px;
    }

    .section-title {
      margin: 24px 4px 14px;
      color: var(--gold);
      font-size: 22px;
      font-weight: 1000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .section-title span:last-child {
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      border: 1px solid rgba(250, 204, 21, 0.24);
      border-radius: 999px;
      padding: 7px 10px;
      background: rgba(0, 0, 0, 0.28);
    }

    .games {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .game-card {
      position: relative;
      min-height: 170px;
      border-radius: 28px;
      border: 1px solid rgba(250, 204, 21, 0.20);
      background:
        radial-gradient(circle at 18% 22%, var(--glow), transparent 32%),
        linear-gradient(145deg, rgba(0,0,0,0.70), rgba(7,31,19,0.82));
      box-shadow: 0 18px 52px rgba(0,0,0,0.36), inset 0 1px 0 rgba(255,255,255,0.07);
      padding: 18px;
      overflow: hidden;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }

    .game-card::after {
      content: "";
      position: absolute;
      inset: auto -28px -44px auto;
      width: 150px;
      height: 150px;
      border-radius: 50%;
      border: 28px solid rgba(255,255,255,0.035);
      pointer-events: none;
    }

    .game-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; position: relative; z-index: 1; }

    .game-icon {
      width: 74px;
      height: 74px;
      border-radius: 24px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, rgba(255,255,255,0.12), rgba(255,255,255,0.03));
      border: 1px solid rgba(255,255,255,0.16);
      color: var(--accent);
      font-size: 27px;
      font-weight: 1000;
      direction: ltr;
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.10), 0 12px 26px rgba(0,0,0,0.25);
    }

    .badge {
      border: 1px solid rgba(250, 204, 21, 0.34);
      color: var(--gold);
      border-radius: 999px;
      padding: 7px 11px;
      font-size: 12px;
      font-weight: 1000;
      background: rgba(0,0,0,0.32);
      white-space: nowrap;
    }

    .game-name {
      position: relative;
      z-index: 1;
      margin: 16px 0 0;
      color: var(--white);
      font-size: clamp(25px, 6vw, 36px);
      font-weight: 1000;
      line-height: 1.25;
    }

    .game-desc {
      position: relative;
      z-index: 1;
      margin: 8px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.8;
    }

    .bottom-nav {
      position: sticky;
      bottom: calc(12px + env(safe-area-inset-bottom));
      margin-top: 20px;
      border: 1px solid rgba(250,204,21,0.20);
      border-radius: 26px;
      background: rgba(0,0,0,0.66);
      backdrop-filter: blur(14px);
      box-shadow: 0 -12px 34px rgba(0,0,0,0.35);
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      padding: 9px;
      z-index: 10;
    }

    .nav-item {
      border: 0;
      border-radius: 18px;
      padding: 12px 8px;
      background: transparent;
      color: var(--muted);
      font-weight: 900;
      font-family: inherit;
    }

    .nav-item.active {
      background: linear-gradient(135deg, rgba(250,204,21,0.24), rgba(34,197,94,0.11));
      color: var(--gold);
    }

    .toast {
      position: fixed;
      left: 14px;
      right: 14px;
      bottom: calc(92px + env(safe-area-inset-bottom));
      max-width: 520px;
      margin: 0 auto;
      border-radius: 18px;
      padding: 14px 16px;
      background: rgba(0,0,0,0.82);
      border: 1px solid rgba(250,204,21,0.26);
      color: var(--white);
      font-weight: 900;
      box-shadow: 0 18px 46px rgba(0,0,0,0.46);
      opacity: 0;
      transform: translateY(12px);
      transition: 0.2s ease;
      pointer-events: none;
      text-align: center;
      z-index: 20;
    }

    .toast.show { opacity: 1; transform: translateY(0); }

    @media (max-width: 720px) {
      .hero { border-radius: 26px; padding: 16px; }
      .brand-mark { width: 58px; height: 58px; border-radius: 18px; font-size: 22px; }
      .brand p { font-size: 13px; }
      .games { grid-template-columns: 1fr; }
      .game-card { min-height: 158px; border-radius: 26px; }
      .game-icon { width: 68px; height: 68px; border-radius: 22px; }
    }
  </style>
</head>
<body>
  <main class="shell">
    <section class="hero">
      <div class="hero-top">
        <div class="brand">
          <div class="brand-mark">PR</div>
          <div>
            <h1>Poker Royale</h1>
            <p>&#1662;&#1604;&#1578;&#1601;&#1585;&#1605; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606; &#1705;&#1604;&#1575;&#1587;&#1740;&#1705;</p>
          </div>
        </div>
        <button class="lang" type="button">FA</button>
      </div>

      <div class="headline">
        <h2>&#1576;&#1575;&#1586;&#1740; &#1605;&#1608;&#1585;&#1583; &#1593;&#1604;&#1575;&#1602;&#1607;&#8204;&#1575;&#1578; &#1585;&#1575; &#1575;&#1606;&#1578;&#1582;&#1575;&#1576; &#1705;&#1606;</h2>
        <p>&#1601;&#1593;&#1604;&#1575;&#1611; &#1585;&#1608;&#1740; &#1592;&#1575;&#1607;&#1585; &#1589;&#1601;&#1581;&#1607; &#1575;&#1589;&#1604;&#1740; &#1705;&#1575;&#1585; &#1605;&#1740;&#8204;&#1705;&#1606;&#1740;&#1605;. &#1576;&#1593;&#1583;&#1575;&#1611; &#1607;&#1585; &#1576;&#1575;&#1586;&#1740; &#1585;&#1575; &#1580;&#1583;&#1575;&#1711;&#1575;&#1606;&#1607; &#1705;&#1575;&#1605;&#1604; &#1605;&#1740;&#8204;&#1705;&#1606;&#1740;&#1605;.</p>
      </div>
    </section>

    <div class="section-title">
      <span>&#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;</span>
      <span>&#1606;&#1587;&#1582;&#1607; &#1570;&#1586;&#1605;&#1575;&#1740;&#1588;&#1740;</span>
    </div>

    <section class="games" aria-label="Games">
      <article class="game-card" style="--accent:#facc15;--glow:rgba(250,204,21,0.18)" data-game="&#1588;&#1591;&#1585;&#1606;&#1580;">
        <div class="game-top"><div class="game-icon">CH</div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1588;&#1591;&#1585;&#1606;&#1580;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1575;&#1587;&#1578;&#1585;&#1575;&#1578;&#1688;&#1740;&#1705; &#1583;&#1608; &#1606;&#1601;&#1585;&#1607;</div></div>
      </article>

      <article class="game-card" style="--accent:#22c55e;--glow:rgba(34,197,94,0.18)" data-game="&#1605;&#1606;&#1670;">
        <div class="game-top"><div class="game-icon">MN</div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1605;&#1606;&#1670;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1583;&#1608;&#1585;&#1607;&#1605;&#1740; &#1608; &#1587;&#1585;&#1711;&#1585;&#1605;&#8204;&#1705;&#1606;&#1606;&#1583;&#1607;</div></div>
      </article>

      <article class="game-card" style="--accent:#fb923c;--glow:rgba(251,146,60,0.18)" data-game="&#1578;&#1582;&#1578;&#1607; &#1606;&#1585;&#1583;">
        <div class="game-top"><div class="game-icon">BG</div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1578;&#1582;&#1578;&#1607; &#1606;&#1585;&#1583;</div><div class="game-desc">&#1705;&#1604;&#1575;&#1587;&#1740;&#1705;&#1548; &#1587;&#1585;&#1740;&#1593; &#1608; &#1585;&#1602;&#1575;&#1576;&#1578;&#1740;</div></div>
      </article>

      <article class="game-card" style="--accent:#ef4444;--glow:rgba(239,68,68,0.18)" data-game="&#1581;&#1705;&#1605;">
        <div class="game-top"><div class="game-icon">HK</div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1581;&#1705;&#1605;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1605;&#1581;&#1576;&#1608;&#1576; &#1608; &#1578;&#1740;&#1605;&#1740;</div></div>
      </article>

      <article class="game-card" style="--accent:#60a5fa;--glow:rgba(96,165,250,0.18)" data-game="&#1670;&#1607;&#1575;&#1585; &#1576;&#1585;&#1711;">
        <div class="game-top"><div class="game-icon">4B</div><div class="badge">&#1576;&#1607;&#8204;&#1586;&#1608;&#1583;&#1740;</div></div>
        <div><div class="game-name">&#1670;&#1607;&#1575;&#1585; &#1576;&#1585;&#1711;</div><div class="game-desc">&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1587;&#1575;&#1583;&#1607;&#1548; &#1587;&#1585;&#1740;&#1593; &#1608; &#1607;&#1740;&#1580;&#1575;&#1606;&#1740;</div></div>
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
    function showToast(message) {
      toast.textContent = message + ' - ' + '\u0628\u0647\u200c\u0632\u0648\u062f\u06cc \u0641\u0639\u0627\u0644 \u0645\u06cc\u200c\u0634\u0648\u062f';
      toast.classList.add('show');
      clearTimeout(timer);
      timer = setTimeout(function(){ toast.classList.remove('show'); }, 2200);
    }
    document.querySelectorAll('.game-card').forEach(function(card) {
      card.addEventListener('click', function() {
        showToast(card.getAttribute('data-game') || 'Game');
      });
    });
  </script>
</body>
</html>`);
});

app.listen(PORT, () => {
  console.log('Poker Royale Home UI running on port ' + PORT);
});
