const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
});

const products = [
  {id:1, fa:"کت زنانه لینن کرم", en:"Cream Linen Blazer", category:"women", price:2490000, oldPrice:2890000, badge:"جدید", image:"https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=85", desc:"کت زنانه مینیمال با رنگ کرم، مناسب استایل رسمی، روزمره و نیمه‌رسمی.", colors:["کرم","مشکی"], sizes:["S","M","L","XL"]},
  {id:2, fa:"عینک آفتابی کلاسیک", en:"Classic Sunglasses", category:"accessories", price:1290000, oldPrice:0, badge:"محبوب", image:"https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=1200&q=85", desc:"عینک آفتابی با فرم کلاسیک و ظاهر لوکس برای تکمیل استایل روزانه.", colors:["مشکی"], sizes:["Free"]},
  {id:3, fa:"پیراهن مردانه لینن", en:"Men Linen Shirt", category:"men", price:1490000, oldPrice:1790000, badge:"پرفروش", image:"https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=1200&q=85", desc:"پیراهن مردانه سبک، تنفس‌پذیر و مناسب استایل مینیمال.", colors:["قهوه‌ای","سفید"], sizes:["M","L","XL"]},
  {id:4, fa:"کیف دوشی چرمی", en:"Leather Shoulder Bag", category:"bags", price:2990000, oldPrice:0, badge:"جدید", image:"https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=1200&q=85", desc:"کیف دوشی چرمی با فرم مدرن و مناسب استفاده روزمره.", colors:["مشکی"], sizes:["Free"]},
  {id:5, fa:"کتانی سفید مینیمال", en:"Minimal White Sneakers", category:"shoes", price:2190000, oldPrice:0, badge:"تازه", image:"https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=1200&q=85", desc:"کتانی سفید ساده با طراحی تمیز و قابل ست با اکثر لباس‌ها.", colors:["سفید"], sizes:["40","41","42","43"]},
  {id:6, fa:"ساعت طلایی آسترا", en:"AESTRA Gold Watch", category:"watches", price:3890000, oldPrice:4490000, badge:"خاص", image:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=1200&q=85", desc:"ساعت طلایی با طراحی مینیمال، مناسب استایل رسمی و لوکس.", colors:["طلایی"], sizes:["Free"]},
  {id:7, fa:"پیراهن زنانه مشکی", en:"Black Evening Dress", category:"women", price:1990000, oldPrice:2490000, badge:"محدود", image:"https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=1200&q=85", desc:"پیراهن زنانه مشکی با ظاهر کلاسیک برای موقعیت‌های خاص.", colors:["مشکی"], sizes:["S","M","L"]},
  {id:8, fa:"هودی مونوکروم", en:"Monochrome Hoodie", category:"men", price:1490000, oldPrice:0, badge:"Street", image:"https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1200&q=85", desc:"هودی ساده و راحت برای استایل خیابانی و روزمره.", colors:["مشکی","خاکستری"], sizes:["M","L","XL"]},
];

const categories = [
  {id:"women", fa:"زنانه", en:"Women", image:"https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=800&q=85"},
  {id:"men", fa:"مردانه", en:"Men", image:"https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=800&q=85"},
  {id:"accessories", fa:"اکسسوری", en:"Accessories", image:"https://images.unsplash.com/photo-1511499767150-a48a237f0083?auto=format&fit=crop&w=800&q=85"},
  {id:"watches", fa:"ساعت", en:"Watches", image:"https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=800&q=85"},
  {id:"bags", fa:"کیف", en:"Bags", image:"https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=800&q=85"},
  {id:"shoes", fa:"کفش", en:"Shoes", image:"https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=85"},
];

const allCats = [{id:"all", fa:"همه"}, ...categories.map(c => ({id:c.id, fa:c.fa}))];
const orders = [];
const users = [];

function money(n) {
  return Number(n || 0).toLocaleString("fa-IR") + " تومان";
}

function validateIranPhone(phone) {
  return /^09\d{9}$/.test(String(phone || "").trim());
}

function validatePassword(password) {
  const p = String(password || "");
  return p.length >= 8 && /[A-Za-z]/.test(p) && /\d/.test(p);
}

function productCard(p) {
  return `
  <article class="product-card reveal">
    <button class="wish" type="button" onclick="this.classList.toggle('active')">♡</button>
    <a href="/product/${p.id}" class="product-image" style="background-image:url('${p.image}')">
      <span class="product-badge">${p.badge}</span>
    </a>
    <div class="product-info">
      <a href="/product/${p.id}" class="product-title">${p.fa}</a>
      <div class="product-sub">${p.en}</div>
      <div class="product-price">
        <strong>${money(p.price)}</strong>
        ${p.oldPrice ? `<span>${money(p.oldPrice)}</span>` : ""}
      </div>
      <button class="add-btn" onclick='addToCart(${p.id},${JSON.stringify(p.fa)},${p.price},${JSON.stringify(p.image)})'>افزودن به سبد</button>
    </div>
  </article>`;
}

function shell(content, active = "home") {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"/>
  <meta name="theme-color" content="#f7f1e9"/>
  <title>AESTRA | Premium Fashion Store</title>
  <style>
    *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
    :root{
      --bg:#f7f1e9;--paper:#fffaf4;--paper2:#f0e5d7;--ink:#14110f;--muted:#7e766d;
      --line:rgba(20,17,15,.12);--gold:#b99558;--black:#101010;--danger:#9f2a2a;
      --green:#16835a;--shadow:0 22px 70px rgba(76,48,22,.12);--radius:24px;
    }
    @keyframes floatIn{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes fadeIn{from{opacity:0}to{opacity:1}}
    @keyframes softPulse{0%,100%{box-shadow:0 0 0 rgba(185,149,88,0)}50%{box-shadow:0 0 28px rgba(185,149,88,.28)}}
    @keyframes slideHero{0%,100%{background-position:center}50%{background-position:center 45%}}
    body{margin:0;min-height:100vh;font-family:Arial,Tahoma,sans-serif;color:var(--ink);background:linear-gradient(180deg,#fbf7f1 0%,#f6eee4 52%,#efe2d2 100%)}
    a{text-decoration:none;color:inherit}
    .wrap{width:100%;max-width:1220px;margin:0 auto;padding:0 14px}
    .header{position:sticky;top:0;z-index:60;background:rgba(255,250,244,.93);backdrop-filter:blur(18px);border-bottom:1px solid var(--line)}
    .header-inner{width:100%;max-width:1220px;margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:13px 14px}
    .left-actions{display:flex;justify-content:flex-start;gap:8px;align-items:center}
    .center-brand{text-align:center}
    .brand-mark{display:inline-grid;place-items:center;width:54px;height:54px;border-radius:19px;background:linear-gradient(135deg,#14110f,#4a3a22 58%,#d8bd7b);color:#fffaf4;font-family:Georgia,serif;font-size:32px;margin-bottom:5px;animation:softPulse 3s ease-in-out infinite}
    .brand{display:block;font-family:Georgia,serif;font-size:36px;letter-spacing:6px;font-weight:500;line-height:1}
    .brand-tag{font-size:10px;color:var(--muted);letter-spacing:2px;margin-top:5px}
    .right-actions{display:flex;justify-content:flex-end;gap:8px;align-items:center}
    .auth-btn{border:1px solid var(--line);background:#101010;color:#fffaf4;border-radius:999px;padding:12px 15px;font-weight:900;white-space:nowrap}
    .hamburger{width:46px;height:46px;border:1px solid var(--line);background:#fffaf4;border-radius:16px;display:grid;place-items:center;font-size:22px;font-weight:900}
    .icon{width:46px;height:46px;border-radius:16px;border:1px solid var(--line);background:#fffaf4;display:grid;place-items:center;font-weight:900;position:relative}
    .cart-count{position:absolute;top:-5px;left:-5px;background:#101010;color:#fff;border-radius:999px;font-size:10px;width:18px;height:18px;display:grid;place-items:center}
    .hero{margin:20px auto 0;width:100%;max-width:1220px;border-radius:34px;overflow:hidden;background:linear-gradient(90deg,rgba(255,250,244,.94),rgba(255,250,244,.45)),url('https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1800&q=88');background-size:cover;background-position:center;min-height:475px;display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:44px;box-shadow:var(--shadow);position:relative;animation:slideHero 9s ease-in-out infinite}
    .hero-content{animation:floatIn .8s ease both}.hero h1{font-family:Georgia,serif;font-size:clamp(58px,11vw,96px);letter-spacing:4px;margin:0;color:#14110f}.hero h2{font-size:21px;margin:0 0 8px;color:#362d24}.hero p{font-size:17px;line-height:2;color:#4f4740;max-width:490px}.hero-btn{display:inline-flex;background:#101010;color:#fffaf4;border-radius:12px;padding:15px 24px;font-weight:900;margin-top:14px;transition:.25s}.hero-btn:hover{transform:translateY(-3px);box-shadow:0 16px 34px rgba(0,0,0,.18)}
    .section-head{display:flex;align-items:end;justify-content:space-between;margin:38px 0 16px}.section-head h2{margin:0;font-size:25px}.section-head a{font-size:13px;color:#5f564d;font-weight:900}
    .cat-grid{display:grid;grid-template-columns:repeat(6,1fr);gap:14px}.cat-card{background:#fffaf4;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow);text-align:center;transition:.3s}.cat-card:hover{transform:translateY(-7px)}.cat-img{height:145px;background-size:cover;background-position:center;transition:.5s}.cat-card:hover .cat-img{transform:scale(1.06)}.cat-card strong{display:block;padding:13px 0 4px}.cat-card span{display:block;color:#766f68;font-size:12px;padding-bottom:13px}
    .products{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}.product-card{position:relative;background:#fffaf4;border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow);transition:.3s}.product-card:hover{transform:translateY(-8px);box-shadow:0 28px 82px rgba(76,48,22,.18)}.wish{position:absolute;z-index:2;top:10px;right:10px;width:36px;height:36px;border-radius:999px;border:0;background:rgba(255,255,255,.86);font-size:19px;transition:.25s}.wish.active{background:#101010;color:#fff;transform:scale(1.12)}.product-image{display:block;height:260px;background-size:cover;background-position:center;position:relative;transition:.5s}.product-card:hover .product-image{filter:saturate(1.06);transform:scale(1.04)}.product-badge{position:absolute;top:10px;left:10px;background:#101010;color:#fffaf4;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:900}.product-info{padding:13px}.product-title{display:block;font-weight:900;margin-bottom:5px}.product-sub{color:var(--muted);font-size:12px;margin-bottom:8px}.product-price strong{font-size:14px}.product-price span{text-decoration:line-through;color:#9b9187;font-size:12px;margin-right:6px}.add-btn{width:100%;margin-top:11px;border:0;background:#101010;color:#fffaf4;border-radius:12px;padding:12px;font-weight:900;transition:.25s}.add-btn:hover{transform:translateY(-2px);background:#2a2117}
    .brand-block{margin:38px 0;background:linear-gradient(135deg,#171412,#3c2d1c);color:#fffaf4;border-radius:28px;padding:30px;display:grid;grid-template-columns:1.3fr .7fr;gap:20px;box-shadow:var(--shadow)}.brand-block h2{font-family:Georgia,serif;font-size:44px;letter-spacing:4px;margin:0}.brand-block p{line-height:2;color:#eadfcc}.trust-footer{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:24px 0}.trust-item{background:#fffaf4;border:1px solid var(--line);border-radius:18px;padding:18px;display:flex;gap:12px;align-items:center;box-shadow:var(--shadow)}.trust-icon{font-size:24px}.trust-title{font-weight:900}.trust-sub{font-size:12px;color:var(--muted);margin-top:4px}
    .footer{margin-top:34px;background:#101010;color:#fffaf4;padding:34px 14px}.footer-inner{max-width:1220px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1.2fr;gap:24px}.footer h3{font-family:Georgia,serif;letter-spacing:2px}.footer a,.footer p{display:block;color:#d6ccbf;line-height:2;font-size:13px}.trust-badges{display:flex;gap:10px;flex-wrap:wrap}.trust-badge{width:82px;height:96px;border-radius:14px;background:#fffaf4;color:#14110f;display:grid;place-items:center;text-align:center;font-size:12px;font-weight:900}
    .panel{background:#fffaf4;border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow);padding:20px;margin:18px 0}.shop-tools{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.shop-tools input{border:1px solid var(--line);border-radius:14px;background:#fff;padding:14px;outline:none}.filters{display:flex;gap:8px;overflow:auto}.filters a{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:11px 14px;background:#fff}.filters a.active{background:#101010;color:#fff}
    .product-page{display:grid;grid-template-columns:1.05fr .95fr;gap:18px}.big-img{min-height:560px;border-radius:24px;background-size:cover;background-position:center}.detail h1{font-size:34px;margin:0 0 8px}.muted{color:var(--muted);line-height:1.9}.detail .price{font-size:24px;font-weight:1000;margin:16px 0}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid var(--line);padding:10px 13px;border-radius:12px;background:#fff}.qty{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:7px;margin:12px 0}.qty button{width:30px;height:30px;border:0;border-radius:10px;background:#eee}.cart-row{display:grid;grid-template-columns:70px 1fr auto;gap:12px;align-items:center;border-bottom:1px solid var(--line);padding:12px 0}.cart-img{width:70px;height:80px;border-radius:12px;background-size:cover;background-position:center}.input{width:100%;border:1px solid var(--line);border-radius:14px;background:#fff;padding:14px;outline:none}.form{display:grid;gap:10px}
    .drawer-backdrop,.auth-backdrop{display:none;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:90;animation:fadeIn .2s ease}.drawer-backdrop.open,.auth-backdrop.open{display:block}.drawer{position:fixed;top:0;right:0;width:min(86vw,390px);height:100%;background:#fffaf4;box-shadow:-20px 0 70px rgba(0,0,0,.22);z-index:100;padding:18px;transform:translateX(105%);transition:.3s ease;overflow:auto}.drawer.open{transform:translateX(0)}.drawer-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:14px}.close{border:0;background:#101010;color:#fff;border-radius:12px;width:40px;height:40px}.drawer-section{border-top:1px solid var(--line);padding:15px 0}.drawer-section a{display:flex;justify-content:space-between;padding:12px;border-radius:12px}.drawer-section a:hover{background:#f3eadf}
    .auth-modal{position:fixed;top:50%;left:50%;transform:translate(-50%,-45%) scale(.96);width:min(92vw,430px);background:#fffaf4;border:1px solid var(--line);border-radius:24px;box-shadow:0 30px 100px rgba(0,0,0,.25);z-index:110;padding:20px;display:none;opacity:0;transition:.25s}.auth-modal.open{display:block;opacity:1;transform:translate(-50%,-50%) scale(1)}.auth-tabs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:14px 0}.auth-tabs button{border:1px solid var(--line);background:#fff;border-radius:12px;padding:12px;font-weight:900}.auth-tabs button.active{background:#101010;color:#fff}.error{color:var(--danger);font-size:12px;min-height:18px}.success{color:var(--green);font-size:12px;min-height:18px}
    .reveal{animation:floatIn .7s ease both}
    @media(max-width:900px){.cat-grid{grid-template-columns:repeat(3,1fr)}.products{grid-template-columns:repeat(3,1fr)}.footer-inner{grid-template-columns:1fr 1fr}.trust-footer{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:760px){.header-inner{grid-template-columns:auto 1fr auto;padding:10px}.left-actions{order:3}.center-brand{order:2}.right-actions{order:1}.brand{font-size:24px;letter-spacing:4px}.brand-mark{width:42px;height:42px;font-size:24px;margin-bottom:2px}.brand-tag{display:none}.auth-btn{font-size:12px;padding:11px 12px}.icon{display:none}.hero{margin-top:12px;border-radius:26px;min-height:430px;grid-template-columns:1fr;padding:24px;background-position:center}.hero h1{font-size:58px}.hero p{font-size:14px}.cat-grid,.products{grid-template-columns:repeat(2,1fr);gap:10px}.cat-img{height:130px}.product-image{height:210px}.brand-block,.product-page{grid-template-columns:1fr}.big-img{min-height:390px}.trust-footer{grid-template-columns:1fr}.shop-tools{grid-template-columns:1fr}.footer-inner{grid-template-columns:1fr}.cart-row{grid-template-columns:60px 1fr}.cart-row .qty{grid-column:2}.left-actions .auth-btn{max-width:120px;overflow:hidden;text-overflow:ellipsis}.drawer{right:auto;left:0;transform:translateX(-105%)}.drawer.open{transform:translateX(0)}}
  </style>
</head>
<body>
  <header class="header">
    <div class="header-inner">
      <div class="left-actions">
        <button class="auth-btn" onclick="openAuth()">ثبت نام / ورود</button>
      </div>
      <div class="center-brand">
        <a href="/" class="brand-mark">A</a>
        <a href="/" class="brand">AESTRA</a>
        <div class="brand-tag">PREMIUM FASHION STORE</div>
      </div>
      <div class="right-actions">
        <button class="hamburger" onclick="openDrawer()">☰</button>
        <a class="icon" href="/cart">🛍<span class="cart-count" id="cartCount">0</span></a>
      </div>
    </div>
  </header>

  <main class="wrap">${content}</main>

  <section class="trust-footer wrap">
    <div class="trust-item"><div class="trust-icon">🚚</div><div><div class="trust-title">ارسال سریع</div><div class="trust-sub">ارسال به سراسر کشور</div></div></div>
    <div class="trust-item"><div class="trust-icon">↩️</div><div><div class="trust-title">ضمانت بازگشت</div><div class="trust-sub">۷ روز ضمانت بازگشت کالا</div></div></div>
    <div class="trust-item"><div class="trust-icon">🛡️</div><div><div class="trust-title">پرداخت امن</div><div class="trust-sub">درگاه پرداخت معتبر</div></div></div>
    <div class="trust-item"><div class="trust-icon">🎧</div><div><div class="trust-title">پشتیبانی آنلاین</div><div class="trust-sub">پاسخگویی و پیگیری سفارش</div></div></div>
  </section>

  <footer class="footer">
    <div class="footer-inner">
      <div>
        <h3>AESTRA</h3>
        <p>آسترا فروشگاه آنلاین پوشاک، ساعت، کیف، کفش و اکسسوری است. ما به فکر استایل شما هستیم و تلاش می‌کنیم انتخابی شیک، ساده و مطمئن برای ساختن ظاهر شخصی شما فراهم کنیم.</p>
        <p>آدرس: تهران، خیابان نمونه، پلاک ۱۲</p>
        <p>شماره تماس: ۰۲۱-۰۰۰۰۰۰۰۰</p>
      </div>
      <div><h3>دسته‌بندی‌ها</h3><a href="/shop?cat=women">زنانه</a><a href="/shop?cat=men">مردانه</a><a href="/shop?cat=accessories">اکسسوری</a><a href="/shop?cat=watches">ساعت</a></div>
      <div><h3>خدمات</h3><a href="/support">پشتیبانی</a><a href="/ticket">تیکت</a><a href="/discounts">تخفیف‌ها</a><a href="/lottery">قرعه‌کشی</a></div>
      <div><h3>نمادهای اعتماد</h3><div class="trust-badges"><div class="trust-badge">جایگاه<br>اینماد</div><div class="trust-badge">جایگاه<br>ساماندهی</div></div></div>
    </div>
  </footer>

  <div class="drawer-backdrop" id="drawerBackdrop" onclick="closeDrawer()"></div>
  <aside class="drawer" id="drawer">
    <div class="drawer-head"><strong>AESTRA MENU</strong><button class="close" onclick="closeDrawer()">×</button></div>
    <div class="drawer-section"><strong>محصولات</strong>
      <a href="/shop?cat=women">زنانه <span>›</span></a>
      <a href="/shop?cat=men">مردانه <span>›</span></a>
      <a href="/shop?cat=accessories">اکسسوری <span>›</span></a>
      <a href="/shop?cat=watches">ساعت <span>›</span></a>
      <a href="/shop?cat=bags">کیف <span>›</span></a>
      <a href="/shop?cat=shoes">کفش <span>›</span></a>
    </div>
    <div class="drawer-section"><strong>خدمات سایت</strong>
      <a href="/support">پشتیبانی <span>›</span></a>
      <a href="/ticket">تیکت <span>›</span></a>
      <a href="/discounts">تخفیف‌ها <span>›</span></a>
      <a href="/lottery">قرعه‌کشی <span>›</span></a>
      <a href="/about">درباره ما <span>›</span></a>
      <a href="/contact">تماس با ما <span>›</span></a>
    </div>
  </aside>

  <div class="auth-backdrop" id="authBackdrop" onclick="closeAuth()"></div>
  <section class="auth-modal" id="authModal">
    <div class="drawer-head"><strong>حساب کاربری AESTRA</strong><button class="close" onclick="closeAuth()">×</button></div>
    <div class="auth-tabs"><button id="registerTab" class="active" onclick="setAuthMode('register')">ثبت نام</button><button id="loginTab" onclick="setAuthMode('login')">ورود</button></div>
    <form class="form" onsubmit="submitAuth(event)">
      <input class="input" id="authPhone" inputmode="numeric" placeholder="شماره موبایل ایران مثل 09123456789" maxlength="11" required>
      <input class="input" id="authPassword" type="password" placeholder="رمز عبور: حداقل ۸ کاراکتر، حروف لاتین و عدد" required>
      <div class="error" id="authError"></div>
      <div class="success" id="authSuccess"></div>
      <button class="add-btn" id="authSubmit" type="submit">ثبت نام</button>
    </form>
  </section>

  <script>
    let authMode = "register";
    function getCart(){try{return JSON.parse(localStorage.getItem("aestra_cart")||"[]")}catch(e){return []}}
    function setCart(c){localStorage.setItem("aestra_cart",JSON.stringify(c));updateCartCount()}
    function updateCartCount(){const n=getCart().reduce((s,i)=>s+i.qty,0);const el=document.getElementById("cartCount");if(el)el.textContent=n}
    function addToCart(id,name,price,image){const c=getCart();const item=c.find(x=>x.id===id);if(item)item.qty++;else c.push({id,name,price,image,qty:1});setCart(c);alert("به سبد خرید اضافه شد")}
    function changeQty(id,d){const c=getCart();const it=c.find(x=>x.id===id);if(!it)return;it.qty+=d;if(it.qty<=0)c.splice(c.indexOf(it),1);setCart(c);location.reload()}
    function clearCart(){setCart([]);location.reload()}
    function openDrawer(){document.getElementById("drawer").classList.add("open");document.getElementById("drawerBackdrop").classList.add("open")}
    function closeDrawer(){document.getElementById("drawer").classList.remove("open");document.getElementById("drawerBackdrop").classList.remove("open")}
    function openAuth(){document.getElementById("authModal").classList.add("open");document.getElementById("authBackdrop").classList.add("open")}
    function closeAuth(){document.getElementById("authModal").classList.remove("open");document.getElementById("authBackdrop").classList.remove("open")}
    function setAuthMode(mode){authMode=mode;document.getElementById("registerTab").classList.toggle("active",mode==="register");document.getElementById("loginTab").classList.toggle("active",mode==="login");document.getElementById("authSubmit").textContent=mode==="register"?"ثبت نام":"ورود";document.getElementById("authError").textContent="";document.getElementById("authSuccess").textContent=""}
    function validIranPhone(p){return /^09\\d{9}$/.test(String(p||"").trim())}
    function validPassword(p){return String(p||"").length>=8 && /[A-Za-z]/.test(p) && /\\d/.test(p)}
    async function submitAuth(e){
      e.preventDefault();
      const phone=document.getElementById("authPhone").value.trim();
      const password=document.getElementById("authPassword").value;
      const err=document.getElementById("authError"), ok=document.getElementById("authSuccess");
      err.textContent=""; ok.textContent="";
      if(!validIranPhone(phone)){err.textContent="شماره موبایل معتبر ایران وارد کنید. مثال: 09123456789";return}
      if(!validPassword(password)){err.textContent="رمز عبور باید حداقل ۸ کاراکتر و شامل حروف لاتین و عدد باشد.";return}
      const res=await fetch("/api/auth/"+authMode,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({phone,password})});
      const data=await res.json();
      if(!res.ok){err.textContent=data.error||"خطا در عملیات";return}
      ok.textContent=authMode==="register"?"ثبت نام با موفقیت انجام شد.":"ورود با موفقیت انجام شد.";
      localStorage.setItem("aestra_user", JSON.stringify(data.user));
      setTimeout(closeAuth,900);
    }
    updateCartCount();
  </script>
</body>
</html>`;
}

app.post("/api/auth/register", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (!validateIranPhone(phone)) return res.status(400).json({error:"شماره موبایل معتبر ایران وارد کنید."});
  if (!validatePassword(password)) return res.status(400).json({error:"رمز عبور باید حداقل ۸ کاراکتر و شامل حروف لاتین و عدد باشد."});
  if (users.find(u => u.phone === phone)) return res.status(409).json({error:"این شماره قبلاً ثبت شده است."});
  const user = {id:Date.now(), phone};
  users.push({...user, password});
  res.json({ok:true, user});
});

app.post("/api/auth/login", (req, res) => {
  const phone = String(req.body.phone || "").trim();
  const password = String(req.body.password || "");
  if (!validateIranPhone(phone)) return res.status(400).json({error:"شماره موبایل معتبر ایران وارد کنید."});
  if (!validatePassword(password)) return res.status(400).json({error:"رمز عبور معتبر نیست."});
  const user = users.find(u => u.phone === phone && u.password === password);
  if (!user) return res.status(401).json({error:"شماره یا رمز عبور اشتباه است."});
  res.json({ok:true, user:{id:user.id, phone:user.phone}});
});

app.get("/api/products", (req, res) => res.json({ products, categories: allCats }));

app.get("/", (req, res) => {
  const newItems = products.slice(0,4).map(productCard).join("");
  const bestItems = products.slice(4,8).map(productCard).join("");
  const catCards = categories.map(c => `<a class="cat-card reveal" href="/shop?cat=${c.id}"><div class="cat-img" style="background-image:url('${c.image}')"></div><strong>${c.fa}</strong><span>مشاهده</span></a>`).join("");
  res.send(shell(`
    <section class="hero">
      <div class="hero-content">
        <h2>کالکشن جدید بهار و تابستان ۱۴۰۴</h2>
        <h1>AESTRA</h1>
        <p>استایل شما، امضای شماست. آسترا برای کسانی ساخته شده که انتخاب لباس را فقط خرید نمی‌بینند؛ بلکه ساختن تصویر شخصی می‌دانند.</p>
        <a class="hero-btn" href="/shop">مشاهده کالکشن جدید</a>
      </div>
      <div></div>
    </section>

    <div class="section-head"><h2>دسته‌بندی‌های محبوب</h2><a href="/shop">مشاهده همه</a></div>
    <section class="cat-grid">${catCards}</section>

    <div class="section-head"><h2>محصولات جدید</h2><a href="/shop">مشاهده همه</a></div>
    <section class="products">${newItems}</section>

    <div class="brand-block reveal">
      <div><h2>AESTRA</h2><p>ما به فکر استایل شما هستیم. از لباس روزمره تا اکسسوری‌های خاص، آسترا تلاش می‌کند انتخاب‌های شیک و قابل اعتماد را در یک تجربه خرید ساده کنار هم قرار دهد.</p></div>
      <div><p>ظاهر مدرن، انتخاب ساده، خرید مطمئن. این همان تجربه‌ای است که AESTRA برای مشتریان خود می‌سازد.</p><a class="hero-btn" href="/about" style="background:#fffaf4;color:#101010">درباره برند</a></div>
    </div>

    <div class="section-head"><h2>محصولات پرطرفدار</h2><a href="/shop">مشاهده همه</a></div>
    <section class="products">${bestItems}</section>
  `, "home"));
});

app.get("/shop", (req, res) => {
  const cat = String(req.query.cat || "all");
  const q = String(req.query.q || "").trim();
  let filtered = cat === "all" ? products : products.filter(p => p.category === cat);
  if (q) filtered = filtered.filter(p => (p.fa + " " + p.en).toLowerCase().includes(q.toLowerCase()));
  const links = allCats.map(c => `<a class="${cat===c.id?"active":""}" href="/shop?cat=${c.id}">${c.fa}</a>`).join("");
  res.send(shell(`
    <section class="panel reveal">
      <h1 style="margin:0 0 10px">فروشگاه AESTRA</h1>
      <div class="shop-tools">
        <input placeholder="جستجوی محصول..." value="${q.replace(/"/g,"&quot;")}" onkeydown="if(event.key==='Enter') location.href='/shop?q='+encodeURIComponent(this.value)">
        <div class="filters">${links}</div>
      </div>
    </section>
    <section class="products">${filtered.length ? filtered.map(productCard).join("") : "<p>محصولی پیدا نشد.</p>"}</section>
  `, "shop"));
});

app.get("/product/:id", (req, res) => {
  const p = products.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).send(shell(`<section class="panel"><h1>محصول پیدا نشد</h1></section>`, "shop"));
  const related = products.filter(x => x.category === p.category && x.id !== p.id).slice(0,4).map(productCard).join("");
  res.send(shell(`
    <section class="product-page reveal">
      <div class="big-img" style="background-image:url('${p.image}')"></div>
      <div class="panel detail">
        <div style="color:#7e766d;font-size:13px">خانه / فروشگاه / ${p.fa}</div>
        <h1>${p.fa}</h1>
        <div style="color:#b99558">★★★★★ <span style="color:#7e766d">۴.۸ از ۵</span></div>
        <p class="muted">${p.desc}</p>
        <div class="price">${money(p.price)}</div>
        <strong>سایز</strong>
        <div class="chips">${p.sizes.map(s=>`<span class="chip">${s}</span>`).join("")}</div>
        <br><strong>رنگ</strong>
        <div class="chips">${p.colors.map(c=>`<span class="chip">${c}</span>`).join("")}</div>
        <div class="qty"><button>-</button><b>1</b><button>+</button></div>
        <button class="add-btn" onclick='addToCart(${p.id},${JSON.stringify(p.fa)},${p.price},${JSON.stringify(p.image)})'>افزودن به سبد خرید</button>
        <p class="muted">ارسال سریع، ضمانت بازگشت ۷ روزه و پرداخت امن برای این محصول فعال است.</p>
      </div>
    </section>
    <div class="section-head"><h2>محصولات مرتبط</h2><a href="/shop?cat=${p.category}">مشاهده بیشتر</a></div>
    <section class="products">${related}</section>
  `, "shop"));
});

app.get("/cart", (req, res) => {
  res.send(shell(`
    <section class="product-page reveal">
      <div class="panel">
        <h1 style="margin-top:0">سبد خرید</h1>
        <div id="cartRows"></div>
      </div>
      <div class="panel">
        <h2 style="margin-top:0">اطلاعات سفارش</h2>
        <form class="form" onsubmit="submitOrder(event)">
          <input class="input" id="name" placeholder="نام و نام خانوادگی" required>
          <input class="input" id="phone" placeholder="شماره تماس" required>
          <input class="input" id="address" placeholder="آدرس ارسال" required>
          <button class="add-btn" type="submit">ثبت سفارش نمایشی</button>
          <button class="add-btn" style="background:#9f2a2a" type="button" onclick="clearCart()">خالی کردن سبد</button>
        </form>
      </div>
    </section>
    <script>
      function fmt(n){return Number(n||0).toLocaleString("fa-IR")+" تومان"}
      function renderCart(){const c=getCart();const box=document.getElementById("cartRows");if(!c.length){box.innerHTML='<p class="muted">سبد خرید خالی است.</p>';return}let total=0;box.innerHTML=c.map(it=>{total+=it.price*it.qty;return '<div class="cart-row"><div class="cart-img" style="background-image:url('+it.image+')"></div><div><strong>'+it.name+'</strong><br><span class="muted">'+fmt(it.price)+'</span></div><div class="qty"><button onclick="changeQty('+it.id+',-1)">-</button><b>'+it.qty+'</b><button onclick="changeQty('+it.id+',1)">+</button></div></div>'}).join('')+'<div class="cart-row"><strong>جمع کل</strong><div></div><strong>'+fmt(total)+'</strong></div>'}
      async function submitOrder(e){e.preventDefault();const cart=getCart();if(!cart.length)return alert("سبد خرید خالی است");const order={name:document.getElementById("name").value,phone:document.getElementById("phone").value,address:document.getElementById("address").value,cart};const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)});const j=await r.json();if(j.ok){setCart([]);alert("سفارش ثبت شد: "+j.orderId);location.href="/"}}
      renderCart();
    </script>
  `, "cart"));
});

app.post("/api/orders", (req, res) => {
  const order = {id:Date.now(), name:String(req.body.name||"").slice(0,80), phone:String(req.body.phone||"").slice(0,40), address:String(req.body.address||"").slice(0,220), cart:Array.isArray(req.body.cart)?req.body.cart:[], createdAt:new Date().toISOString()};
  orders.unshift(order);
  res.json({ok:true, orderId:order.id});
});

function simplePage(title, text, active="home") {
  return shell(`<section class="panel reveal"><h1>${title}</h1><p class="muted">${text}</p></section>`, active);
}
app.get("/about", (req, res) => res.send(simplePage("درباره AESTRA", "AESTRA یک فروشگاه آنلاین مدرن برای پوشاک، ساعت، کیف، کفش و اکسسوری است. هدف ما ساختن تجربه‌ای ساده، شیک و قابل اعتماد برای انتخاب استایل شخصی شماست.")));
app.get("/contact", (req, res) => res.send(shell(`<section class="panel reveal"><h1>تماس با ما</h1><p class="muted">آدرس: تهران، خیابان نمونه، پلاک ۱۲</p><p class="muted">شماره تماس: ۰۲۱-۰۰۰۰۰۰۰۰</p><input class="input" placeholder="نام شما"><br><br><input class="input" placeholder="شماره تماس"><br><br><input class="input" placeholder="پیام شما"></section>`, "home")));
app.get("/account", (req, res) => res.send(simplePage("حساب کاربری", "برای ثبت نام یا ورود، از دکمه ثبت نام / ورود در بالای سایت استفاده کنید.", "account")));
app.get("/support", (req, res) => res.send(simplePage("پشتیبانی", "پشتیبانی سفارش‌ها، راهنمای خرید و پیگیری ارسال از این بخش انجام می‌شود.")));
app.get("/ticket", (req, res) => res.send(simplePage("تیکت", "در نسخه نهایی وردپرس، سیستم تیکت برای پیگیری درخواست‌های مشتری فعال می‌شود.")));
app.get("/discounts", (req, res) => res.send(simplePage("تخفیف‌ها", "کدهای تخفیف و پیشنهادهای ویژه AESTRA در این بخش نمایش داده می‌شود.")));
app.get("/lottery", (req, res) => res.send(simplePage("قرعه‌کشی", "کمپین‌ها و قرعه‌کشی‌های مناسبتی برند AESTRA در این صفحه قرار می‌گیرد.")));
app.get("/admin", (req, res) => res.send(shell(`<section class="panel"><h1>پنل ادمین نمایشی</h1><p class="muted">در نسخه نهایی، مدیریت محصولات و سفارش‌ها از WooCommerce انجام می‌شود.</p>${orders.length ? orders.map(o=>`<div class="cart-row"><strong>${o.name}</strong><span>${o.phone}</span><b>${o.cart.length} محصول</b></div>`).join("") : "<p>هنوز سفارشی ثبت نشده است.</p>"}</section>`, "account")));
app.get("/version", (req, res) => res.json({app:"AESTRA", version:"preview-v4-animated-auth", ok:true}));

app.listen(PORT, () => console.log("AESTRA Preview v4 running on port " + PORT));
