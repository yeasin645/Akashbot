const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- Configuration ---
const config = {
    token: process.env.BOT_TOKEN, 
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID), 
    appUrl: process.env.APP_URL, 
    adminUsername: process.env.ADMIN_USERNAME || "Admin",
    dbVersion: process.env.DB_VERSION || "1.0"
};

// 409 Conflict Error এড়াতে পোলিং এর কিছু প্যারামিটার সেট করা হয়েছে
const bot = new TelegramBot(config.token, { 
    polling: {
        autoStart: true,
        params: { timeout: 10 }
    }
});

// এরর হ্যান্ডলার (পোলিং এরর আসলে বট বন্ধ হবে না)
bot.on('polling_error', (error) => {
    if (error.code === 'ETELEGRAM' && error.message.includes('409 Conflict')) {
        console.log("⚠️ Conflict detected. Retrying in 5 seconds...");
    } else {
        console.error("❌ Polling Error:", error.message);
    }
});

// --- MongoDB কানেকশন ও অটো-রিসেট ---
mongoose.connect(config.mongoUri).then(async () => {
    console.log("✅ Database Connected!");
    const VersionModel = mongoose.model('DBVersion', new mongoose.Schema({ version: String }));
    const currentVer = await VersionModel.findOne();
    if (!currentVer) {
        await new VersionModel({ version: config.dbVersion }).save();
    } else if (currentVer.version !== config.dbVersion) {
        const collections = await mongoose.connection.db.collections();
        for (let col of collections) await col.deleteMany({});
        await VersionModel.updateOne({}, { version: config.dbVersion });
        console.log("♻️ Database Reset Done.");
    }
});

// --- ডাটাবেস মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number, joinedAt: { type: Date, default: Date.now } }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String }));

let userState = {};

// --- হেল্পারস ---
async function isPremium(chatId) {
    if (chatId === config.adminId) return true;
    const user = await PremiumUser.findOne({ userId: chatId });
    if (!user) return false;
    if (new Date() > user.expiryDate) {
        await PremiumUser.deleteOne({ userId: chatId });
        return false;
    }
    return true;
}

function generateHTML(post, zoneId, clicks = 3) {
    let qBtns = post.links.map(i => `<button class="btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('');
    let chSection = (post.channels && post.channels.length > 0) ? 
        `<div class="ch-box"><h3>📢 জয়েন করুন:</h3>${post.channels.map(ch => `<a href="${ch.link}" target="_blank" class="ch-link">${ch.name}</a>`).join('')}</div>` : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}
    .card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}
    .ch-box{background:rgba(59,130,246,0.1);padding:10px;margin-bottom:15px;border-radius:10px;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:4px;border-radius:6px;font-weight:bold;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

// --- মেইন মেনু ---
async function showMainMenu(chatId) {
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ", callback_data: "setup_channels" }, { text: "🆔 জোন আইডি সেট", callback_data: "set_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === config.adminId) {
        buttons.push([{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "adm_add_prompt" }]);
    }
    bot.sendMessage(chatId, "🛠 **বট মেইন মেনু**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    showMainMenu(msg.chat.id);
});

// --- বাটন লজিক (বাটন ফিক্স করা হয়েছে) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const isPrem = await isPremium(chatId);

    if (["start_post", "setup_channels", "set_zone"].includes(data) && !isPrem) {
        return bot.answerCallbackQuery(q.id, { text: "❌ আগে প্রিমিয়াম মেম্বারশিপ নিন!", show_alert: true });
    }

    if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    }
    else if (data === "setup_channels") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let txt = "📢 আপনার চ্যানেলসমূহ:\n";
        if (!profile || !profile.savedChannels.length) txt += "নেই।";
        else profile.savedChannels.forEach((c, i) => txt += `${i+1}. ${c.name}\n`);
        bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_ch" }], [{ text: "🗑 মুছুন", callback_data: "clear_ch" }]] } });
    }
    else if (data === "clear_ch") {
        await UserProfile.findOneAndUpdate({ userId: chatId }, { savedChannels: [] });
        bot.sendMessage(chatId, "✅ সব চ্যানেল মুছে ফেলা হয়েছে।");
    }
    else if (data === "add_ch") { userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); }
    else if (data === "set_zone") { userState[chatId] = { step: 'u_zone' }; bot.sendMessage(chatId, "Adsterra Zone ID দিন:"); }
    else if (data === "adm_add_prompt" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_user' };
        bot.sendMessage(chatId, "👤 লিখুন: `ID | Days | Plan`", { parse_mode: 'Markdown' });
    }
    else if (data === "view_stats" && chatId === config.adminId) {
        const u = await User.countDocuments();
        const p = await PremiumUser.countDocuments();
        bot.sendMessage(chatId, `📊 ইউজার: ${u}\n💎 প্রিমিয়াম: ${p}`);
    }
    else if (data === "skip_q") {
        bot.sendMessage(chatId, "সব ঠিক থাকলে জেনারেট করুন:", { reply_markup: { inline_keyboard: [[{ text: "🚀 জেনারেট HTML", callback_data: "confirm" }]] } });
    }
    else if (data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const finalZone = (profile && profile.userZoneId) ? profile.userZoneId : '10341337';
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: profile ? profile.savedChannels : [], zoneId: finalZone }).save();
        bot.sendMessage(chatId, `✅ সফল!\n🔗 লিঙ্ক: ${config.appUrl}/post/${id}\n\nআপনার কোড জেনারেট হয়েছে।`, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        if (s.step === 'add_user' && chatId === config.adminId) {
            const p = text.split('|'); if (p.length < 3) return;
            const expiry = moment().add(parseInt(p[1].trim()), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0].trim()) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম অ্যাড হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'u_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি সেট।"); delete userState[chatId]; }
        else if (s.step === 'ch_name') { s.tempN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "লিঙ্ক দিন:"); }
        else if (s.step === 'ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল অ্যাড হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 ইমেজ লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা?"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "মুভি লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও কোয়ালিটি অথবা Skip দিন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip", callback_data: "skip_q" }]] } });
        }
    }
});

// --- সার্ভার রুটস ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("Not Found");
    res.send(generateHTML(post, post.zoneId));
});
app.get('/', (req, res) => res.send("Bot Online"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on ${PORT}`);
    if (config.appUrl) {
        cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(e => {}));
    }
});
