const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (Config Vars) ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID), // আপনার আইডি
    adminUser: process.env.ADMIN_USERNAME || "AdminUsername", // @ ছাড়া ইউজারনেম
    appUrl: process.env.APP_URL 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেলসমূহ ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected"));

const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Plan = mongoose.model('Plan', new mongoose.Schema({ name: String, price: String, days: Number }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ 
    userId: { type: Number, unique: true }, 
    zoneId: { type: String, default: '10341337' }, 
    adCount: { type: Number, default: 3 }, 
    channels: { type: Array, default: [] } 
}));
const Post = mongoose.model('Post', new mongoose.Schema({ 
    id: String, creatorId: Number, title: String, image: String, links: Array, 
    zoneId: String, adLimit: Number, channels: Array 
}));

let userState = {};

// প্রিমিয়াম চেক ফাংশন
async function isPremium(id) {
    if (id === config.adminId) return true;
    const p = await Premium.findOne({ userId: id });
    if (!p) return false;
    if (new Date() > p.expiry) { 
        await Premium.deleteOne({ userId: id }); 
        return false; 
    }
    return true;
}

// মেইন মেনু জেনারেটর
async function getMainMenu(chatId) {
    const isP = await isPremium(chatId);
    const isAdmin = (chatId === config.adminId);
    let btns = [];

    if (isP) {
        btns.push([{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }]);
        btns.push([{ text: "🆔 জোন আইডি", callback_data: "set_zone" }, { text: "🔢 অ্যাড লিমিট", callback_data: "set_limit" }]);
        btns.push([{ text: "📢 চ্যানেল সেটিংস", callback_data: "setup_ch" }]);
    } else {
        btns.push([{ text: "🔒 মুভি পোস্ট তৈরি (Premium Only)", callback_data: "buy_premium" }]);
    }
    
    btns.push([{ text: "💎 প্রিমিয়াম প্ল্যানসমূহ", callback_data: "view_plans" }]);
    btns.push([{ text: "👨‍💻 কন্টাক্ট অ্যাডমিন", url: `https://t.me/${config.adminUser}` }]);

    if (isAdmin) {
        btns.push([{ text: "🛠 অ্যাডমিন প্যানেল", callback_data: "admin_dashboard" }]);
    }

    return { inline_keyboard: btns };
}

// --- ৩. কমান্ড ও কলব্যাক হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    
    bot.sendMessage(chatId, `👋 স্বাগতম **${msg.from.first_name}**!\nমুভি পোস্ট তৈরি করতে প্রিমিয়াম সাবস্ক্রিপশন নিন।`, {
        reply_markup: await getMainMenu(chatId)
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isAdmin = (chatId === config.adminId);

    switch (q.data) {
        case "view_plans":
            const plans = await Plan.find();
            let pTxt = "💎 **আমাদের প্রিমিয়াম প্ল্যানসমূহ:**\n\n";
            if (plans.length === 0) pTxt += "আপাতত কোনো প্ল্যান নেই। অ্যাডমিনের সাথে যোগাযোগ করুন।";
            else {
                plans.forEach(p => pTxt += `✅ **${p.name}**\n💰 মূল্য: ${p.price}\n⏳ মেয়াদ: ${p.days} দিন\n\n`);
            }
            bot.sendMessage(chatId, pTxt, { 
                reply_markup: { inline_keyboard: [[{ text: "💬 এখন কিনুন", url: `https://t.me/${config.adminUser}` }]] } 
            });
            break;

        case "admin_dashboard":
            if (!isAdmin) return;
            bot.sendMessage(chatId, "🛠 **অ্যাডমিন প্যানেল**", {
                reply_markup: { inline_keyboard: [
                    [{ text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }],
                    [{ text: "📝 নতুন প্ল্যান তৈরি", callback_data: "create_plan" }],
                    [{ text: "📊 পরিসংখ্যান", callback_data: "stats" }]
                ]}
            });
            break;

        case "add_p": userState[chatId] = { step: 'add_p_id' }; bot.sendMessage(chatId, "ইউজার আইডি দিন:"); break;
        case "create_plan": userState[chatId] = { step: 'plan_name' }; bot.sendMessage(chatId, "প্ল্যানের নাম:"); break;
        case "start_post":
            if (!(await isPremium(chatId))) return bot.answerCallbackQuery(q.id, { text: "আগে প্রিমিয়াম কিনুন!", show_alert: true });
            userState[chatId] = { step: 'title', links: [] };
            bot.sendMessage(chatId, "🎬 মুভির নাম:");
            break;
        case "set_zone": userState[chatId] = { step: 'zone' }; bot.sendMessage(chatId, "Monetag Zone ID দিন:"); break;
        case "set_limit": userState[chatId] = { step: 'limit' }; bot.sendMessage(chatId, "অ্যাড লিমিট দিন:"); break;
        case "confirm_save":
            const s = userState[chatId];
            const pf = await Profile.findOne({ userId: chatId });
            const pid = Math.random().toString(36).substring(7);
            await new Post({ id: pid, title: s.title, image: s.image, links: s.links, zoneId: pf.zoneId, adLimit: pf.adCount, channels: pf.channels }).save();
            const postUrl = `${config.appUrl}/post/${pid}`;
            const htmlCode = `<b>🎬 ${s.title}</b>\n\n📥 <a href="${postUrl}">Download Now</a>`;
            bot.sendMessage(chatId, `✅ সফল!\n\n🔗 লিঙ্ক: ${postUrl}\n\n📝 কপি কোড:\n<code>${htmlCode}</code>`, { parse_mode: 'HTML' });
            delete userState[chatId];
            break;
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. ইনপুট প্রসেসিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'add_p_id') { s.targetId = text; s.step = 'add_p_days'; bot.sendMessage(chatId, "কত দিন (সংখ্যা)?"); }
    else if (s.step === 'add_p_days') {
        const exp = moment().add(parseInt(text), 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.targetId) }, { expiry: exp }, { upsert: true });
        bot.sendMessage(chatId, "✅ প্রিমিয়াম সফলভাবে যুক্ত হয়েছে।"); delete userState[chatId];
    }
    else if (s.step === 'plan_name') { s.pN = text; s.step = 'plan_price'; bot.sendMessage(chatId, "দাম:"); }
    else if (s.step === 'plan_price') { s.pP = text; s.step = 'plan_days'; bot.sendMessage(chatId, "কত দিনের প্ল্যান?"); }
    else if (s.step === 'plan_days') {
        await new Plan({ name: s.pN, price: s.pP, days: parseInt(text) }).save();
        bot.sendMessage(chatId, "✅ প্ল্যান সেভ হয়েছে।"); delete userState[chatId];
    }
    else if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() });
        bot.sendMessage(chatId, "✅ জোন আইডি আপডেট হয়েছে।"); delete userState[chatId];
    }
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
    else if (s.step === 'q') { s.tmpQ = text; s.step = 'link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
    else if (s.step === 'link') {
        s.links.push({ q: s.tmpQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক? না হলে নিচের বাটনে চাপুন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 পোস্ট তৈরি করুন", callback_data: "confirm_save" }]] } });
        s.step = 'q';
    }
});

// --- ৫. ল্যান্ডিং পেজ (অ্যাড সিস্টেম) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Not Found");

    res.send(`
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script>
        <style>
            body { background:#000; color:#fff; text-align:center; font-family:sans-serif; padding:15px; }
            .card { background:#111; padding:20px; border-radius:15px; border:1px solid #333; max-width:500px; margin:auto; }
            img { width:100%; border-radius:10px; }
            .btn { display:block; background:#e50914; color:#fff; padding:15px; margin:10px 0; text-decoration:none; border-radius:8px; font-weight:bold; cursor:pointer; }
            .status { color:#ff9800; font-weight:bold; }
            .hidden { display:none; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>${p.title}</h2>
            <img src="${p.image}">
            <p class="status">Ads Completed: <span id="count">0</span> / ${p.adLimit}</p>
            <div id="unlock-area">
                ${p.links.map((l, i) => `
                    <button class="btn unlock-btn" onclick="runAd('${l.link}', ${i})">🔓 Unlock ${l.q}</button>
                    <a href="${l.link}" class="btn hidden dl-link" id="dl-${i}">📥 Download ${l.q}</a>
                `).join('')}
            </div>
        </div>
        <script>
            let clicks = 0;
            const target = ${p.adLimit};
            function runAd(url, id) {
                if (typeof show_${p.zoneId} === 'function') { show_${p.zoneId}(); }
                clicks++;
                document.getElementById('count').innerText = clicks;
                if (clicks >= target) {
                    document.querySelectorAll('.unlock-btn').forEach(b => b.classList.add('hidden'));
                    document.querySelectorAll('.dl-link').forEach(l => l.classList.remove('hidden'));
                }
            }
        </script>
    </body>
    </html>`);
});

app.listen(process.env.PORT || 3000);
