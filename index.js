const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (পরিবেশ ভেরিয়েবল ব্যবহার করুন) ---
const config = {
    token: process.env.BOT_TOKEN, 
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID), 
    appUrl: process.env.APP_URL, // Render URL (উদা: https://bot-name.onrender.com)
    adminUsername: process.env.ADMIN_USERNAME || "Admin",
    dbVersion: "1.3" // এটি পরিবর্তন করলেই ডাটাবেস কালেকশন রিসেট হয়ে সব তথ্য ডিলিট হবে
};

const bot = new TelegramBot(config.token, { polling: { autoStart: true } });

// --- ২. ডাটাবেস ও অটো-রিসেট (কালেকশন রিসেট লজিক) ---
mongoose.connect(config.mongoUri).then(async () => {
    console.log("✅ Database Connected!");
    
    const VersionModel = mongoose.model('DBVersion', new mongoose.Schema({ version: String }));
    const currentVer = await VersionModel.findOne();
    
    if (!currentVer) {
        await new VersionModel({ version: config.dbVersion }).save();
    } else if (currentVer.version !== config.dbVersion) {
        // সংস্করণ পরিবর্তন হলে ডাটাবেস ক্লিন হবে
        const collections = await mongoose.connection.db.collections();
        for (let col of collections) {
            await col.deleteMany({});
            console.log(`🗑 Collection Reset: ${col.collectionName}`);
        }
        await VersionModel.updateOne({}, { version: config.dbVersion });
        console.log("♻️ Database Fully Reset Successfully.");
    }
});

// --- ৩. ডাটা মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String }));
const BotSetting = mongoose.model('BotSetting', new mongoose.Schema({ key: String, value: String }));

let userState = {};

// --- ৪. প্রিমিয়াম মেম্বারশিপ চেকার ---
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

// --- ৫. মেইন মেনু জেনারেটর ---
function getMainMenu(chatId) {
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট ও কোড তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ 🔒", callback_data: "setup_channels" }, { text: "🆔 জোন আইডি সেট 🔒", callback_data: "set_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }, { text: "❓ সাহায্য/ফিচার", callback_data: "help_menu" }]
    ];
    
    if (chatId === config.adminId) {
        buttons.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "adm_add_prompt" }],
            [{ text: "🗑 মেম্বার ডিলিট", callback_data: "adm_del_prompt" }],
            [{ text: "📝 প্রিমিয়াম লিস্ট এডিট", callback_data: "edit_premium_list" }],
            [{ text: "📢 ব্রডকাস্ট", callback_data: "broadcast_msg" }]
        );
    }
    return { inline_keyboard: buttons };
}

// --- ৬. কমান্ডস ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    bot.sendMessage(chatId, "👋 **মুভি HTML ও প্রিভিউ মেকার**\n\nস্বাগতম! মুভি পোস্ট তৈরি করতে নিচের বাটন ব্যবহার করুন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMainMenu(chatId) 
    });
});

// --- ৭. বাটন অ্যাকশন (Callbacks) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const isPrem = await isPremium(chatId);

    // Lock System
    const locked = ["start_post", "setup_channels", "set_zone", "add_ch", "clear_ch"];
    if (locked.includes(data) && !isPrem) {
        return bot.answerCallbackQuery(q.id, { text: "⚠️ এটি ব্যবহারের জন্য প্রিমিয়াম মেম্বারশিপ প্রয়োজন!", show_alert: true });
    }

    if (data === "help_menu") {
        const helpText = `🌟 **বোটের বিশেষ সুবিধাসমূহ:**\n\n` +
            `✅ **HTML Preview:** কোড তৈরির পর ব্রাউজারে দেখার লিঙ্ক।\n` +
            `✅ **Code Generator:** সরাসরি কপি করার উপযোগী HTML কোড।\n` +
            `✅ **Adsterra Income:** নিজের Zone ID ব্যবহার করে আয় করার সুযোগ।\n` +
            `✅ **Auto Promotion:** আপনার চ্যানেলের জয়েন লিঙ্ক পেজে যুক্ত হবে।\n` +
            `✅ **Delete Member:** এডমিন সহজেই মেম্বার প্রিমিয়াম থেকে বাদ দিতে পারে।`;
        bot.sendMessage(chatId, helpText, { parse_mode: 'Markdown' });
    }
    else if (data === "adm_del_prompt" && chatId === config.adminId) {
        userState[chatId] = { step: 'del_user' };
        bot.sendMessage(chatId, "🗑 যার প্রিমিয়াম ডিলিট করবেন তার **User ID** দিন:");
    }
    else if (data === "adm_add_prompt" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_user' };
        bot.sendMessage(chatId, "➕ প্রিমিয়াম দিন: `ID | Days | Plan`", { parse_mode: 'Markdown' });
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
        // --- ফাইনাল রেজাল্ট জেনারেশন ---
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const zoneId = (profile && profile.userZoneId) ? profile.userZoneId : '10341337';
        const id = Math.random().toString(36).substring(7);

        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: profile ? profile.savedChannels : [], zoneId }).save();

        const previewLink = `${config.appUrl}/post/${id}`;
        const qBtns = s.links.map(i => `<button class="btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('\n');
        const chLinks = (profile ? profile.savedChannels : []).map(c => `<a href="${c.link}" class="ch-link">${c.name}</a>`).join('\n');

        const htmlText = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;}</style></head><body><div class="card"><img src="${s.image}"><h2>${s.title}</h2><div>${chLinks}</div><hr><div id="st">৩টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<3){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/3";});}else{c++;}}else{location.href=u;}}</script></body></html>`;

        bot.sendMessage(chatId, `✅ **তৈরি হয়েছে!**\n\n🌐 **প্রিভিউ লিঙ্ক:** ${previewLink}\n\n📄 **কোড কপি করুন:**`, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId, `\`\`\`html\n${htmlText}\n\`\`\``, { parse_mode: 'Markdown' });
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
            const exp = moment().add(parseInt(p[1].trim()), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0].trim()) }, { packageName: p[2].trim(), expiryDate: exp }, { upsert: true });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম অ্যাড হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'u_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি সেভড।"); delete userState[chatId]; }
        else if (s.step === 'ch_name') { s.tempN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক দিন:"); }
        else if (s.step === 'ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ সেভ হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 মুভি পোস্টার লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা?"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও কোয়ালিটি যোগ করবেন? না হলে 'Confirm' দিন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm & Get Code", callback_data: "confirm" }]] } });
        }
    }
});

// --- ৯. ওয়েব সার্ভার (Preview Function) ---

app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.status(404).send("Link Expired.");
    
    let qBtns = post.links.map(i => `<button class="btn" onclick="startAd('${i.link}')">${i.quality} - ডাউনলোড</button>`).join('');
    let chLinks = post.channels.map(c => `<a href="${c.link}" target="_blank" class="ch-link">${c.name}</a>`).join('');

    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${post.title}</title>
    <script src='//libtl.com/sdk.js' data-zone='${post.zoneId}' data-sdk='show_${post.zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;font-size:14px;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2><div>${chLinks}</div><hr><div id="st">৩টি অ্যাড দেখলে লিঙ্ক পাবেন।</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<3){if(typeof window['show_'+'${post.zoneId}'] === 'function'){window['show_'+'${post.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/3";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot Server is Active!"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server started on ${PORT}`);
    if (config.appUrl) cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(() => {}));
});
