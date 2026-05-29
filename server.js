const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.get("/", (req, res) => {
  res.send(`<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/>
<title>AESTRA Preview V15 Premium Banner</title>
<style>
body{margin:0;font-family:Arial,sans-serif;background:#f7f1e9;color:#14110f;}
.header{position:sticky;top:0;background:#fffaf4;padding:14px;display:flex;justify-content:center;align-items:center;font-size:24px;font-weight:900;box-shadow:0 2px 10px rgba(0,0,0,.12)}
.banner{display:grid;grid-template-columns:1fr 1fr;max-width:1220px;margin:20px auto;border-radius:30px;overflow:hidden;box-shadow:0 22px 70px rgba(76,48,22,.12);background:#fffaf4;min-height:550px;position:relative;}
.banner-slide{display:none;grid-template-columns:1fr 1fr;align-items:center;min-height:550px;position:relative;transition:opacity .5s ease-in-out}
.banner-slide.active{display:grid}
.banner-slide img{width:100%;height:550px;object-fit:cover;border-radius:0}
.slide-text{padding:40px;display:flex;flex-direction:column;justify-content:center}
.slide-text span{background:#101010;color:#fff;padding:8px 12px;border-radius:999px;font-weight:900;width:max-content;margin-bottom:12px}
.slide-text h1{font-family:Georgia,serif;font-size:54px;margin:0}
.slide-text h2{font-size:22px;margin:6px 0}
.slide-text p{font-size:16px;line-height:1.8;color:#4f4740;max-width:480px}
.hero-btn{background:#101010;color:#fff;padding:14px 28px;border-radius:12px;text-decoration:none;font-weight:900;display:inline-block;margin-top:14px;transition:.25s}
.hero-btn:hover{transform:translateY(-3px)}
.banner-controls{position:absolute;bottom:18px;left:18px;display:flex;gap:8px}
.control-dot{width:12px;height:12px;border-radius:999px;background:rgba(16,16,16,.28);border:0;transition:.25s}
.control-dot.active{width:28px;background:#101010}
.arrow{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:999px;border:1px solid rgba(20,17,15,.15);background:rgba(255,250,244,.86);font-size:22px;font-weight:900;text-align:center;line-height:42px;cursor:pointer}
.arrow.prev{right:18px}.arrow.next{left:18px}
</style>
</head>
<body>
<div class="header">AESTRA STORE</div>
<main>
<section class="banner" id="banner">
  <div class="banner-slide active">
    <div class="slide-text"><span>NEW COLLECTION</span><h1>AESTRA</h1><h2>Ø§Ø³ØªØ§ÛÙ ØªÙØ Ø§ÙØ¶Ø§Û ØªÙØ³Øª</h2><p>Ú©Ø§ÙÚ©Ø´Ù Ø¬Ø¯ÛØ¯ Ø¢Ø³ØªØ±Ø§ Ø¨Ø§ ÙØ¨Ø§Ø³âÙØ§Û ÙÙÚ©Ø³ Ù ÙÛÙÛÙØ§Ù.</p><a class="hero-btn" href="/shop?cat=women">ÙØ´Ø§ÙØ¯Ù Ú©Ø§ÙÚ©Ø´Ù Ø²ÙØ§ÙÙ</a></div>
    <img src="https://images.unsplash.com/photo-1509631179647-0177331693ae?auto=format&fit=crop&w=1500&q=88" alt="Banner1"/>
  </div>
  <div class="banner-slide">
    <div class="slide-text"><span>MEN STYLE</span><h1>MODERN</h1><h2>Ø³Ø§Ø¯Ú¯Û Ù ÙÙØ§Ø±</h2><p>Ø§Ø³ØªØ§ÛÙ ÙØ±Ø¯Ø§ÙÙ Ø¨Ø§ Ù¾ÛØ±Ø§ÙÙâÙØ§ Ù Ú©ØªâÙØ§Û ÙØ¯Ø±Ù.</p><a class="hero-btn" href="/shop?cat=men">ÙØ´Ø§ÙØ¯Ù Ú©Ø§ÙÚ©Ø´Ù ÙØ±Ø¯Ø§ÙÙ</a></div>
    <img src="https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1500&q=88" alt="Banner2"/>
  </div>
  <div class="banner-slide">
    <div class="slide-text"><span>ACCESSORIES</span><h1>DETAILS</h1><h2>Ø¬Ø²Ø¦ÛØ§Øª Ø§Ø³ØªØ§ÛÙ</h2><p>Ø§Ø² Ú©ÛÙ Ù Ø³Ø§Ø¹Øª ØªØ§ Ø§Ú©Ø³Ø³ÙØ±ÛâÙØ§Ø Ø¨Ø±Ø§Û Ú©Ø§ÙÙ Ú©Ø±Ø¯Ù Ø¸Ø§ÙØ± Ø´ÙØ§.</p><a class="hero-btn" href="/shop?cat=accessories">ÙØ´Ø§ÙØ¯Ù Ø§Ú©Ø³Ø³ÙØ±ÛâÙØ§</a></div>
    <img src="https://images.unsplash.com/photo-1529139574466-a303027c1d8b?auto=format&fit=crop&w=1500&q=88" alt="Banner3"/>
  </div>
  <div class="arrow prev" onclick="moveBanner(-1)">âº</div>
  <div class="arrow next" onclick="moveBanner(1)">â¹</div>
  <div class="banner-controls"><div class="control-dot active" onclick="showBanner(0)"></div><div class="control-dot" onclick="showBanner(1)"></div><div class="control-dot" onclick="showBanner(2)"></div></div>
</section>
</main>
<script>
let bannerIndex=0;
function showBanner(i){const slides=document.querySelectorAll(".banner-slide");const dots=document.querySelectorAll(".control-dot");bannerIndex=(i+slides.length)%slides.length;slides.forEach((s,n)=>s.classList.toggle("active",n===bannerIndex));dots.forEach((d,n)=>d.classList.toggle("active",n===bannerIndex));}
function moveBanner(step){showBanner(bannerIndex+step);}
setInterval(()=>showBanner(bannerIndex+1),5500);
</script>
</body>
</html>`);
});

app.listen(PORT,()=>console.log("AESTRA Preview V15 Premium Banner running on port "+PORT));
