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
    dbVersion: "1.0" // সংস্করণ পরিবর্তন করলে ডাটাবেস সম্পূর্ণ রিসেট হবে
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস ও অটো-রিসেট লজিক ---
mongoose.connect(config.mongoUri).then(async () => {
    console.log("✅ Database Connected!");
    const Meta = mongoose.model('Meta', new mongoose.Schema({ version: String }));
    const ver = await Meta.findOne();

    if (!ver) {
        await new Meta({ version: config.dbVersion }).save();
    } else if (ver.version !== config.dbVersion) {
        const collections = await mongoose.connection.db.collections();
        for (let col of collections) await col.deleteMany({});
        await Meta.updateOne({}, { version: config.dbVersion });
        console.log("♻️ Database Version Mismatch! All Data Reset.");
    }
}).catch(err => console.log("DB Connection Error:", err));

// --- ৩. ডাটা মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Plan = mongoose.model('Plan', new mongoose.Schema({ title: String, price: String, days: Number }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ userId: Number, zoneId: String, adCount: { type: Number, default: 3 } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, links: Array, zoneId: String, adLimit: Number }));

let userState = {};

// প্রিমিয়াম চেক
async function isPremium(id) {
    if (id === config.adminId) return true;
    const p = await Premium.findOne({ userId: id });
    if (!p) return false;
    if (new Date() > p.expiry) { await Premium.deleteOne({ userId: id }); return false; }
    return true;
}

// মেইন মেনু
function getMenu(chatId) {
    let btns = [
        [{ text: "🎬 মুভি পোস্ট ও কোড তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "🆔 জোন আইডি 🔒", callback_data: "set_zone" }, { text: "🔢 অ্যাড লিমিট 🔒", callback_data: "set_ad_limit" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }, { text: "❓ সাহায্য", callback_data: "help" }]
    ];
    if (chatId === config.adminId) {
        btns.push(
            [{ text: "📊 পরিসংখ্যান (Stats)", callback_data: "view_stats" }, { text: "✨ প্ল্যান অ্যাড", callback_data: "adm_add_plan" }],
            [{ text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }]
        );
    }
    return { inline_keyboard: btns };
}

// --- ৪. কমান্ড ও বাটন হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    bot.sendMessage(msg.chat.id, "🎬 **Professional Movie Bot প্যানেল**", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(msg.chat.id) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    // লকিং সিস্টেম
    const locked = ["start_post", "set_zone", "set_ad_limit"];
    if (locked.includes(q.data) && !isP) {
        return bot.answerCallbackQuery(q.id, { text: "🛑 এই ফিচারটি শুধু প্রিমিয়াম মেম্বারদের জন্য!", show_alert: true });
    }

    if (q.data === "view_stats" && chatId === config.adminId) {
        const uCount = await User.countDocuments();
        const pCount = await Premium.countDocuments();
        const postCount = await Post.countDocuments();
        const statsMsg = `📊 **বোট পরিসংখ্যান:**\n\n👥 মোট ইউজার: ${uCount}\n💎 প্রিমিয়াম মেম্বার: ${pCount}\n📝 মোট মুভি পোস্ট: ${postCount}`;
        bot.sendMessage(chatId, statsMsg, { parse_mode: 'Markdown' });
    }
    else if (q.data === "view_premium") {
        const plans = await Plan.find();
        let txt = "💎 **আমাদের প্রিমিয়াম প্ল্যানসমূহ:**\n\n";
        if (plans.length === 0) txt += "বর্তমানে কোনো প্ল্যান নেই।";
        else plans.forEach(p => txt += `✅ ${p.title} - ${p.price} (${p.days} দিন)\n`);
        bot.sendMessage(chatId, txt + "\nপ্রিমিয়াম নিতে এডমিনকে মেসেজ দিন।", { parse_mode: 'Markdown' });
    }
    else if (q.data === "adm_add_plan" && chatId === config.adminId) {
        userState[chatId] = { step: 'plan_data' };
        bot.sendMessage(chatId, "✨ প্ল্যান অ্যাড করুন: `নাম | দাম | দিন` \n(যেমন: VIP | 200 Tk | 30)");
    }
    else if (q.data === "set_ad_limit") {
        userState[chatId] = { step: 'ad_limit' };
        bot.sendMessage(chatId, "🔢 কয়টি অ্যাড সেট করবেন? (১-১০):");
    }
    else if (q.data === "set_zone") {
        userState[chatId] = { step: 'zone' };
        bot.sendMessage(chatId, "🆔 আপনার Adsterra Zone ID দিন:");
    }
    else if (q.data === "add_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_p' };
        bot.sendMessage(chatId, "প্রিমিয়াম মেম্বার করার জন্য User ID দিন:");
    }
    else if (q.data === "del_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'del_p' };
        bot.sendMessage(chatId, "প্রিমিয়াম ডিলিট করার জন্য User ID দিন:");
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
        
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${pr.zoneId}' data-sdk='show_${pr.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><img src="${s.image}"><h2>${s.title}</h2><div id="st">${pr.adCount}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${pr.adCount}){if(typeof window['show_'+'${pr.zoneId}'] === 'function'){window['show_'+'${pr.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${pr.adCount}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;

        bot.sendMessage(chatId, `✅ **সাফল্য!**\n\n🌐 **Preview:** ${preview}\n\n📄 **HTML Code:**`, { parse_mode: 'Markdown' });
        bot.sendMessage(chatId, `\`\`\`html\n${html}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৫. ইনপুট হ্যান্ডলিং (All States) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const s = userState[chatId];
    if (s) {
        if (s.step === 'plan_data' && chatId === config.adminId) {
            const p = text.split('|'); if (p.length < 3) return bot.sendMessage(chatId, "❌ ভুল ফরম্যাট!");
            await new Plan({ title: p[0].trim(), price: p[1].trim(), days: parseInt(p[2].trim()) }).save();
            bot.sendMessage(chatId, "✅ নতুন প্ল্যান সেভ হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'ad_limit') {
            await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) }, { upsert: true });
            bot.sendMessage(chatId, "✅ অ্যাড লিমিট আপডেট হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'zone') {
            await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true });
            bot.sendMessage(chatId, "✅ জোন আইডি সেট হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'add_p') {
            await Premium.findOneAndUpdate({ userId: parseInt(text) }, { expiry: moment().add(30, 'days').toDate() }, { upsert: true });
            bot.sendMessage(chatId, "✅ মেম্বার প্রিমিয়ামে যুক্ত হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'del_p') {
            await Premium.deleteOne({ userId: parseInt(text) });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম ডিলিট হয়েছে।"); delete userState[chatId];
        } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
        else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
        else if (s.step === 'q_link') {
            s.links.push({ q: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "আরও লিঙ্ক? না হলে 'Confirm' দিন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } });
        }
    }
});

// --- ৬. সার্ভার ও প্রিভিউ (Stats Fix) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.status(404).send("Not Found");
    const qBtns = p.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - ডাউনলোড</button>`).join('');
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${p.title}</title><script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}</style></head><body><div class="card"><img src="${p.image}"><h2>${p.title}</h2><div id="st">${p.adLimit}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${p.adLimit}){if(typeof window['show_'+'${p.zoneId}'] === 'function'){window['show_'+'${p.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${p.adLimit}";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot is Active!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server started on ${PORT}`);
    if (config.appUrl) cron.schedule('*/5 * * * *', () => axios.get(config.appUrl).catch(() => {}));
});
