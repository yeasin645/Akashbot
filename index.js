const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন চেক ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID) || 0,
    adminUser: process.env.ADMIN_USERNAME || "Admin",
    appUrl: process.env.APP_URL || ""
};

// টোকেন ছাড়া বট রান হবে না
if (!config.token) {
    console.error("❌ BOT_TOKEN missing in Environment Variables!");
    process.exit(1);
}

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেল ---
mongoose.connect(config.mongoUri)
    .then(() => console.log("✅ Database Connected Successfully"))
    .catch(err => console.error("❌ DB Connection Error:", err));

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
    id: String, title: String, image: String, links: Array, 
    zoneId: String, adLimit: Number, channels: Array 
}));

let userState = {};

// প্রিমিয়াম চেক
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
        btns.push([{ text: "🔓 আনলক প্রিমিয়াম", callback_data: "view_plans" }]);
    }
    btns.push([{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_plans" }, { text: "👨‍💻 কন্টাক্ট", url: `https://t.me/${config.adminUser}` }]);

    if (isAdmin) btns.push([{ text: "🛠 অ্যাডমিন প্যানেল", callback_data: "admin_dashboard" }]);
    return { inline_keyboard: btns };
}

// --- ৩. কলব্যাক হ্যান্ডলিং (ফিক্সড) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    // ক্লিনিং স্টেট
    if (data === "admin_dashboard" && chatId === config.adminId) {
        bot.sendMessage(chatId, "🛠 **Admin Panel**", {
            reply_markup: { inline_keyboard: [
                [{ text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }],
                [{ text: "📝 প্ল্যান তৈরি", callback_data: "create_plan" }],
                [{ text: "📊 পরিসংখ্যান", callback_data: "stats" }]
            ]}
        });
    } 
    else if (data === "start_post") {
        if (!(await isPremium(chatId))) return bot.answerCallbackQuery(q.id, { text: "Premium Needed!", show_alert: true });
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    }
    else if (data === "setup_ch") {
        userState[chatId] = { step: 'ch_name' };
        bot.sendMessage(chatId, "চ্যানেলের নাম:");
    }
    else if (data === "add_p") {
        userState[chatId] = { step: 'add_p_id' };
        bot.sendMessage(chatId, "ইউজার ID দিন:");
    }
    else if (data === "del_p") {
        userState[chatId] = { step: 'del_p_id' };
        bot.sendMessage(chatId, "ID দিন:");
    }
    else if (data === "create_plan") {
        userState[chatId] = { step: 'plan_name' };
        bot.sendMessage(chatId, "প্ল্যান নাম:");
    }
    else if (data === "view_plans") {
        const plans = await Plan.find();
        let txt = "💎 **Premium Plans:**\n\n";
        plans.forEach(p => txt += `✅ ${p.name} - ${p.price} (${p.days} দিন)\n`);
        bot.sendMessage(chatId, txt || "No plans yet.", {
            reply_markup: { inline_keyboard: [[{ text: "💬 Buy Now", url: `https://t.me/${config.adminUser}` }]] }
        });
    }
    else if (data === "confirm_save") {
        const s = userState[chatId];
        const pf = await Profile.findOne({ userId: chatId });
        const pid = Math.random().toString(36).substring(7);
        await new Post({ id: pid, title: s.title, image: s.image, links: s.links, zoneId: pf.zoneId, adLimit: pf.adCount, channels: pf.channels }).save();
        
        const postUrl = `${config.appUrl}/post/${pid}`;
        bot.sendMessage(chatId, `✅ সফল!\n\n🔗 লিঙ্ক: ${postUrl}\n\n👇 HTML কোড (চ্যানেলের জন্য):`);
        bot.sendMessage(chatId, `<code><b>🎬 ${s.title}</b>\n\n📥 <a href="${postUrl}">Download Now</a></code>`, { parse_mode: 'HTML' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. ইনপুট ও স্টেট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) {
        if (text === '/start') {
            await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
            await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
            bot.sendMessage(chatId, `👋 স্বাগতম!`, { reply_markup: await getMainMenu(chatId) });
        }
        return;
    }

    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'ch_name') { s.tmpN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক:"); }
    else if (s.step === 'ch_link') {
        await Profile.findOneAndUpdate({ userId: chatId }, { $push: { channels: { name: s.tmpN, link: text } } });
        bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।"); delete userState[chatId];
    }
    else if (s.step === 'add_p_id') { s.tId = text; s.step = 'add_p_days'; bot.sendMessage(chatId, "দিন?"); }
    else if (s.step === 'add_p_days') {
        const exp = moment().add(parseInt(text), 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.tId) }, { expiry: exp }, { upsert: true });
        bot.sendMessage(chatId, "✅ প্রিমিয়াম ডান।"); delete userState[chatId];
    }
    else if (s.step === 'plan_name') { s.pN = text; s.step = 'plan_price'; bot.sendMessage(chatId, "দাম?"); }
    else if (s.step === 'plan_price') { s.pP = text; s.step = 'plan_days'; bot.sendMessage(chatId, "দিন?"); }
    else if (s.step === 'plan_days') {
        await new Plan({ name: s.pN, price: s.pP, days: parseInt(text) }).save();
        bot.sendMessage(chatId, "✅ প্ল্যান তৈরি।"); delete userState[chatId];
    }
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
    else if (s.step === 'q') { s.tQ = text; s.step = 'link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
    else if (s.step === 'link') {
        s.links.push({ q: s.tQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক? না হলে বাটন চাপুন।", { 
            reply_markup: { inline_keyboard: [[{ text: "🚀 পোস্ট তৈরি করুন", callback_data: "confirm_save" }]] } 
        });
        s.step = 'q';
    }
});

// --- ৫. ল্যান্ডিং পেজ (অ্যাড ফিক্সড) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.status(404).send("Link Expired");
    res.send(`
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script>
        <style>
            body { background:#000; color:#fff; text-align:center; font-family:sans-serif; padding:15px; }
            .card { background:#111; padding:20px; border-radius:15px; border:1px solid #333; max-width:500px; margin:auto; }
            img { width:100%; border-radius:10px; margin:15px 0; }
            .btn { display:block; background:#e50914; color:#fff; padding:15px; margin:10px 0; text-decoration:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:18px; border:none; width:100%; }
            .status { color:#ff9800; font-weight:bold; margin-bottom:10px; display:block; }
            .hidden { display:none; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>${p.title}</h2>
            <img src="${p.image}">
            <span class="status">Click Ads to Unlock: <span id="count">0</span> / ${p.adLimit}</span>
            <div id="unlock-area">
                ${p.links.map((l, i) => `
                    <button class="btn unlock-btn" onclick="runAd('${l.link}', ${i})">🔓 Unlock Download ${l.q}</button>
                    <a href="${l.link}" class="btn hidden dl-link" id="dl-${i}">📥 Download ${l.q} Now</a>
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

app.listen(process.env.PORT || 3000, () => console.log("Server Live"));
