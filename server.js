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
  { id: 1, name: "Noir Oversized Blazer", fa: "کت اورسایز مشکی", category: "women", price: 2490000, oldPrice: 2990000, badge: "New", image: "https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=900&q=80", desc: "A sharp oversized blazer for premium everyday styling." },
  { id: 2, name: "Essential Men Shirt", fa: "پیراهن مردانه مینیمال", category: "men", price: 1290000, oldPrice: 0, badge: "Essential", image: "https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=900&q=80", desc: "Minimal shirt with clean lines and easy pairing." },
  { id: 3, name: "Luna Gold Watch", fa: "ساعت طلایی لونا", category: "watches", price: 3890000, oldPrice: 4490000, badge: "Best", image: "https://images.unsplash.com/photo-1523275335684-37898b6baf30?auto=format&fit=crop&w=900&q=80", desc: "Statement watch for daily luxury." },
  { id: 4, name: "Urban Crossbody Bag", fa: "کیف کراس‌بادی شهری", category: "bags", price: 1790000, oldPrice: 0, badge: "Trend", image: "https://images.unsplash.com/photo-1594223274512-ad4803739b7c?auto=format&fit=crop&w=900&q=80", desc: "Compact bag with premium urban look." },
  { id: 5, name: "Silver Link Bracelet", fa: "دستبند لینک نقره‌ای", category: "accessories", price: 690000, oldPrice: 890000, badge: "Sale", image: "https://images.unsplash.com/photo-1515562141207-7a88fb7ce338?auto=format&fit=crop&w=900&q=80", desc: "Clean accessory for casual and formal outfits." },
  { id: 6, name: "Clean White Sneakers", fa: "کتانی سفید مینیمال", category: "shoes", price: 2190000, oldPrice: 0, badge: "Fresh", image: "https://images.unsplash.com/photo-1549298916-b41d501d3772?auto=format&fit=crop&w=900&q=80", desc: "Minimal sneakers made for everyday styling." },
  { id: 7, name: "Velora Black Dress", fa: "پیراهن زنانه مشکی", category: "women", price: 1990000, oldPrice: 2490000, badge: "Limited", image: "https://images.unsplash.com/photo-1485968579580-b6d095142e6e?auto=format&fit=crop&w=900&q=80", desc: "Elegant black dress for evening looks." },
  { id: 8, name: "Monochrome Hoodie", fa: "هودی مونوکروم", category: "men", price: 1490000, oldPrice: 0, badge: "Street", image: "https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=900&q=80", desc: "Streetwear hoodie with a premium silhouette." }
];

const categories = [
  { id: "all", fa: "همه" }, { id: "women", fa: "زنانه" }, { id: "men", fa: "مردانه" },
  { id: "accessories", fa: "اکسسوری" }, { id: "watches", fa: "ساعت" },
  { id: "bags", fa: "کیف" }, { id: "shoes", fa: "کفش" }
];

const orders = [];

function money(n) {
  return Number(n || 0).toLocaleString("fa-IR") + " تومان";
}

function productCard(p) {
  return `<article class="product">
    <a href="/product/${p.id}"><div class="img" style="background-image:url('${p.image}')"><span class="badge">${p.badge}</span></div></a>
    <div class="info">
      <h3>${p.fa}</h3>
      <div><span class="price">${money(p.price)}</span>${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}</div>
      <button class="add" onclick='addToCart(${p.id},${JSON.stringify(p.fa)},${p.price},${JSON.stringify(p.image)})'>افزودن به سبد</button>
    </div>
  </article>`;
}

function shell(content, active = "home") {
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#080808" />
<title>VELORA</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
:root{--bg:#080808;--panel:#111;--text:#f7f3ed;--muted:#aaa39a;--line:rgba(255,255,255,.10);--cream:#e8dac6;--danger:#a83232}
body{margin:0;min-height:100vh;font-family:Arial,Tahoma,sans-serif;color:var(--text);background:radial-gradient(circle at 50% -10%,rgba(197,164,106,.16),transparent 34%),linear-gradient(180deg,#111,#070707 48%,#030303 100%);padding:calc(12px + env(safe-area-inset-top)) 12px calc(92px + env(safe-area-inset-bottom))}
a{text-decoration:none;color:inherit}.wrap{width:100%;max-width:1120px;margin:0 auto}
.top{position:sticky;top:0;z-index:50;margin:0 0 12px;padding:8px;border:1px solid var(--line);border-radius:24px;background:rgba(8,8,8,.80);backdrop-filter:blur(16px);display:flex;align-items:center;gap:8px;box-shadow:0 18px 48px rgba(0,0,0,.38)}
.brand{display:flex;align-items:center;gap:10px;min-width:0}.logo{width:42px;height:42px;border-radius:15px;background:linear-gradient(135deg,#f8efe0,#9b7a43);color:#080808;display:grid;place-items:center;font-weight:1000;letter-spacing:-1px}.brandText{font-weight:1000;letter-spacing:2px}
.nav{display:flex;gap:6px;overflow:auto;flex:1}.nav a{white-space:nowrap;border:1px solid var(--line);border-radius:15px;padding:10px 12px;color:var(--muted);font-size:13px;font-weight:900;background:rgba(255,255,255,.035)}.nav a.active{background:var(--cream);color:#090909}
.iconBtn{border:1px solid var(--line);border-radius:15px;padding:10px 12px;background:rgba(255,255,255,.04);color:var(--text);font-weight:1000}
.hero{position:relative;min-height:430px;border:1px solid var(--line);border-radius:34px;overflow:hidden;background:linear-gradient(90deg,rgba(0,0,0,.82),rgba(0,0,0,.42)),url('https://images.unsplash.com/photo-1490481651871-ab68de25d43d?auto=format&fit=crop&w=1600&q=85');background-size:cover;background-position:center;display:flex;align-items:flex-end;padding:28px;box-shadow:0 28px 80px rgba(0,0,0,.42)}
.eyebrow{display:inline-flex;border:1px solid rgba(232,218,198,.34);border-radius:999px;padding:8px 13px;color:var(--cream);background:rgba(0,0,0,.32);font-size:12px;font-weight:1000;margin-bottom:12px}.hero h1{margin:0;font-size:clamp(42px,10vw,84px);line-height:.95;letter-spacing:-2px}.hero p{max-width:620px;color:#ddd5ca;line-height:2;font-size:16px}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:18px}.btn{border:none;border-radius:18px;padding:14px 18px;font-weight:1000;text-align:center}.primary{background:var(--cream);color:#080808}.secondary{border:1px solid rgba(255,255,255,.15);background:rgba(255,255,255,.06);color:var(--text)}
.section{margin:26px 2px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px}.section h2{margin:0;font-size:28px}.pill{border:1px solid var(--line);border-radius:999px;padding:8px 13px;color:var(--muted);font-size:13px;background:rgba(255,255,255,.04)}
.catGrid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.cat{min-height:132px;border:1px solid var(--line);border-radius:26px;padding:17px;background:linear-gradient(145deg,#151515,#0d0d0d);display:flex;align-items:flex-end;box-shadow:0 18px 44px rgba(0,0,0,.28)}.cat strong{font-size:22px}.cat span{display:block;color:var(--muted);font-size:13px;margin-top:5px}
.products{display:grid;grid-template-columns:repeat(2,1fr);gap:13px}.product{border:1px solid var(--line);border-radius:26px;background:rgba(255,255,255,.035);overflow:hidden;box-shadow:0 18px 48px rgba(0,0,0,.24)}.img{aspect-ratio:1/1.12;background:#222;background-size:cover;background-position:center;position:relative}.badge{position:absolute;top:10px;right:10px;border-radius:999px;padding:7px 10px;background:rgba(0,0,0,.58);border:1px solid rgba(255,255,255,.16);color:var(--cream);font-size:12px;font-weight:1000}.info{padding:13px}.info h3{margin:0 0 6px;font-size:16px;line-height:1.4}.price{font-weight:1000;color:var(--cream)}.old{text-decoration:line-through;color:#777;font-size:12px;margin-inline-start:6px}.add{margin-top:10px;width:100%;border:none;border-radius:15px;padding:11px;background:#f0e2cd;color:#080808;font-weight:1000}
.panel{border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,rgba(255,255,255,.055),rgba(255,255,255,.025));padding:18px;margin-bottom:12px}.muted{color:var(--muted);line-height:1.9}.grid2{display:grid;gap:12px}.row{display:flex;align-items:center;justify-content:space-between;gap:10px;border-bottom:1px solid var(--line);padding:12px 0}.row:last-child{border-bottom:none}.qty{display:flex;gap:6px;align-items:center}.qty button{width:32px;height:32px;border-radius:12px;border:1px solid var(--line);background:rgba(255,255,255,.05);color:white;font-weight:1000}.input{width:100%;border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.04);color:var(--text);padding:14px;font-size:15px;outline:none}.form{display:grid;gap:10px}.danger{background:var(--danger);color:#fff}
.bottom{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(12px + env(safe-area-inset-bottom));width:min(94%,620px);display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px;border:1px solid var(--line);border-radius:24px;background:rgba(8,8,8,.82);backdrop-filter:blur(16px);z-index:60}.bottom a{text-align:center;border-radius:16px;padding:10px 4px;color:var(--muted);font-size:12px;font-weight:1000}.bottom a.active{background:var(--cream);color:#080808}
@media(min-width:760px){.catGrid{grid-template-columns:repeat(4,1fr)}.products{grid-template-columns:repeat(4,1fr)}.grid2{grid-template-columns:1.2fr .8fr}.product:first-child{grid-column:span 2}.product:first-child .img{aspect-ratio:1/0.8}}@media(max-width:520px){.brandText{display:none}.hero{min-height:390px;border-radius:28px;padding:20px}.top{border-radius:20px}.nav a{padding:9px 10px}.section h2{font-size:23px}.catGrid{gap:10px}.cat{border-radius:22px;min-height:110px}.products{gap:10px}.product{border-radius:22px}.info h3{font-size:14px}.hero p{font-size:14px}}
</style>
</head>
<body>
<main class="wrap">
<header class="top">
<a class="brand" href="/"><span class="logo">V</span><span class="brandText">VELORA</span></a>
<nav class="nav">
<a class="${active==="home"?"active":""}" href="/">خانه</a>
<a class="${active==="shop"?"active":""}" href="/shop">فروشگاه</a>
<a class="${active==="cart"?"active":""}" href="/cart">سبد خرید</a>
<a class="${active==="admin"?"active":""}" href="/admin">ادمین</a>
</nav>
<a class="iconBtn" href="/cart">سبد</a>
</header>
${content}
</main>
<nav class="bottom">
<a class="${active==="home"?"active":""}" href="/">خانه</a>
<a class="${active==="shop"?"active":""}" href="/shop">فروشگاه</a>
<a class="${active==="cart"?"active":""}" href="/cart">سبد</a>
<a class="${active==="admin"?"active":""}" href="/admin">ادمین</a>
</nav>
<script>
function getCart(){try{return JSON.parse(localStorage.getItem("velora_cart")||"[]")}catch(e){return []}}
function setCart(c){localStorage.setItem("velora_cart",JSON.stringify(c))}
function addToCart(id,name,price,image){const c=getCart();const item=c.find(x=>x.id===id);if(item)item.qty++;else c.push({id,name,price,image,qty:1});setCart(c);alert("به سبد خرید اضافه شد")}
function changeQty(id,d){const c=getCart();const it=c.find(x=>x.id===id);if(!it)return;it.qty+=d;if(it.qty<=0)c.splice(c.indexOf(it),1);setCart(c);location.reload()}
function clearCart(){setCart([]);location.reload()}
</script>
</body>
</html>`;
}

app.get("/api/products", (req, res) => res.json({ products, categories }));

app.get("/", (req, res) => {
  const cats = [["زنانه","Women","/shop?cat=women"],["مردانه","Men","/shop?cat=men"],["اکسسوری","Accessories","/shop?cat=accessories"],["ساعت","Watches","/shop?cat=watches"]];
  res.send(shell(`
<section class="hero"><div><span class="eyebrow">NEW SEASON / VELORA</span><h1>استایل تو، امضای تو</h1><p>VELORA فروشگاه فشن چندسبکی برای لباس زنانه و مردانه، ساعت، کیف، کفش و اکسسوری با طراحی مینیمال و حس لوکس است.</p><div class="actions"><a class="btn primary" href="/shop">شروع خرید</a><a class="btn secondary" href="/shop?cat=watches">مشاهده ساعت‌ها</a></div></div></section>
<div class="section"><h2>دسته‌بندی‌ها</h2><a class="pill" href="/shop">مشاهده همه</a></div>
<section class="catGrid">${cats.map(c=>`<a class="cat" href="${c[2]}"><div><strong>${c[0]}</strong><span>${c[1]}</span></div></a>`).join("")}</section>
<div class="section"><h2>محصولات منتخب</h2><span class="pill">Curated Picks</span></div>
<section class="products">${products.slice(0,6).map(p => productCard(p)).join("")}</section>
<div class="section"><h2>چرا VELORA؟</h2></div>
<section class="grid2"><div class="panel"><h3>برند چندسبکی</h3><p class="muted">برای هر استایل، از مینیمال و رسمی تا استریت و روزمره، محصول مناسب داریم.</p></div><div class="panel"><h3>آماده توسعه</h3><p class="muted">این نسخه MVP است و بعداً پرداخت، پنل سفارش، موجودی و تخفیف اضافه می‌شود.</p></div></section>
`, "home"));
});

app.get("/shop", (req, res) => {
  const cat = String(req.query.cat || "all");
  const filtered = cat === "all" ? products : products.filter(p => p.category === cat);
  const catLinks = categories.map(c => `<a class="${cat===c.id?"active":""}" href="/shop?cat=${c.id}">${c.fa}</a>`).join("");
  res.send(shell(`<section class="panel"><h1 style="margin:0 0 8px">فروشگاه VELORA</h1><p class="muted">محصولات نمونه برای نسخه اول فروشگاه. در مرحله بعد پنل افزودن محصول و مدیریت موجودی اضافه می‌شود.</p><nav class="nav" style="margin-top:12px">${catLinks}</nav></section><section class="products">${filtered.map(p => productCard(p)).join("")}</section>`, "shop"));
});

app.get("/product/:id", (req, res) => {
  const p = products.find(x => x.id === Number(req.params.id));
  if (!p) return res.status(404).send(shell(`<section class="panel"><h1>محصول پیدا نشد</h1></section>`, "shop"));
  res.send(shell(`<section class="grid2"><div class="panel" style="padding:0;overflow:hidden"><div class="img" style="aspect-ratio:1/1;background-image:url('${p.image}')"></div></div><div class="panel"><span class="eyebrow">${p.badge}</span><h1>${p.fa}</h1><p class="muted">${p.desc}</p><div style="margin:16px 0"><span class="price" style="font-size:24px">${money(p.price)}</span>${p.oldPrice ? `<span class="old">${money(p.oldPrice)}</span>` : ""}</div><div class="actions"><button class="btn primary" onclick='addToCart(${p.id},${JSON.stringify(p.fa)},${p.price},${JSON.stringify(p.image)})'>افزودن به سبد خرید</button><a class="btn secondary" href="/shop">ادامه خرید</a></div></div></section>`, "shop"));
});

app.get("/cart", (req, res) => {
  res.send(shell(`<section class="grid2"><div class="panel"><h1 style="margin:0 0 12px">سبد خرید</h1><div id="cartRows"></div></div><div class="panel"><h2 style="margin-top:0">ثبت سفارش</h2><form class="form" onsubmit="submitOrder(event)"><input class="input" id="name" placeholder="نام و نام خانوادگی" required><input class="input" id="phone" placeholder="شماره تماس" required><input class="input" id="address" placeholder="آدرس ارسال" required><button class="btn primary" type="submit">ثبت سفارش نمایشی</button><button class="btn danger" type="button" onclick="clearCart()">خالی کردن سبد</button></form><p class="muted">در این نسخه پرداخت واقعی وصل نیست؛ سفارش به‌صورت نمایشی ثبت می‌شود.</p></div></section>
<script>
function fmt(n){return Number(n||0).toLocaleString("fa-IR")+" تومان"}
function renderCart(){const c=getCart();const box=document.getElementById("cartRows");if(!c.length){box.innerHTML='<p class="muted">سبد خرید خالی است.</p>';return}let total=0;box.innerHTML=c.map(it=>{total+=it.price*it.qty;return '<div class="row"><div><strong>'+it.name+'</strong><br><span class="muted">'+fmt(it.price)+'</span></div><div class="qty"><button onclick="changeQty('+it.id+',-1)">-</button><b>'+it.qty+'</b><button onclick="changeQty('+it.id+',1)">+</button></div></div>'}).join("")+'<div class="row"><strong>جمع کل</strong><strong>'+fmt(total)+'</strong></div>'}
async function submitOrder(e){e.preventDefault();const cart=getCart();if(!cart.length)return alert("سبد خرید خالی است");const order={name:document.getElementById("name").value,phone:document.getElementById("phone").value,address:document.getElementById("address").value,cart};const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(order)});const j=await r.json();if(j.ok){setCart([]);alert("سفارش ثبت شد: "+j.orderId);location.href="/"}}
renderCart();
</script>`, "cart"));
});

app.post("/api/orders", (req, res) => {
  const order = { id: Date.now(), name: String(req.body.name || "").slice(0, 80), phone: String(req.body.phone || "").slice(0, 40), address: String(req.body.address || "").slice(0, 220), cart: Array.isArray(req.body.cart) ? req.body.cart : [], createdAt: new Date().toISOString(), status: "new" };
  orders.unshift(order);
  res.json({ ok: true, orderId: order.id });
});

app.get("/admin", (req, res) => {
  res.send(shell(`<section class="panel"><h1 style="margin:0 0 8px">پنل ادمین VELORA</h1><p class="muted">نسخه اولیه برای مشاهده سفارش‌های نمایشی. در مرحله بعد مدیریت محصول، موجودی، تخفیف و پرداخت اضافه می‌شود.</p></section><section class="panel"><h2 style="margin-top:0">سفارش‌ها</h2>${orders.length ? orders.map(o=>`<div class="row"><div><strong>${o.name}</strong><br><span class="muted">${o.phone} - ${o.address}</span></div><b>${o.cart.length} محصول</b></div>`).join("") : `<p class="muted">هنوز سفارشی ثبت نشده است.</p>`}</section>`, "admin"));
});

app.get("/version", (req, res) => res.json({ app: "VELORA", version: "mvp-v1", ok: true }));

app.listen(PORT, () => console.log("VELORA running on port " + PORT));
