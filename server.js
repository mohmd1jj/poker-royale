const express = require("express");
const app = express();

const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ ok: true, app: "Poker Royale", page: "Home UI v2" });
});

function pageHtml() {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <title>Poker Royale</title>
  <style>
    :root {
      --bg-1: #03160d;
      --bg-2: #061f13;
      --panel: rgba(2, 12, 8, 0.76);
      --panel-2: rgba(255, 255, 255, 0.055);
      --gold: #facc15;
      --gold-2: #d97706;
      --green: #22c55e;
      --green-2: #166534;
      --text: #fff7c2;
      --muted: #cbd5e1;
      --line: rgba(250, 204, 21, 0.24);
      --shadow: rgba(0, 0, 0, 0.55);
    }

    * {
      box-sizing: border-box;
      -webkit-tap-highlight-color: transparent;
    }

    body {
      margin: 0;
      min-height: 100vh;
      font-family: Arial, Tahoma, sans-serif;
      color: white;
      background:
        radial-gradient(circle at 15% 0%, rgba(250, 204, 21, 0.18), transparent 32%),
        radial-gradient(circle at 85% 8%, rgba(34, 197, 94, 0.18), transparent 34%),
        radial-gradient(circle at 50% 35%, rgba(21, 128, 61, 0.38), transparent 45%),
        linear-gradient(180deg, var(--bg-2), #010403 72%);
      overflow-x: hidden;
      padding: calc(14px + env(safe-area-inset-top)) 14px calc(24px + env(safe-area-inset-bottom));
    }

    .app {
      width: 100%;
      max-width: 980px;
      margin: 0 auto;
    }

    .topbar {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      padding: 14px;
      border: 1px solid var(--line);
      border-radius: 28px;
      background: linear-gradient(135deg, rgba(0,0,0,0.68), rgba(5, 46, 22, 0.36));
      box-shadow: 0 18px 48px var(--shadow), inset 0 1px 0 rgba(255,255,255,0.08);
      backdrop-filter: blur(12px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .brand-mark {
      width: 54px;
      height: 54px;
      border-radius: 18px;
      display: grid;
      place-items: center;
      background: linear-gradient(180deg, #fff7ad, var(--gold), var(--gold-2));
      color: #08120c;
      font-weight: 1000;
      font-size: 22px;
      box-shadow: 0 0 34px rgba(250,204,21,0.35), inset 0 1px 0 rgba(255,255,255,0.58);
      flex: 0 0 auto;
    }

    .brand-title {
      min-width: 0;
    }

    .brand-title h1 {
      margin: 0;
      color: var(--gold);
      font-size: clamp(28px, 7vw, 54px);
      line-height: 1;
      letter-spacing: 0.5px;
      text-shadow: 0 0 22px rgba(250,204,21,0.28);
      direction: ltr;
      text-align: right;
    }

    .brand-title p {
      margin: 7px 0 0;
      color: var(--muted);
      font-size: 13px;
      line-height: 1.6;
    }

    .lang-btn {
      border: 1px solid rgba(250,204,21,0.46);
      background: rgba(0,0,0,0.45);
      color: var(--gold);
      border-radius: 999px;
      min-width: 58px;
      height: 58px;
      font-weight: 1000;
      font-size: 16px;
      box-shadow: inset 0 0 0 1px rgba(250,204,21,0.08), 0 10px 24px rgba(0,0,0,0.3);
    }

    .hero {
      margin: 18px 0 16px;
      padding: 24px 18px;
      border-radius: 30px;
      border: 1px solid rgba(250,204,21,0.22);
      background:
        linear-gradient(145deg, rgba(0,0,0,0.52), rgba(5,46,22,0.32)),
        radial-gradient(circle at top right, rgba(250,204,21,0.18), transparent 35%);
      box-shadow: 0 22px 58px var(--shadow), inset 0 1px 0 rgba(255,255,255,0.08);
    }

    .hero-kicker {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(250,204,21,0.26);
      background: rgba(250,204,21,0.1);
      color: var(--gold);
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.6px;
    }

    .hero h2 {
      margin: 16px 0 8px;
      color: var(--text);
      font-size: clamp(26px, 7vw, 50px);
      line-height: 1.22;
    }

    .hero p {
      margin: 0;
      color: var(--muted);
      font-size: 15px;
      line-height: 1.9;
    }

    .games-head {
      display: flex;
      justify-content: space-between;
      align-items: end;
      gap: 10px;
      margin: 22px 4px 12px;
    }

    .games-head h3 {
      margin: 0;
      color: var(--gold);
      font-size: 24px;
    }

    .games-head span {
      color: var(--muted);
      font-size: 12px;
    }

    .games-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }

    .game-card {
      position: relative;
      min-height: 210px;
      overflow: hidden;
      border: 1px solid rgba(250,204,21,0.22);
      border-radius: 30px;
      padding: 18px;
      background:
        radial-gradient(circle at 15% 12%, var(--accent-soft), transparent 38%),
        linear-gradient(145deg, rgba(255,255,255,0.075), rgba(255,255,255,0.018)),
        rgba(0,0,0,0.48);
      box-shadow: 0 18px 46px rgba(0,0,0,0.42), inset 0 1px 0 rgba(255,255,255,0.08);
      transition: transform 0.18s ease, border-color 0.18s ease;
      cursor: pointer;
      isolation: isolate;
    }

    .game-card:active {
      transform: scale(0.985);
    }

    .game-card::before {
      content: "";
      position: absolute;
      inset: -60% -20% auto auto;
      width: 190px;
      height: 190px;
      border-radius: 50%;
      background: var(--accent-soft);
      filter: blur(2px);
      opacity: 0.9;
      z-index: -1;
    }

    .game-top {
      display: flex;
      justify-content: space-between;
      align-items: start;
      gap: 12px;
    }

    .game-icon {
      width: 78px;
      height: 78px;
      border-radius: 26px;
      display: grid;
      place-items: center;
      background: linear-gradient(145deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04));
      border: 1px solid rgba(255,255,255,0.14);
      font-size: 38px;
      color: var(--accent);
      box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), 0 14px 28px rgba(0,0,0,0.25);
    }

    .badge {
      padding: 8px 12px;
      border-radius: 999px;
      border: 1px solid rgba(250,204,21,0.26);
      color: var(--gold);
      background: rgba(0,0,0,0.32);
      font-size: 11px;
      font-weight: 900;
      white-space: nowrap;
    }

    .game-title {
      margin: 22px 0 8px;
      color: var(--text);
      font-size: clamp(28px, 7vw, 42px);
      font-weight: 1000;
      line-height: 1.1;
    }

    .game-desc {
      margin: 0;
      color: var(--muted);
      font-size: 14px;
      line-height: 1.8;
    }

    .game-action {
      margin-top: 18px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      color: #07150d;
      background: linear-gradient(135deg, var(--gold), var(--gold-2));
      border-radius: 999px;
      padding: 12px 14px;
      font-weight: 1000;
      box-shadow: 0 14px 30px rgba(250,204,21,0.18);
    }

    .bottom-bar {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }

    .mini-card {
      padding: 14px 10px;
      text-align: center;
      border-radius: 22px;
      border: 1px solid rgba(250,204,21,0.17);
      background: rgba(0,0,0,0.38);
      color: var(--muted);
      font-size: 12px;
      line-height: 1.6;
    }

    .mini-card strong {
      display: block;
      color: var(--gold);
      font-size: 16px;
    }

    .toast {
      position: fixed;
      left: 50%;
      bottom: calc(22px + env(safe-area-inset-bottom));
      transform: translateX(-50%) translateY(120px);
      width: min(92vw, 420px);
      padding: 14px 16px;
      border-radius: 18px;
      border: 1px solid rgba(250,204,21,0.25);
      background: rgba(0,0,0,0.86);
      color: var(--text);
      box-shadow: 0 18px 42px rgba(0,0,0,0.55);
      text-align: center;
      z-index: 999;
      transition: transform 0.25s ease;
      line-height: 1.7;
    }

    .toast.show {
      transform: translateX(-50%) translateY(0);
    }

    @media (max-width: 760px) {
      body { padding-inline: 12px; }
      .topbar { border-radius: 24px; }
      .brand-mark { width: 48px; height: 48px; border-radius: 16px; font-size: 20px; }
      .brand-title p { font-size: 12px; }
      .lang-btn { min-width: 52px; height: 52px; }
      .hero { border-radius: 26px; }
      .games-grid { grid-template-columns: 1fr; }
      .game-card { min-height: 190px; border-radius: 28px; }
      .bottom-bar { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <main class="app">
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">PR</div>
        <div class="brand-title">
          <h1>Poker Royale</h1>
          <p data-i18n="subtitle">&#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606; &#1705;&#1604;&#1575;&#1587;&#1740;&#1705; &#1576;&#1575; &#1592;&#1575;&#1607;&#1585; &#1605;&#1583;&#1585;&#1606;</p>
        </div>
      </div>
      <button class="lang-btn" id="langBtn">EN</button>
    </header>

    <section class="hero">
      <div class="hero-kicker" data-i18n="kicker">&#1587;&#1575;&#1604;&#1606; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606;</div>
      <h2 data-i18n="heroTitle">&#1575;&#1606;&#1578;&#1582;&#1575;&#1576; &#1705;&#1606;&#1548; &#1608;&#1575;&#1585;&#1583; &#1576;&#1575;&#1586;&#1740; &#1588;&#1608;</h2>
      <p data-i18n="heroText">&#1575;&#1740;&#1606;&#1580;&#1575; &#1589;&#1601;&#1581;&#1607; &#1575;&#1589;&#1604;&#1740; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1587;&#1578;. &#1607;&#1585; &#1576;&#1575;&#1586;&#1740; &#1576;&#1607; &#1589;&#1608;&#1585;&#1578; &#1580;&#1583;&#1575;&#1711;&#1575;&#1606;&#1607; &#1578;&#1705;&#1605;&#1740;&#1604; &#1605;&#1740;&#8204;&#1588;&#1608;&#1583;.</p>
    </section>

    <div class="games-head">
      <h3 data-i18n="gamesTitle">&#1604;&#1740;&#1587;&#1578; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;</h3>
      <span data-i18n="gamesHint">&#1576;&#1607; &#1586;&#1608;&#1583;&#1740; &#1602;&#1575;&#1576;&#1604; &#1576;&#1575;&#1586;&#1740;</span>
    </div>

    <section class="games-grid" id="gamesGrid"></section>

    <section class="bottom-bar">
      <div class="mini-card"><strong data-i18n="mini1Title">&#1605;&#1608;&#1576;&#1575;&#1740;&#1604;&#1740;</strong><span data-i18n="mini1Text">&#1576;&#1607;&#1740;&#1606;&#1607; &#1576;&#1585;&#1575;&#1740; iPhone</span></div>
      <div class="mini-card"><strong data-i18n="mini2Title">&#1570;&#1606;&#1604;&#1575;&#1740;&#1606;</strong><span data-i18n="mini2Text">&#1570;&#1605;&#1575;&#1583;&#1607; &#1576;&#1585;&#1575;&#1740; &#1576;&#1575;&#1586;&#1740; &#1583;&#1608;&#1587;&#1578;&#1575;&#1606;&#1607;</span></div>
      <div class="mini-card"><strong data-i18n="mini3Title">&#1583;&#1585; &#1581;&#1575;&#1604; &#1587;&#1575;&#1582;&#1578;</strong><span data-i18n="mini3Text">&#1575;&#1605;&#1705;&#1575;&#1606;&#1575;&#1578; &#1576;&#1607; &#1605;&#1585;&#1608;&#1585; &#1575;&#1590;&#1575;&#1601;&#1607; &#1605;&#1740;&#8204;&#1588;&#1608;&#1606;&#1583;</span></div>
    </section>
  </main>

  <div class="toast" id="toast"></div>

  <script>
    const games = [
      {
        key: "chess",
        icon: "&#9823;",
        accent: "#facc15",
        accentSoft: "rgba(250,204,21,0.22)",
        fa: { title: "&#1588;&#1591;&#1585;&#1606;&#1580;", desc: "&#1585;&#1602;&#1575;&#1576;&#1578; &#1584;&#1607;&#1606;&#1740; &#1608; &#1575;&#1587;&#1578;&#1585;&#1575;&#1578;&#0693;&#1740;&#1705;", badge: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740;", action: "&#1608;&#1585;&#1608;&#1583; &#1576;&#1607; &#1576;&#1575;&#1586;&#1740;" },
        en: { title: "Chess", desc: "Strategic online board battle", badge: "SOON", action: "Open Game" }
      },
      {
        key: "mench",
        icon: "&#9861;",
        accent: "#22c55e",
        accentSoft: "rgba(34,197,94,0.22)",
        fa: { title: "&#1605;&#1606;&#1670;", desc: "&#1576;&#1575;&#1586;&#1740; &#1583;&#1608;&#1587;&#1578;&#1575;&#1606;&#1607; &#1608; &#1587;&#1585;&#06cc;&#1593;", badge: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740;", action: "&#1608;&#1585;&#1608;&#1583; &#1576;&#1607; &#1576;&#1575;&#1586;&#1740;" },
        en: { title: "Ludo", desc: "Fast casual multiplayer game", badge: "SOON", action: "Open Game" }
      },
      {
        key: "backgammon",
        icon: "&#9679;",
        accent: "#f59e0b",
        accentSoft: "rgba(245,158,11,0.24)",
        fa: { title: "&#1578;&#1582;&#1578;&#1607; &#1606;&#1585;&#1583;", desc: "&#1576;&#1575;&#1586;&#1740; &#1705;&#1604;&#1575;&#1587;&#1740;&#1705; &#1576;&#1575; &#1578;&#1575;&#1587; &#1608; &#0645;&#0647;&#0627;&#0631;&#062A;", badge: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740;", action: "&#1608;&#1585;&#1608;&#1583; &#1576;&#1607; &#1576;&#1575;&#1586;&#1740;" },
        en: { title: "Backgammon", desc: "Classic dice and strategy game", badge: "SOON", action: "Open Game" }
      },
      {
        key: "hokm",
        icon: "&#127183;",
        accent: "#ef4444",
        accentSoft: "rgba(239,68,68,0.23)",
        fa: { title: "&#1581;&#06a9;&#1605;", desc: "&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1605;&#1581;&#1576;&#1608;&#1576; &#1575;&#06cc;&#0631;&#0627;&#0646;&#06cc;", badge: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740;", action: "&#1608;&#1585;&#1608;&#1583; &#1576;&#1607; &#1576;&#1575;&#1586;&#1740;" },
        en: { title: "Hokm", desc: "Classic Iranian card game", badge: "SOON", action: "Open Game" }
      },
      {
        key: "chahar-barg",
        icon: "&#9827;",
        accent: "#38bdf8",
        accentSoft: "rgba(56,189,248,0.22)",
        fa: { title: "&#1670;&#1607;&#1575;&#1585; &#1576;&#1585;&#1711;", desc: "&#1576;&#1575;&#1586;&#1740; &#1705;&#1575;&#1585;&#1578;&#1740; &#1587;&#1585;&#06cc;&#0639; &#1608; &#0631;&#0642;&#0627;&#0628;&#062A;&#06cc;", badge: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740;", action: "&#1608;&#1585;&#1608;&#1583; &#1576;&#1607; &#1576;&#1575;&#1586;&#1740;" },
        en: { title: "Chahar Barg", desc: "Fast competitive card game", badge: "SOON", action: "Open Game" }
      }
    ];

    const dictionary = {
      fa: {
        subtitle: "&#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606; &#1705;&#1604;&#1575;&#1587;&#1740;&#1705; &#1576;&#1575; &#1592;&#1575;&#1607;&#1585; &#1605;&#1583;&#1585;&#1606;",
        kicker: "&#1587;&#1575;&#1604;&#1606; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1740; &#1570;&#1606;&#1604;&#1575;&#1740;&#1606;",
        heroTitle: "&#1575;&#1606;&#1578;&#1582;&#1575;&#1576; &#1705;&#1606;&#1548; &#1608;&#1575;&#1585;&#1583; &#1576;&#1575;&#1586;&#1740; &#1588;&#1608;",
        heroText: "&#1575;&#1740;&#1606;&#1580;&#1575; &#1589;&#1601;&#1581;&#1607; &#1575;&#1589;&#1604;&#1740; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;&#1587;&#1578;. &#1607;&#1585; &#1576;&#1575;&#1586;&#1740; &#1576;&#1607; &#1589;&#1608;&#1585;&#1578; &#1580;&#1583;&#1575;&#1711;&#1575;&#1606;&#1607; &#1578;&#1705;&#1605;&#1740;&#1604; &#1605;&#1740;&#8204;&#1588;&#1608;&#1583;.",
        gamesTitle: "&#1604;&#1740;&#1587;&#1578; &#1576;&#1575;&#1586;&#1740;&#8204;&#1607;&#1575;",
        gamesHint: "&#1576;&#1607; &#1586;&#1608;&#1583;&#1740; &#1602;&#1575;&#1576;&#1604; &#1576;&#1575;&#1586;&#1740;",
        mini1Title: "&#1605;&#1608;&#1576;&#1575;&#1740;&#1604;&#1740;",
        mini1Text: "&#1576;&#1607;&#1740;&#1606;&#1607; &#1576;&#1585;&#1575;&#1740; iPhone",
        mini2Title: "&#1570;&#1606;&#1604;&#1575;&#1740;&#1606;",
        mini2Text: "&#1570;&#1605;&#1575;&#1583;&#1607; &#1576;&#1585;&#1575;&#1740; &#1576;&#1575;&#1586;&#1740; &#1583;&#1608;&#1587;&#1578;&#1575;&#1606;&#1607;",
        mini3Title: "&#1583;&#1585; &#1581;&#1575;&#1604; &#1587;&#1575;&#1582;&#1578;",
        mini3Text: "&#1575;&#1605;&#1705;&#1575;&#1606;&#1575;&#1578; &#1576;&#1607; &#1605;&#1585;&#1608;&#1585; &#1575;&#1590;&#1575;&#1601;&#1607; &#1605;&#1740;&#8204;&#1588;&#1608;&#1606;&#1583;",
        toast: "&#1575;&#1740;&#1606; &#1576;&#1575;&#1586;&#1740; &#1576;&#1607; &#1586;&#1608;&#1583;&#1740; &#0641;&#0639;&#0627;&#0644; &#0645;&#06cc;&#8204;&#0634;&#0648;&#062f;."
      },
      en: {
        subtitle: "Classic online games with a modern look",
        kicker: "Online Game Hall",
        heroTitle: "Choose a game and enter",
        heroText: "This is the main game hub. Each game will be completed as a separate experience.",
        gamesTitle: "Game List",
        gamesHint: "Playable soon",
        mini1Title: "Mobile",
        mini1Text: "Optimized for iPhone",
        mini2Title: "Online",
        mini2Text: "Ready for friendly games",
        mini3Title: "Building",
        mini3Text: "Features will be added step by step",
        toast: "This game will be available soon."
      }
    };

    let lang = localStorage.getItem("homeLang") || "fa";
    const langBtn = document.getElementById("langBtn");
    const toast = document.getElementById("toast");

    function setHtml(selector, html) {
      const el = document.querySelector(selector);
      if (el) el.innerHTML = html;
    }

    function applyLanguage() {
      document.documentElement.lang = lang;
      document.documentElement.dir = lang === "fa" ? "rtl" : "ltr";
      langBtn.textContent = lang === "fa" ? "EN" : "FA";

      const dict = dictionary[lang];
      document.querySelectorAll("[data-i18n]").forEach((el) => {
        const key = el.getAttribute("data-i18n");
        if (dict[key]) el.innerHTML = dict[key];
      });

      renderGames();
    }

    function renderGames() {
      const grid = document.getElementById("gamesGrid");
      grid.innerHTML = "";

      games.forEach((game) => {
        const data = game[lang];
        const card = document.createElement("article");
        card.className = "game-card";
        card.style.setProperty("--accent", game.accent);
        card.style.setProperty("--accent-soft", game.accentSoft);
        card.innerHTML = `
          <div class="game-top">
            <div class="game-icon">${game.icon}</div>
            <div class="badge">${data.badge}</div>
          </div>
          <div class="game-title">${data.title}</div>
          <p class="game-desc">${data.desc}</p>
          <div class="game-action"><span>${data.action}</span><span>â</span></div>
        `;
        card.onclick = showToast;
        grid.appendChild(card);
      });
    }

    function showToast() {
      toast.innerHTML = dictionary[lang].toast;
      toast.classList.add("show");
      clearTimeout(showToast.timer);
      showToast.timer = setTimeout(() => toast.classList.remove("show"), 2200);
    }

    langBtn.onclick = function() {
      lang = lang === "fa" ? "en" : "fa";
      localStorage.setItem("homeLang", lang);
      applyLanguage();
    };

    applyLanguage();
  </script>
</body>
</html>`;
}

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(pageHtml());
});

app.listen(PORT, () => {
  console.log("Poker Royale Home UI v2 running on port " + PORT);
});
