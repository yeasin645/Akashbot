const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন ---
const config = {
    token: process.env.BOT_TOKEN, 
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID), 
    appUrl: process.env.APP_URL, 
    adminUsername: process.env.ADMIN_USERNAME || "Admin",
    dbVersion: process.env.DB_VERSION || "1.1"
};

const bot = new TelegramBot(config.token, { polling: { autoStart: true, params: { timeout: 10 } } });

// --- ২. ডাটাবেস কানেকশন ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ Database Connected!"));

// --- ৩. ডাটা মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String }));
const BotSetting = mongoose.model('BotSetting', new mongoose.Schema({ key: String, value: String }));

let userState = {};

// --- ৪. প্রিমিয়াম চেকার ---
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

// --- ৫. মেনু জেনারেটর ---
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
            [{ text: "📢 ব্রডকাস্ট", callback_data: "broadcast_msg" }]
        );
    }
    return { inline_keyboard: buttons };
}

// --- ৬. কমান্ডস ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    bot.sendMessage(chatId, "👋 **মুভি মেকার বোট কন্ট্রোল প্যানেল**\n\nসব সুবিধা উপভোগ করতে প্রিমিয়াম মেম্বারশিপ নিন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenu(chatId) 
    });
});

// --- ৭. বাটন হ্যান্ডলার (Callbacks) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const isPrem = await isPremium(chatId);

    // Lock System
    const locked = ["start_post", "setup_channels", "set_zone", "add_ch"];
    if (locked.includes(data) && !isPrem) {
        return bot.answerCallbackQuery(q.id, { text: "⚠️ এটি ব্যবহারের জন্য আগে প্রিমিয়াম নিন!", show_alert: true });
    }

    if (data === "help_menu") {
        const helpText = `🌟 **বোটের বিশেষ সুবিধাসমূহ:**\n\n` +
            `✅ **মুভি পোস্ট:** প্রফেশনাল HTML পেজ জেনারেটর।\n` +
            `✅ **ইনকাম:** আপনার Adsterra Zone ID থেকে সরাসরি ডলার আয়।\n` +
            `✅ **চ্যানেল প্রমোশন:** মুভি পেজে নিজের চ্যানেল অটো প্রমোট।\n` +
            `✅ **অ্যাড লজিক:** ৩টি অ্যাড ভিউর পর ইউজার ডাউনলোড লিঙ্ক পাবে।\n` +
            `✅ **সুরক্ষা:** অননুমোদিত ইউজার বোট চালাতে পারবে না।`;
        bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }
    else if (data === "adm_del_prompt") {
        userState[chatId] = { step: 'del_user' };
        bot.sendMessage(chatId, "🗑 যার প্রিমিয়াম ডিলিট করবেন তার **User ID** দিন:");
    }
    else if (data === "adm_add_prompt") {
        userState[chatId] = { step: 'add_user' };
        bot.sendMessage(chatId, "➕ প্রিমিয়াম দিন: `ID | Days | Plan`", { parse_mode: 'Markdown' });
    }
    else if (data === "view_stats") {
        const u = await User.countDocuments();
        const p = await PremiumUser.countDocuments();
        bot.sendMessage(chatId, `📊 ইউজার: ${u}\n💎 প্রিমিয়াম: ${p}`);
    }
    else if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    }
    else if (data === "setup_channels") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let txt = "📢 আপনার চ্যানেলসমূহ:\n";
        if (!profile || !profile.savedChannels.length) txt += "নেই।";
        else profile.savedChannels.forEach((c, i) => txt += `${i+1}. ${c.name}\n`);
        bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_ch" }], [{ text: "🗑 মুছুন", callback_data: "clear_ch" }]] } });
    }
    else if (data === "set_zone") { userState[chatId] = { step: 'u_zone' }; bot.sendMessage(chatId, "🆔 Adsterra Zone ID দিন:"); }
    else if (data === "add_ch") { userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); }
    else if (data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const finalZone = (profile && profile.userZoneId) ? profile.userZoneId : '10341337';
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: profile ? profile.savedChannels : [], zoneId: finalZone }).save();
        bot.sendMessage(chatId, `✅ সফল!\n🔗 লিঙ্ক: ${config.appUrl}/post/${id}`);
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৮. ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        if (s.step === 'del_user') {
            const res = await PremiumUser.deleteOne({ userId: parseInt(text.trim()) });
            bot.sendMessage(chatId, res.deletedCount > 0 ? "✅ মেম্বার ডিলিট হয়েছে।" : "❌ আইডি পাওয়া যায়নি।");
            delete userState[chatId];
        }
        else if (s.step === 'add_user') {
            const p = text.split('|'); if (p.length < 3) return;
            const expiry = moment().add(parseInt(p[1].trim()), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0].trim()) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ মেম্বার অ্যাড হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'u_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি সেভড।"); delete userState[chatId]; }
        else if (s.step === 'ch_name') { s.tempN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "লিঙ্ক দিন:"); }
        else if (s.step === 'ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভড।"); delete userState[chatId]; }
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 ইমেজ লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা?"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও লিঙ্ক? না দিলে 'Skip' দিন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip/Confirm", callback_data: "confirm" }]] } });
        }
    }
});

// --- ৯. HTML রেন্ডার পেজ (Fix) ---

app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).send("Link Expired.");
    
    let qBtns = post.links.map(i => `<button class="btn" onclick="startAd('${i.link}')">${i.quality} - ডাউনলোড</button>`).join('');
    let chLinks = post.channels.map(c => `<a href="${c.link}" class="ch-link">${c.name}</a>`).join('');

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${post.title}</title>
    <script src='//libtl.com/sdk.js' data-zone='${post.zoneId}' data-sdk='show_${post.zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;font-size:14px;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2><div>${chLinks}</div><hr><div id="st">৩টি অ্যাড দেখলে লিঙ্ক পাবেন।</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<3){if(typeof window['show_'+'${post.zoneId}'] === 'function'){window['show_'+'${post.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/3";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot Active!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on ${PORT}`);
    if (config.appUrl) cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(e => {}));
});
