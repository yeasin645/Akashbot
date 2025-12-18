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

const bot = new TelegramBot(config.token, { polling: { autoStart: true, params: { timeout: 10 } } });

// Polling Error Fix
bot.on('polling_error', (err) => {
    if (err.message.includes('409')) console.log("⚠️ Conflict! Bot is running elsewhere.");
});

// --- MongoDB Connection ---
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
        console.log("♻️ Database Reset Success.");
    }
});

// --- Schemas ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String }));
const BotSetting = mongoose.model('BotSetting', new mongoose.Schema({ key: String, value: String }));

let userState = {};

// --- Helper: Premium Check ---
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

// --- Menu Generator ---
function getMainMenu(chatId) {
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ 🔒", callback_data: "setup_channels" }, { text: "🆔 জোন আইডি সেট 🔒", callback_data: "set_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }, { text: "❓ সাহায্য/ফিচার", callback_data: "help_menu" }]
    ];
    if (chatId === config.adminId) {
        buttons.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "adm_add_prompt" }],
            [{ text: "🗑 মেম্বার ডিলিট", callback_data: "adm_del_prompt" }],
            [{ text: "📝 প্রিমিয়াম লিস্ট ইডিট", callback_data: "edit_premium_list" }],
            [{ text: "📢 ব্রডকাস্ট মেসেজ", callback_data: "broadcast_msg" }]
        );
    }
    return { inline_keyboard: buttons };
}

// --- Start Command ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    bot.sendMessage(msg.chat.id, "👋 **মুভি মেকার বোট মেনু**\n\nসব ফিচার ব্যবহার করতে প্রিমিয়াম মেম্বারশিপ প্রয়োজন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenu(msg.chat.id) 
    });
});

// --- Callback Query Handler ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const isPrem = await isPremium(chatId);

    // Lock Check
    const locked = ["start_post", "setup_channels", "set_zone", "add_ch", "clear_ch"];
    if (locked.includes(data) && !isPrem) {
        return bot.answerCallbackQuery(q.id, { text: "⚠️ এই ফিচারটি শুধুমাত্র প্রিমিয়াম মেম্বারদের জন্য!", show_alert: true });
    }

    if (data === "help_menu") {
        const helpText = `🌟 **বোটের বিশেষ সুবিধাসমূহ:**\n\n` +
            `1️⃣ **পেশাদার পোস্ট:** সুন্দর ইমেজ ও একাধিক কোয়ালিটি সহ মুভি ডাউনলোড পেজ।\n` +
            `2️⃣ **নিজস্ব ইনকাম:** Adsterra Zone ID সেট করে প্রতি ক্লিকে আয় করুন।\n` +
            `3️⃣ **চ্যানেল প্রমোশন:** আপনার পোস্টের নিচে নিজের টেলিগ্রাম চ্যানেলের বাটন সেট করুন।\n` +
            `4️⃣ **অ্যাড লজিক:** ৩টি অ্যাড দেখার পর ইউজার মূল লিঙ্ক পাবে, যা আপনার ইনকাম নিশ্চিত করবে।\n` +
            `5️⃣ **প্রিমিয়াম লক:** অননুমোদিত ইউজার থেকে বোট সুরক্ষিত।\n\n` +
            `💎 প্রিমিয়াম নিতে 'প্রিমিয়াম প্ল্যান' বাটনে ক্লিক করুন।`;
        bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }
    else if (data === "view_premium") {
        const s = await BotSetting.findOne({ key: "premium_list" });
        bot.sendMessage(chatId, `💎 **আমাদের প্রিমিয়াম প্ল্যানসমূহ:**\n\n${s ? s.value : "এখনো কোনো প্ল্যান সেট করা হয়নি।"}\n\nযোগাযোগ: @${config.adminUsername}`);
    }
    else if (data === "adm_add_prompt" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_user' };
        bot.sendMessage(chatId, "👤 প্রিমিয়াম দিতে লিখুন: `ID | Days | Plan`", { parse_mode: 'Markdown' });
    }
    else if (data === "adm_del_prompt" && chatId === config.adminId) {
        userState[chatId] = { step: 'del_user' };
        bot.sendMessage(chatId, "🗑 যার প্রিমিয়াম বাতিল করবেন তার ID দিন:");
    }
    else if (data === "edit_premium_list" && chatId === config.adminId) {
        userState[chatId] = { step: 'edit_prem' };
        bot.sendMessage(chatId, "📝 নতুন প্রিমিয়াম লিস্ট লিখে পাঠান:");
    }
    else if (data === "broadcast_msg" && chatId === config.adminId) {
        userState[chatId] = { step: 'broadcast' };
        bot.sendMessage(chatId, "📢 আপনার ব্রডকাস্ট মেসেজটি লিখুন:");
    }
    else if (data === "view_stats" && chatId === config.adminId) {
        const u = await User.countDocuments();
        const p = await PremiumUser.countDocuments();
        bot.sendMessage(chatId, `📊 মোট ইউজার: ${u}\n💎 প্রিমিয়াম মেম্বার: ${p}`);
    }
    else if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    }
    else if (data === "setup_channels") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let txt = "📢 আপনার সেভ করা চ্যানেল:\n";
        if (!profile || !profile.savedChannels.length) txt += "নেই।";
        else profile.savedChannels.forEach((c, i) => txt += `${i+1}. ${c.name}\n`);
        bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: "➕ চ্যানেল যোগ", callback_data: "add_ch" }], [{ text: "🗑 সব মুছুন", callback_data: "clear_ch" }]] } });
    }
    else if (data === "set_zone") { userState[chatId] = { step: 'u_zone' }; bot.sendMessage(chatId, "🆔 আপনার Adsterra Zone ID দিন:"); }
    else if (data === "add_ch") { userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); }
    else if (data === "clear_ch") { await UserProfile.findOneAndUpdate({ userId: chatId }, { savedChannels: [] }); bot.sendMessage(chatId, "✅ সব চ্যানেল মুছে ফেলা হয়েছে।"); }
    else if (data === "skip_q") {
        bot.sendMessage(chatId, "জেনারেট করতে নিচে ক্লিক করুন:", { reply_markup: { inline_keyboard: [[{ text: "🚀 জেনারেট HTML লিঙ্ক", callback_data: "confirm" }]] } });
    }
    else if (data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const finalZone = (profile && profile.userZoneId) ? profile.userZoneId : '10341337';
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: profile ? profile.savedChannels : [], zoneId: finalZone }).save();
        bot.sendMessage(chatId, `✅ সফল!\n🔗 মুভি লিঙ্ক: ${config.appUrl}/post/${id}`);
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- Message Handler ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        if (s.step === 'broadcast' && chatId === config.adminId) {
            const users = await User.find();
            bot.sendMessage(chatId, `🚀 ${users.length} জনকে পাঠানো হচ্ছে...`);
            for (let u of users) { try { await bot.sendMessage(u.userId, text); } catch(e){} }
            bot.sendMessage(chatId, "✅ সম্পন্ন।"); delete userState[chatId];
        }
        else if (s.step === 'add_user' && chatId === config.adminId) {
            const p = text.split('|'); if (p.length < 3) return;
            const expiry = moment().add(parseInt(p[1].trim()), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0].trim()) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম অ্যাক্টিভেট হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'del_user' && chatId === config.adminId) {
            await PremiumUser.deleteOne({ userId: parseInt(text.trim()) });
            bot.sendMessage(chatId, "🗑 প্রিমিয়াম বাতিল করা হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'edit_prem') {
            await BotSetting.findOneAndUpdate({ key: "premium_list" }, { value: text }, { upsert: true });
            bot.sendMessage(chatId, "✅ লিস্ট আপডেট হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'u_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি সেভ হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'ch_name') { s.tempN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক দিন:"); }
        else if (s.step === 'ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 মুভি পোস্টার লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা?"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও কোয়ালিটি দেবেন? না দিলে Skip দিন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip", callback_data: "skip_q" }]] } });
        }
    }
});

// --- Server & Post View ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("Link Expired or Invalid");
    let qBtns = post.links.map(i => `<button class="btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('');
    let chSection = (post.channels && post.channels.length > 0) ? 
        `<div class="ch-box"><h3>📢 জয়েন করুন:</h3>${post.channels.map(ch => `<a href="${ch.link}" target="_blank" class="ch-link">${ch.name}</a>`).join('')}</div>` : "";

    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src='//libtl.com/sdk.js' data-zone='${post.zoneId}' data-sdk='show_${post.zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;}
    .card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;width:100%;}img{width:100%;border-radius:10px;margin-bottom:15px;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:4px;border-radius:6px;font-size:14px;font-weight:bold;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2>${chSection}<div id="st">৩টি অ্যাড দেখলে লিঙ্ক পাবেন</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<3){if(typeof window['show_'+'${post.zoneId}'] === 'function'){window['show_'+'${post.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/3";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot is Running..."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bot on ${PORT}`);
    if (config.appUrl) cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(e => {}));
});
