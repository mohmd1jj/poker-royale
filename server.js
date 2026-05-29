
const express = require("express");
const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

// جلوگیری از کش مرورگر
app.use((req,res,next)=>{
    res.setHeader("Cache-Control","no-store, no-cache, must-revalidate, max-age=0");
    res.setHeader("Pragma","no-cache");
    res.setHeader("Expires","0");
    next();
});

// نمونه محصولات
const products=[
{id:1,fa:"کت اورسایز مشکی",en:"Noir Oversized Blazer",category:"women",price:2490000,oldPrice:2990000,badge:"New",image:"https://images.unsplash.com/photo-1496747611176-843222e1e57c?auto=format&fit=crop&w=1200&q=85",desc:"استایل رسمی و مدرن برای ترکیب‌های روزمره و نیمه‌رسمی."},
{id:2,fa:"پیراهن مردانه مینیمال",en:"Essential Men Shirt",category:"men",price:1290000,oldPrice:0,badge:"Essential",image:"https://images.unsplash.com/photo-1516257984-b1b4d707412e?auto=format&fit=crop&w=1200&q=85",desc:"پیراهن ساده، تمیز و مناسب ست‌های مینیمال."}
];

const categories=[
{id:"all",fa:"همه"},{id:"women",fa:"زنانه"},{id:"men",fa:"مردانه"},{id:"accessories",fa:"اکسسوری"},{id:"watches",fa:"ساعت"},{id:"bags",fa:"کیف"},{id:"shoes",fa:"کفش"}
];

function money(n){return Number(n||0).toLocaleString("fa-IR")+" تومان";}

function card(p){return `<article class="product"><a href="/product/${p.id}"><div class="img" style="background-image:url('${p.image}')"><span class="badge">${p.badge}</span></div></a><div class="info"><div class="catMini">${(categories.find(c=>c.id===p.category)||{}).fa||""}</div><h3>${p.fa}</h3><p>${p.en}</p><div><span class="price">${money(p.price)}</span>${p.oldPrice?`<span class="old">${money(p.oldPrice)}</span>`:""}</div><button class="add" onclick='addToCart(${p.id},${JSON.stringify(p.fa)},${p.price},${JSON.stringify(p.image)})'>افزودن به سبد</button></div></article>`;}

function shell(content,active="home"){return `<!doctype html><html lang="fa" dir="rtl"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/><title>AESTRA</title><style>body{margin:0;font-family:Arial,Tahoma,sans-serif;color:#171412;background:#f6f0e8}a{text-decoration:none;color:inherit}.wrap{width:100%;max-width:1180px;margin:0 auto}.top{position:sticky;top:0;z-index:50;margin:0 0 14px;padding:8px;border:1px solid rgba(23,20,18,.12);border-radius:26px;background:#fffaf4;display:flex;align-items:center;gap:8px}.brand{display:flex;align-items:center;gap:10px;min-width:0}.logo{width:44px;height:44px;border-radius:16px;background:linear-gradient(135deg,#151515,#4a3a22 52%,#d8bd7b);color:#fffaf4;display:grid;place-items:center;font-weight:1000;letter-spacing:-1px}.brandText{font-weight:1000;letter-spacing:3px}.nav{display:flex;gap:6px;overflow:auto;flex:1}.nav a{white-space:nowrap;border:1px solid rgba(23,20,18,.12);border-radius:15px;padding:10px 12px;color:#766f68;font-size:13px;font-weight:900;background:rgba(255,255,255,.48)}.nav a.active{background:#101010;color:#fffaf4}.iconBtn{border:1px solid rgba(23,20,18,.12);border-radius:15px;padding:10px 12px;background:#101010;color:#fffaf4;font-weight:1000}</style></head><body><main class="wrap"><header class="top"><a class="brand" href="/"><span class="logo">A</span><span class="brandText">AESTRA</span></a><nav class="nav"><a class="${active==="home"?"active":""}" href="/">خانه</a><a class="${active==="shop"?"active":""}" href="/shop">فروشگاه</a><a class="${active==="cart"?"active":""}" href="/cart">سبد خرید</a><a class="${active==="admin"?"active":""}" href="/admin">ادمین</a></nav><a class="iconBtn" href="/cart">سبد</a></header>${content}</main></body></html>`;}

app.get("/",(req,res)=>{res.send(shell(`<section class="hero"><h1>پیش‌نمایش حرفه‌ای AESTRA</h1><p>نسخه حرفه‌ای پیش‌نمایش برند آماده است.</p></section>`));});

app.listen(PORT,()=>console.log("AESTRA Preview v2 running on port "+PORT));
