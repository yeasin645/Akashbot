const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); 
const app = express();

// --- Configuration (Environment Variables) ---
const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL; // উদা: https://myapp.onrender.com
const mongoUri = process.env.MONGODB_URI; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; 

const bot = new TelegramBot(token, { polling: true });

// --- MongoDB Connection ---
mongoose.connect(mongoUri)
    .then(() => console.log("✅ MongoDB Connected!"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    id: String, title: String, image: String, links: Array, channels: Array 
}));

const Setting = mongoose.model('Setting', new mongoose.Schema({
    key: String, value: mongoose.Schema.Types.Mixed
}));

const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({
    userId: Number,
    packageName: String,
    expiryDate: Date
}));

let userState = {};

// --- Helper Functions ---
async function getSet(key, defaultValue) {
    const data = await Setting.findOne({ key });
    return data ? data.value : defaultValue;
}
async function saveSet(key, value) {
    await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
}

async function isPremium(chatId) {
    if (chatId === ADMIN_ID) return true;
    const user = await PremiumUser.findOne({ userId: chatId });
    if (!user) return false;
    if (new Date() > user.expiryDate) {
        await PremiumUser.deleteOne({ userId: chatId });
        return false;
    }
    return true;
}

async function sendPremiumPricing(chatId) {
    const packages = await getSet('premium_packages', []);
    let pkgText = "💎 **আমাদের প্রিমিয়াম প্ল্যানসমূহ:**\n\n";
    if (packages.length === 0) pkgText += "বর্তমানে কোনো প্যাকেজ নেই।";
    else packages.forEach(pkg => pkgText += `✅ ${pkg.name} - ${pkg.price}\n`);
    
    pkgText += `\n📌 **সুবিধা:** আনলিমিটেড মুভি পোস্ট তৈরি।\n\nকিনতে নিচের বাটনে ক্লিক করুন:`;
    bot.sendMessage(chatId, pkgText, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: "💳 কিনতে যোগাযোগ করুন", url: `https://t.me/${ADMIN_USERNAME}` }]] }
    });
}

// --- Website Route ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("পোস্টটি পাওয়া যায়নি!");
    const zoneId = await getSet('zone_id', '10341337');
    const clicks = await getSet('required_clicks', 3);
    res.send(generateHTML(post, zoneId, clicks));
});

// HTML Generator
function generateHTML(post, zoneId, clicks) {
    let qBtns = post.links.map(i => `<button class="btn q-btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('');
    let chSection = (post.channels && post.channels.length > 0) ? 
        `<div class="channel-box"><h3>📢 জয়েন করুন:</h3>${post.channels.map(ch => `<a href="${ch.link}" target="_blank" class="ch-link">${ch.name}</a>`).join('')}</div>` : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${post.title}</title>
    <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;}
    .card{background:#1e293b;padding:20px;border-radius:15px;border:1px solid #334155;max-width:400px;width:100%;}img{width:100%;border-radius:10px;margin-bottom:15px;}
    .channel-box{background:rgba(59,130,246,0.1);padding:10px;margin-bottom:15px;border-radius:10px;border:1px dashed #3b82f6;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:6px 12px;margin:4px;border-radius:6px;font-size:13px;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}
    .q-btn{background:#334155;border:1px solid #475569;}#st{color:#fbbf24;margin-bottom:10px;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

// --- Bot Logic & Settings ---
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id, "🎬 **মুভি পোস্ট মেকার**\n\nসব ফিচারের জন্য /settings কমান্ডটি ব্যবহার করুন।");
});

bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    let buttons = [[{ text: "🎬 নতুন পোস্ট তৈরি করুন", callback_data: "start_post" }], [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]];
    if (chatId === ADMIN_ID) {
        buttons.push([{ text: "⚙️ অ্যাড সেটিংস", callback_data: "ad_settings" }], [{ text: "📦 প্যাকেজ কন্ট্রোল", callback_data: "pkg_settings" }], [{ text: "➕ প্রিমিয়াম মেম্বার অ্যাড", callback_data: "add_user" }]);
    }
    bot.sendMessage(chatId, "🛠 **বোট মেনু**", { reply_markup: { inline_keyboard: buttons } });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === "start_post") {
        if (!(await isPremium(chatId))) return sendPremiumPricing(chatId);
        userState[chatId] = { step: 'title', links: [], channels: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    } else if (q.data === "view_premium") sendPremiumPricing(chatId);
    else if (q.data === "ad_settings" && chatId === ADMIN_ID) bot.sendMessage(chatId, "বিজ্ঞাপন সেট করতে লিখুন:\n`/setzone ID`\n`/setclicks সংখ্যা`", { parse_mode: 'Markdown' });
    else if (q.data === "pkg_settings" && chatId === ADMIN_ID) bot.sendMessage(chatId, "প্যাকেজ কমান্ড:\n`/addpkg নাম | দাম`\n`/delpkg নাম`", { parse_mode: 'Markdown' });
    else if (q.data === "add_user" && chatId === ADMIN_ID) bot.sendMessage(chatId, "মেম্বার অ্যাড করতে লিখুন:\n\n`/addpremium ID | Days | PackageName`", { parse_mode: 'Markdown' });
    else if (q.data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, title: s.title, image: s.image, links: s.links, channels: s.channels }).save();
        const zoneId = await getSet('zone_id', '10341337');
        const clicks = await getSet('required_clicks', 3);
        const finalHtml = generateHTML(s, zoneId, clicks);
        await bot.sendMessage(chatId, `✅ **সফল!**\n🔗 ${myAppUrl}/post/${id}`);
        await bot.sendMessage(chatId, `📄 **HTML কোড:**\n\n\`\`\`html\n${finalHtml}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
});

// Admin Control Handlers
bot.onText(/\/addpremium (.+)\|(.+)\|(.+)/, async (msg, match) => {
    if (msg.chat.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1].trim());
    const days = parseInt(match[2].trim());
    const pkgName = match[3].trim();
    const expiry = moment().add(days, 'days').tz("Asia/Dhaka");
    await PremiumUser.findOneAndUpdate({ userId: targetId }, { packageName: pkgName, expiryDate: expiry.toDate() }, { upsert: true });
    bot.sendMessage(ADMIN_ID, `✅ ইউজার ${targetId} অ্যাড হয়েছে।`);
    bot.sendMessage(targetId, `🎉 **প্রিমিয়াম চালু হয়েছে!**\n📦 প্যাকেজ: ${pkgName}\n⏳ মেয়াদ: ${days} দিন\n🚫 শেষ হবে: ${expiry.format('DD-MM-YYYY hh:mm A')}`);
});

bot.onText(/\/setzone (.+)/, async (msg, match) => { if (msg.chat.id === ADMIN_ID) await saveSet('zone_id', match[1].trim()); bot.sendMessage(msg.chat.id, "✅ জোন আইডি সেভ হয়েছে।"); });
bot.onText(/\/setclicks (\d+)/, async (msg, match) => { if (msg.chat.id === ADMIN_ID) await saveSet('required_clicks', parseInt(match[1])); bot.sendMessage(msg.chat.id, "✅ ক্লিক আপডেট হয়েছে।"); });
bot.onText(/\/addpkg (.+)\|(.+)/, async (msg, match) => {
    if (msg.chat.id !== ADMIN_ID) return;
    let pkgs = await getSet('premium_packages', []);
    pkgs.push({ name: match[1].trim(), price: match[2].trim() });
    await saveSet('premium_packages', pkgs);
    bot.sendMessage(msg.chat.id, "✅ নতুন প্যাকেজ যুক্ত হয়েছে।");
});

// Movie Posting Process
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if (!userState[chatId] || !text || text.startsWith('/')) return;
    let s = userState[chatId];
    if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 ইমেজ লিঙ্ক দিন:"); } 
    else if (s.step === 'image') { s.image = text; s.step = 'ch_name'; bot.sendMessage(chatId, "📢 ১ম চ্যানেলের নাম (অথবা 'skip'):"); } 
    else if (s.step === 'ch_name') {
        if (text.toLowerCase() === 'skip' || text.toLowerCase() === 'done') { s.step = 'q_name'; return bot.sendMessage(chatId, "📊 কোয়ালিটির নাম:"); }
        s.tempChName = text; s.step = 'ch_link'; bot.sendMessage(chatId, `🔗 '${text}' লিঙ্ক:`);
    } else if (s.step === 'ch_link') { s.channels.push({ name: s.tempChName, link: text }); s.step = 'ch_name'; bot.sendMessage(chatId, "✅ যুক্ত হয়েছে। পরের চ্যানেলের নাম অথবা 'done':"); }
    else if (s.step === 'q_name') {
        if (text.toLowerCase() === 'done' || text.toLowerCase() === 'skip') return bot.sendMessage(chatId, `নিচে কনফার্ম করুন:`, { reply_markup: { inline_keyboard: [[{ text: "✅ কনফার্ম", callback_data: 'confirm' }]] } });
        s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, `🔗 '${text}' লিঙ্ক:`);
    } else if (s.step === 'q_link') { s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name'; bot.sendMessage(chatId, "✅ পরের কোয়ালিটি অথবা 'done':"); }
});

app.listen(process.env.PORT || 3000, () => console.log("Server Running"));
