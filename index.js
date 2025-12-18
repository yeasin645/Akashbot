const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (রেন্ডার এনভায়রনমেন্ট থেকে নিবে) ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    appUrl: process.env.APP_URL, 
    dbVersion: "8.0" // সংস্করণ বদলালে আগের সব তথ্য মুছে যাবে (কালেকশন রিসেট)
};

const bot = new TelegramBot(config.token, { polling: { autoStart: true, params: { timeout: 10 } } });

// --- ২. ডাটাবেস ও অটো-রিসেট সিস্টেম ---
mongoose.connect(config.mongoUri).then(async () => {
    console.log("✅ Database Connected!");
    const MetaSchema = new mongoose.Schema({ version: String });
    const Meta = mongoose.model('Meta', MetaSchema);
    const ver = await Meta.findOne();

    if (!ver) {
        await new Meta({ version: config.dbVersion }).save();
    } else if (ver.version !== config.dbVersion) {
        const collections = await mongoose.connection.db.collections();
        for (let col of collections) {
            await col.deleteMany({});
            console.log(`🗑 Deleted Collection: ${col.collectionName}`);
        }
        await Meta.updateOne({}, { version: config.dbVersion });
        console.log("♻️ Database Fully Reset.");
    }
}).catch(err => console.log("❌ DB Error:", err));

// --- ৩. ডাটা মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ userId: Number, zoneId: String, adCount: { type: Number, default: 3 } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, links: Array, zoneId: String, adLimit: Number }));

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

// মেইন মেনু বাটন
function getMenu(chatId) {
    let btns = [
        [{ text: "🎬 মুভি পোস্ট ও কোড তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "🆔 জোন আইডি সেট 🔒", callback_data: "set_zone" }, { text: "🔢 অ্যাড লিমিট সেট 🔒", callback_data: "set_ad_limit" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }, { text: "❓ সাহায্য/ফিচার", callback_data: "help" }]
    ];
    if (chatId === config.adminId) {
        btns.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "stats" }],
            [{ text: "➕ মেম্বার অ্যাড (Admin)", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট (Admin)", callback_data: "del_p" }]
        );
    }
    return { inline_keyboard: btns };
}

// --- ৪. কমান্ড ও বাটন হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    bot.sendMessage(chatId, "🔥 **Professional HTML Generator Bot**\n\nমুভি পোস্ট তৈরি করতে নিচের বাটনগুলো ব্যবহার করুন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(chatId) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    // প্রিমিয়াম ফিচার লক
    const locked = ["start_post", "set_zone", "set_ad_limit"];
    if (locked.includes(q.data) && !isP) {
        return bot.answerCallbackQuery(q.id, { text: "⚠️ এটি ব্যবহারের জন্য প্রিমিয়াম মেম্বারশিপ লাগবে!", show_alert: true });
    }

    if (q.data === "help") {
        bot.sendMessage(chatId, "✅ **ফিচারসমূহ:**\n- প্রফেশনাল HTML প্রিভিউ লিঙ্ক।\n- সরাসরি কপিয়েবল টেক্সট কোড।\n- কাস্টম অ্যাড লিমিট (১-১০টি)।\n- Adsterra Zone ID ইন্টিগ্রেশন।");
    } 
    else if (q.data === "view_premium") {
        bot.sendMessage(chatId, "💎 **প্রিমিয়াম সুবিধা:**\n\n১. নিজস্ব Adsterra Zone ID সেট করা।\n২. অ্যাড লিমিট কমানো বা বাড়ানো।\n৩. আনলিমিটেড পোস্ট ও কোড জেনারেশন।\n\nপ্রিমিয়াম নিতে এডমিনকে মেসেজ দিন।");
    }
    else if (q.data === "set_ad_limit") {
        userState[chatId] = { step: 'ad_limit' };
        bot.sendMessage(chatId, "🔢 কয়টি অ্যাড দেখলে লিঙ্ক ওপেন হবে? (১-১০ এর মধ্যে সংখ্যা দিন):");
    }
    else if (q.data === "set_zone") {
        userState[chatId] = { step: 'zone' };
        bot.sendMessage(chatId, "🆔 আপনার Adsterra Zone ID দিন:");
    }
    else if (q.data === "add_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_p' };
        bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার Telegram ID দিন:");
    }
    else if (q.data === "del_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'del_p' };
        bot.sendMessage(chatId, "যাকে ডিলিট করবেন তার ID দিন:");
    }
    else if (q.data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    }
    else if (q.data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const pr = await Profile.findOne({ userId: chatId }) || { zoneId: '10341337', adCount: 3 };
        const id = Math.random().toString(36).substring(7);

        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: pr.zoneId, adLimit: pr.adCount }).save();

        const preview = `${config.appUrl}/post/${id}`;
        const qBtns = s.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - আনলক</button>`).join('\n');
        
        const finalHTML = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${pr.zoneId}' data-sdk='show_${pr.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><img src="${s.image}"><h2>${s.title}</h2><div id="st">${pr.adCount}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${pr.adCount}){if(typeof window['show_'+'${pr.zoneId}'] === 'function'){window['show_'+'${pr.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${pr.adCount}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;

        bot.sendMessage(chatId, `✅ **তৈরি হয়েছে!**\n\n🌐 **Preview Link:** ${preview}\n\n📄 **কপি করার কোড:**`, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId, `\`\`\`html\n${finalHTML}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৫. মেসেজ ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const s = userState[chatId];
    if (s) {
        if (s.step === 'ad_limit') {
            const n = parseInt(text);
            if (isNaN(n) || n < 1 || n > 10) return bot.sendMessage(chatId, "❌ ১-১০ এর মধ্যে সংখ্যা দিন।");
            await Profile.findOneAndUpdate({ userId: chatId }, { adCount: n }, { upsert: true });
            bot.sendMessage(chatId, `✅ সফল! এখন থেকে ${n}টি অ্যাড শো করবে।`); delete userState[chatId];
        } else if (s.step === 'zone') {
            await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true });
            bot.sendMessage(chatId, "✅ আপনার জোন আইডি সেভ হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'add_p') {
            await Premium.findOneAndUpdate({ userId: parseInt(text) }, { expiry: moment().add(30, 'days').toDate() }, { upsert: true });
            bot.sendMessage(chatId, `✅ ID: ${text} এখন প্রিমিয়াম।`); delete userState[chatId];
        } else if (s.step === 'del_p') {
            await Premium.deleteOne({ userId: parseInt(text) });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম ডিলিট হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
        else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
        else if (s.step === 'q_link') {
            s.links.push({ q: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও কোয়ালিটি দিবেন? না দিলে 'Confirm' বাটন চাপুন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm & Get Code", callback_data: "confirm" }]] } });
        }
    }
});

// --- ৬. প্রিভিউ সার্ভার ও রেন্ডার কিপ-অ্যালাইভ ---

app.get('/post/:id', async (req, res) => {
    try {
        const p = await Post.findOne({ id: req.params.id });
        if (!p) return res.status(404).send("Page Expired.");
        const qBtns = p.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - ডাউনলোড</button>`).join('');
        res.setHeader('Content-Type', 'text/html');
        res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${p.title}</title><script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><img src="${p.image}"><h2>${p.title}</h2><div id="st">${p.adLimit}টি অ্যাড দেখলে লিঙ্ক পাবেন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${p.adLimit}){if(typeof window['show_'+'${p.zoneId}'] === 'function'){window['show_'+'${p.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${p.adLimit}";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
    } catch (e) { res.status(500).send("Error."); }
});

app.get('/', (req, res) => res.send("Bot Status: Running..."));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Server on port ${PORT}`);
    if (config.appUrl) cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(() => {}));
});
