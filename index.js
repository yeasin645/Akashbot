require('dotenv').config(); // পরিবেশ ভেরিয়েবল লোড করার জন্য
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();

// --- Configuration (সবকিছু .env ফাইল বা সার্ভার সেটিংস থেকে আসবে) ---
const token = process.env.BOT_TOKEN;
const mongoUri = process.env.MONGODB_URI;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const myAppUrl = process.env.APP_URL; 
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "Admin";

// বোট পোলিং সেটআপ
const bot = new TelegramBot(token, { polling: true });

// --- MongoDB Connection ---
mongoose.connect(mongoUri).then(() => console.log("✅ MongoDB Connected Successfully!"));

// --- Database Models ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number, joinedAt: { type: Date, default: Date.now } }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String }));

let userState = {};

// --- Helper Functions ---
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

function generateHTML(post, zoneId, clicks = 3) {
    let qBtns = post.links.map(i => `<button class="btn q-btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('');
    let chSection = (post.channels && post.channels.length > 0) ? 
        `<div class="channel-box"><h3>📢 জয়েন করুন:</h3>${post.channels.map(ch => `<a href="${ch.link}" target="_blank" class="ch-link">${ch.name}</a>`).join('')}</div>` : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}
    .card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;box-shadow:0 10px 25px rgba(0,0,0,0.5);}img{width:100%;border-radius:10px;margin-bottom:15px;}
    .channel-box{background:rgba(59,130,246,0.1);padding:10px;margin-bottom:15px;border-radius:10px;border:1px dashed #3b82f6;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:4px;border-radius:6px;font-size:14px;font-weight:bold;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}
    .q-btn{background:#334155;border:1px solid #475569;}#st{color:#fbbf24;margin-bottom:10px;font-weight:bold;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

// --- Main Menu Interface ---
async function showMainMenu(chatId) {
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ", callback_data: "setup_channels_menu" }, { text: "🆔 জোন আইডি সেট", callback_data: "set_user_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === ADMIN_ID) {
        buttons.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "add_user_prompt" }],
            [{ text: "🗑 মেম্বার রিমুভ", callback_data: "del_user_prompt" }]
        );
    }
    bot.sendMessage(chatId, "🛠 **মেইন কন্ট্রোল প্যানেল**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

// --- Command Handling ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    showMainMenu(msg.chat.id);
});

// --- Button Interaction Handling ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const premium = await isPremium(chatId);

    // Restricted Access Logic
    const premiumOnly = ["start_post", "setup_channels_menu", "set_user_zone", "add_new_ch"];
    if (premiumOnly.includes(data) && !premium) {
        return bot.answerCallbackQuery(q.id, { text: "❌ দুঃখিত! এই ফিচারটি ব্যবহারের জন্য আপনাকে প্রিমিয়াম মেম্বার হতে হবে।", show_alert: true });
    }

    if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    } 
    else if (data === "setup_channels_menu") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let txt = "📢 আপনার চ্যানেলসমূহ:\n";
        if (!profile || profile.savedChannels.length === 0) txt += "নেই।";
        else profile.savedChannels.forEach((c, i) => txt += `${i+1}. ${c.name}\n`);
        bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_new_ch" }], [{ text: "🗑 ক্লিয়ার করুন", callback_data: "clear_ch" }]] } });
    }
    else if (data === "clear_ch") {
        await UserProfile.findOneAndUpdate({ userId: chatId }, { savedChannels: [] });
        bot.sendMessage(chatId, "✅ সব চ্যানেল মুছে ফেলা হয়েছে।");
    }
    else if (data === "add_new_ch") { userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); }
    else if (data === "set_user_zone") { userState[chatId] = { step: 'u_zone' }; bot.sendMessage(chatId, "আপনার Adsterra Zone ID দিন:"); }
    else if (data === "view_stats" && chatId === ADMIN_ID) {
        const totalU = await User.countDocuments();
        const premU = await PremiumUser.countDocuments();
        bot.sendMessage(chatId, `📊 **পরিসংখ্যান:**\n\n👥 মোট ইউজার: ${totalU}\n💎 প্রিমিয়াম মেম্বার: ${premU}`);
    }
    else if (data === "add_user_prompt" && chatId === ADMIN_ID) {
        userState[chatId] = { step: 'adm_add' };
        bot.sendMessage(chatId, "👤 মেম্বার অ্যাড করতে দিন: `ID | Days | Package`", { parse_mode: 'Markdown' });
    }
    else if (data === "del_user_prompt" && chatId === ADMIN_ID) {
        userState[chatId] = { step: 'adm_del' };
        bot.sendMessage(chatId, "🗑 রিমুভ করতে ইউজারের ID পাঠান:");
    }
    else if (data === "view_premium") {
        bot.sendMessage(chatId, `💎 **প্রিমিয়াম সুবিধা:**\n\n✅ মুভি পোস্ট তৈরি\n✅ নিজস্ব জোন আইডি সেট\n✅ আনলিমিটেড চ্যানেল অ্যাড\n\nযোগাযোগ: @${ADMIN_USERNAME}`);
    }
    else if (data === "skip_q") {
        bot.sendMessage(chatId, "সব ঠিক থাকলে নিচের বাটনে ক্লিক করুন:", { reply_markup: { inline_keyboard: [[{ text: "🚀 জেনারেট HTML", callback_data: "confirm_post" }]] } });
    }
    else if (data === "confirm_post" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const finalZone = (profile && profile.userZoneId) ? profile.userZoneId : '10341337';
        const id = Math.random().toString(36).substring(7);
        const userChannels = profile ? profile.savedChannels : [];

        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: userChannels, zoneId: finalZone }).save();
        const htmlCode = generateHTML({ ...s, channels: userChannels }, finalZone);
        await bot.sendMessage(chatId, `✅ সফল!\n🔗 লিঙ্ক: ${myAppUrl}/post/${id}\n\n\`\`\`html\n${htmlCode}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- Input Message Handling ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        // এডমিন প্রসেস
        if (s.step === 'adm_add' && chatId === ADMIN_ID) {
            const p = text.split('|'); if (p.length < 3) return;
            const expiry = moment().add(parseInt(p[1].trim()), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0].trim()) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ ইউজারকে প্রিমিয়াম মেম্বার করা হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'adm_del' && chatId === ADMIN_ID) {
            await PremiumUser.deleteOne({ userId: parseInt(text.trim()) });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম মেম্বারশিপ বাতিল করা হয়েছে।"); delete userState[chatId];
        }
        // ইউজার প্রসেস
        else if (s.step === 'u_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি সেট হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'ch_name') { s.tempN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক দিন:"); }
        else if (s.step === 'ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।"); delete userState[chatId]; }
        // মুভি ক্রিয়েশন স্টেপস
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা কি?"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও কোয়ালিটি দিন বা Skip বাটনে চাপুন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip", callback_data: "skip_q" }]] } });
        }
    }
});

// --- Server & Anti-Sleep Logic ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("Not Found");
    res.send(generateHTML(post, post.zoneId));
});

app.get('/', (req, res) => res.send("Bot is Active!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Bot is running on port ${PORT}`);
    // বোট সচল রাখার জন্য ৫ মিনিট পর পর সেলফ-পিং
    if (myAppUrl) {
        cron.schedule('*/5 * * * *', async () => {
            try { await axios.get(myAppUrl); console.log('✅ Self-ping successful.'); } catch (e) { console.log('❌ Ping failed.'); }
        });
    }
});
