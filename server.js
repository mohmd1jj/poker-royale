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
  {id:"shoes", fa:"کفش", en:"Shoes", image:"https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=800&q=85"},
];

const allCats = [
  {id:"all", fa:"همه"},
  {id:"women", fa:"زنانه"},
  {id:"men", fa:"مردانه"},
  {id:"accessories", fa:"اکسسوری"},
  {id:"watches", fa:"ساعت"},
  {id:"bags", fa:"کیف"},
  {id:"shoes", fa:"کفش"}
];

const orders = [];

function money(n) {
  return Number(n || 0).toLocaleString("fa-IR") + " تومان";
}

function productCard(p) {
  return `
  <article class="product-card">
    <button class="wish" type="button">♡</button>
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
      --bg:#f7f1e9;
      --paper:#fffaf4;
      --paper2:#f0e5d7;
      --ink:#14110f;
      --muted:#7e766d;
      --line:rgba(20,17,15,.12);
      --gold:#b99558;
      --black:#101010;
      --shadow:0 22px 70px rgba(76,48,22,.12);
      --radius:24px;
    }
    body{margin:0;min-height:100vh;font-family:Arial,Tahoma,sans-serif;color:var(--ink);background:linear-gradient(180deg,#fbf7f1 0%,#f6eee4 52%,#efe2d2 100%);padding-bottom:calc(84px + env(safe-area-inset-bottom))}
    a{text-decoration:none;color:inherit}
    .wrap{width:100%;max-width:1220px;margin:0 auto;padding:0 14px}
    .top-strip{background:#101010;color:#fffaf4;font-size:12px;padding:9px 14px;text-align:center}
    .header{position:sticky;top:0;z-index:50;background:rgba(255,250,244,.92);backdrop-filter:blur(16px);border-bottom:1px solid var(--line)}
    .header-inner{width:100%;max-width:1220px;margin:0 auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:12px;padding:13px 14px}
    .nav{display:flex;gap:8px;align-items:center;overflow:auto}
    .nav a{white-space:nowrap;padding:10px 13px;border-radius:999px;color:#4f4740;font-weight:800;font-size:14px}
    .nav a.active{background:#101010;color:#fffaf4}
    .brand{font-family:Georgia,serif;font-size:34px;letter-spacing:4px;font-weight:500;text-align:center}
    .actions{display:flex;align-items:center;gap:8px;justify-content:flex-end}
    .search{width:min(270px,34vw);border:none;background:#f1e8dc;border-radius:999px;padding:12px 16px;outline:none;color:#181512}
    .icon{width:42px;height:42px;border-radius:999px;border:1px solid var(--line);background:#fffaf4;display:grid;place-items:center;font-weight:900;position:relative}
    .cart-count{position:absolute;top:-5px;left:-5px;background:#101010;color:#fff;border-radius:999px;font-size:10px;width:18px;height:18px;display:grid;place-items:center}
    .hero{margin:18px auto 0;width:100%;max-width:1220px;border-radius:0 0 30px 30px;overflow:hidden;background:linear-gradient(90deg,rgba(255,250,244,.92),rgba(255,250,244,.35)),url('https://images.unsplash.com/photo-1515886657613-9f3515b0c78f?auto=format&fit=crop&w=1800&q=88');background-size:cover;background-position:center;min-height:440px;display:grid;grid-template-columns:1fr 1fr;align-items:center;padding:44px;box-shadow:var(--shadow);position:relative}
    .hero h1{font-family:Georgia,serif;font-size:clamp(58px,11vw,96px);letter-spacing:3px;margin:0;color:#14110f}
    .hero h2{font-size:20px;margin:0 0 8px;color:#362d24}
    .hero p{font-size:17px;line-height:2;color:#4f4740;max-width:470px}
    .hero-btn{display:inline-flex;background:#101010;color:#fffaf4;border-radius:10px;padding:14px 22px;font-weight:900;margin-top:14px}
    .slider-dots{position:absolute;bottom:18px;left:50%;transform:translateX(-50%);display:flex;gap:7px}
    .slider-dots span{width:8px;height:8px;border-radius:99px;background:#fff}.slider-dots span:first-child{background:#101010}
    .trust{max-width:1060px;margin:-20px auto 20px;background:rgba(255,250,244,.96);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);display:grid;grid-template-columns:repeat(4,1fr);gap:0;overflow:hidden;position:relative;z-index:3}
    .trust-item{padding:17px 14px;display:flex;gap:10px;align-items:center;justify-content:center;border-left:1px solid var(--line)}
    .trust-item:last-child{border-left:0}.trust-icon{font-size:22px}.trust-title{font-weight:900}.trust-sub{font-size:12px;color:var(--muted);margin-top:3px}
    .section-head{display:flex;align-items:end;justify-content:space-between;margin:34px 0 16px}
    .section-head h2{margin:0;font-size:25px}.section-head a{font-size:13px;color:#5f564d;font-weight:900}
    .cat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
    .cat-card{background:#fffaf4;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:var(--shadow);text-align:center}
    .cat-img{height:180px;background-size:cover;background-position:center}.cat-card strong{display:block;padding:14px 0 4px}.cat-card span{display:block;color:#766f68;font-size:12px;padding-bottom:14px}
    .products{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
    .product-card{position:relative;background:#fffaf4;border:1px solid var(--line);border-radius:18px;overflow:hidden;box-shadow:var(--shadow)}
    .wish{position:absolute;z-index:2;top:10px;right:10px;width:34px;height:34px;border-radius:999px;border:0;background:rgba(255,255,255,.82);font-size:18px}
    .product-image{display:block;height:260px;background-size:cover;background-position:center;position:relative}
    .product-badge{position:absolute;top:10px;left:10px;background:#101010;color:#fffaf4;border-radius:999px;padding:6px 10px;font-size:11px;font-weight:900}
    .product-info{padding:13px}.product-title{display:block;font-weight:900;margin-bottom:5px}.product-sub{color:var(--muted);font-size:12px;margin-bottom:8px}.product-price strong{font-size:14px}.product-price span{text-decoration:line-through;color:#9b9187;font-size:12px;margin-right:6px}
    .add-btn{width:100%;margin-top:11px;border:0;background:#101010;color:#fffaf4;border-radius:12px;padding:11px;font-weight:900}
    .brand-block{margin:38px 0;background:linear-gradient(135deg,#171412,#3c2d1c);color:#fffaf4;border-radius:28px;padding:28px;display:grid;grid-template-columns:1fr 1fr;gap:20px;box-shadow:var(--shadow)}
    .brand-block h2{font-family:Georgia,serif;font-size:42px;letter-spacing:3px;margin:0}.brand-block p{line-height:2;color:#eadfcc}
    .newsletter{background:#fffaf4;border:1px solid var(--line);border-radius:22px;padding:20px;display:flex;gap:10px;align-items:center;justify-content:space-between}
    .newsletter input{flex:1;border:1px solid var(--line);background:#f4eadf;border-radius:12px;padding:14px;outline:none}.newsletter button{border:0;background:#101010;color:#fffaf4;border-radius:12px;padding:14px 18px;font-weight:900}
    .footer{margin-top:34px;background:#101010;color:#fffaf4;padding:32px 14px}.footer-inner{max-width:1220px;margin:0 auto;display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:20px}.footer h3{font-family:Georgia,serif;letter-spacing:2px}.footer a,.footer p{display:block;color:#d6ccbf;line-height:2;font-size:13px}
    .panel{background:#fffaf4;border:1px solid var(--line);border-radius:24px;box-shadow:var(--shadow);padding:20px;margin:18px 0}
    .shop-tools{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}.shop-tools input{border:1px solid var(--line);border-radius:14px;background:#fff;padding:14px;outline:none}.filters{display:flex;gap:8px;overflow:auto}.filters a{white-space:nowrap;border:1px solid var(--line);border-radius:999px;padding:11px 14px;background:#fff}.filters a.active{background:#101010;color:#fff}
    .product-page{display:grid;grid-template-columns:1.05fr .95fr;gap:18px}.big-img{min-height:560px;border-radius:24px;background-size:cover;background-position:center}.detail h1{font-size:34px;margin:0 0 8px}.detail .price{font-size:24px;font-weight:1000;margin:16px 0}.chips{display:flex;gap:8px;flex-wrap:wrap}.chip{border:1px solid var(--line);padding:10px 13px;border-radius:12px;background:#fff}.qty{display:inline-flex;gap:8px;align-items:center;border:1px solid var(--line);border-radius:14px;padding:7px;margin:12px 0}.qty button{width:30px;height:30px;border:0;border-radius:10px;background:#eee}
    .cart-row{display:grid;grid-template-columns:70px 1fr auto;gap:12px;align-items:center;border-bottom:1px solid var(--line);padding:12px 0}.cart-img{width:70px;height:80px;border-radius:12px;background-size:cover;background-position:center}.input{width:100%;border:1px solid var(--line);border-radius:14px;background:#fff;padding:14px;outline:none}.form{display:grid;gap:10px}
    .bottom{display:none}
    @media(max-width:760px){
      body{padding-bottom:calc(86px + env(safe-area-inset-bottom))}.top-strip{font-size:11px}.header-inner{display:flex;padding:10px 8px}.brand{font-size:22px;letter-spacing:3px}.actions .search,.desktop-only{display:none}.nav{order:3;width:100%;display:none}.hero{margin-top:10px;border-radius:24px;min-height:430px;grid-template-columns:1fr;padding:24px;background-position:center}.hero h1{font-size:58px}.hero p{font-size:14px}.trust{grid-template-columns:repeat(2,1fr);margin:12px 14px}.trust-item{justify-content:flex-start}.cat-grid,.products{grid-template-columns:repeat(2,1fr);gap:10px}.cat-img{height:130px}.product-image{height:210px}.brand-block{grid-template-columns:1fr;margin:26px 0}.newsletter{display:grid}.footer-inner{grid-template-columns:1fr}.product-page{grid-template-columns:1fr}.big-img{min-height:390px}.shop-tools{grid-template-columns:1fr}.bottom{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(10px + env(safe-area-inset-bottom));width:min(94%,620px);display:grid;grid-template-columns:repeat(4,1fr);gap:6px;background:rgba(255,250,244,.9);backdrop-filter:blur(15px);border:1px solid var(--line);border-radius:22px;padding:7px;z-index:100;box-shadow:0 -18px 44px rgba(80,54,24,.16)}.bottom a{text-align:center;border-radius:15px;padding:10px 4px;font-size:12px;font-weight:900;color:var(--muted)}.bottom a.active{background:#101010;color:#fff}
    }
  </style>
</head>
<body>
  <div class="top-strip">ارسال رایگان برای خریدهای بالای ۲ میلیون تومان | پشتیبانی آنلاین ۲۴/۷</div>
  <header class="header">
    <div class="header-inner">
      <nav class="nav desktop-only">
        <a class="${active==="home"?"active":""}" href="/">خانه</a>
        <a class="${active==="shop"?"active":""}" href="/shop">فروشگاه</a>
        <a href="/shop?cat=women">زنانه</a>
        <a href="/shop?cat=men">مردانه</a>
        <a href="/about">درباره ما</a>
        <a href="/contact">تماس با ما</a>
      </nav>
      <a class="brand" href="/">AESTRA</a>
      <div class="actions">
        <input class="search" placeholder="جستجوی محصول..." onkeydown="if(event.key==='Enter') location.href='/shop?q='+encodeURIComponent(this.value)">
        <a class="icon" href="/account">♡</a>
        <a class="icon" href="/cart">🛍<span class="cart-count" id="cartCount">0</span></a>
      </div>
    </div>
  </header>
  <main class="wrap">${content}</main>
  <nav class="bottom">
    <a class="${active==="home"?"active":""}" href="/">خانه</a>
    <a class="${active==="shop"?"active":""}" href="/shop">فروشگاه</a>
    <a class="${active==="cart"?"active":""}" href="/cart">سبد</a>
    <a class="${active==="account"?"active":""}" href="/account">حساب</a>
  </nav>
  <script>
    function getCart(){try{return JSON.parse(localStorage.getItem("aestra_cart")||"[]")}catch(e){return []}}
    function setCart(c){localStorage.setItem("aestra_cart",JSON.stringify(c));updateCartCount()}
    function updateCartCount(){const n=getCart().reduce((s,i)=>s+i.qty,0);const el=document.getElementById("cartCount");if(el)el.textContent=n}
    function addToCart(id,name,price,image){const c=getCart();const item=c.find(x=>x.id===id);if(item)item.qty++;else c.push({id,name,price,image,qty:1});setCart(c);alert("به سبد خرید اضافه شد")}
    function changeQty(id,d){const c=getCart();const it=c.find(x=>x.id===id);if(!it)return;it.qty+=d;if(it.qty<=0)c.splice(c.indexOf(it),1);setCart(c);location.reload()}
    function clearCart(){setCart([]);location.reload()}
    updateCartCount();
  </script>
</body>
</html>`;
}

app.get("/api/products", (req, res) => res.json({ products, categories: allCats }));

app.get("/", (req, res) => {
  const newItems = products.slice(0,4).map(productCard).join("");
  const bestItems = products.slice(4,8).map(productCard).join("");
  const catCards = categories.map(c => `<a class="cat-card" href="/shop?cat=${c.id}"><div class="cat-img" style="background-image:url('${c.image}')"></div><strong>${c.fa}</strong><span>مشاهده</span></a>`).join("");
  res.send(shell(`
    <section class="hero">
      <div>
        <h2>کالکشن جدید بهار و تابستان ۱۴۰۴</h2>
        <h1>AESTRA</h1>
        <p>استایل شما، امضای شماست. آسترا برای کسانی ساخته شده که انتخاب لباس را فقط خرید نمی‌بینند؛ بلکه ساختن تصویر شخصی می‌دانند.</p>
        <a class="hero-btn" href="/shop">مشاهده کالکشن جدید</a>
      </div>
      <div></div>
      <div class="slider-dots"><span></span><span></span><span></span></div>
    </section>

    <section class="trust">
      <div class="trust-item"><div class="trust-icon">🚚</div><div><div class="trust-title">ارسال سریع</div><div class="trust-sub">ارسال به سراسر کشور</div></div></div>
      <div class="trust-item"><div class="trust-icon">↩️</div><div><div class="trust-title">ضمانت بازگشت</div><div class="trust-sub">۷ روز ضمانت بازگشت کالا</div></div></div>
      <div class="trust-item"><div class="trust-icon">🛡️</div><div><div class="trust-title">پرداخت امن</div><div class="trust-sub">درگاه معتبر پرداخت</div></div></div>
      <div class="trust-item"><div class="trust-icon">🎧</div><div><div class="trust-title">پشتیبانی ۲۴/۷</div><div class="trust-sub">پشتیبانی آنلاین</div></div></div>
    </section>

    <div class="section-head"><h2>دسته‌بندی‌های محبوب</h2><a href="/shop">مشاهده همه</a></div>
    <section class="cat-grid">${catCards}</section>

    <div class="section-head"><h2>محصولات جدید</h2><a href="/shop">مشاهده همه</a></div>
    <section class="products">${newItems}</section>

    <div class="brand-block">
      <div><h2>AESTRA</h2><p>ما به فکر استایل شما هستیم. از لباس روزمره تا اکسسوری‌های خاص، آسترا تلاش می‌کند انتخاب‌های شیک و قابل اعتماد را در یک تجربه خرید ساده کنار هم قرار دهد.</p></div>
      <div class="newsletter"><div><strong>عضویت در خبرنامه</strong><p style="color:#d6ccbf;line-height:1.8">از کالکشن‌ها و تخفیف‌ها زودتر باخبر شوید.</p></div><input placeholder="ایمیل یا شماره موبایل"><button>عضویت</button></div>
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
    <section class="panel">
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
    <section class="product-page">
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
    <section class="product-page">
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

app.get("/about", (req, res) => res.send(shell(`<section class="panel"><h1>درباره AESTRA</h1><p class="muted">AESTRA یک برند فروشگاهی مدرن و لوکس است که با هدف ساده‌تر کردن انتخاب استایل شخصی طراحی شده است.</p></section>`, "home")));
app.get("/contact", (req, res) => res.send(shell(`<section class="panel"><h1>تماس با ما</h1><p class="muted">پشتیبانی، پیگیری سفارش و همکاری با برند از این بخش انجام می‌شود.</p><input class="input" placeholder="نام شما"><br><br><input class="input" placeholder="شماره تماس"><br><br><input class="input" placeholder="پیام شما"></section>`, "home")));
app.get("/account", (req, res) => res.send(shell(`<section class="panel"><h1>حساب کاربری</h1><p class="muted">در نسخه وردپرس، این بخش به حساب کاربری WooCommerce متصل می‌شود.</p></section>`, "account")));
app.get("/admin", (req, res) => res.send(shell(`<section class="panel"><h1>پنل ادمین نمایشی</h1><p class="muted">در نسخه نهایی، مدیریت محصولات و سفارش‌ها از WooCommerce انجام می‌شود.</p>${orders.length ? orders.map(o=>`<div class="cart-row"><strong>${o.name}</strong><span>${o.phone}</span><b>${o.cart.length} محصول</b></div>`).join("") : "<p>هنوز سفارشی ثبت نشده است.</p>"}</section>`, "account")));
app.get("/version", (req, res) => res.json({app:"AESTRA", version:"preview-v3-full", ok:true}));

app.listen(PORT, () => console.log("AESTRA Preview v3 running on port " + PORT));
