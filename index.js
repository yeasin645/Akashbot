const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (আপনার তথ্য দিয়ে দিন) ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME || "YourUsername", 
    appUrl: process.env.APP_URL 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেলসমূহ ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected")).catch(e => console.log(e));

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

// প্রিমিয়াম চেক
async function isPremium(id) {
    if (id === config.adminId) return true;
    const p = await Premium.findOne({ userId: id });
    if (!p) return false;
    if (new Date() > p.expiry) { await Premium.deleteOne({ userId: id }); return false; }
    return true;
}

// বাটন মেনু জেনারেটর
async function getMenu(chatId) {
    const isP = await isPremium(chatId);
    const isAdmin = (chatId === config.adminId);
    let btns = [];

    if (isP || isAdmin) {
        btns.push([{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }]);
        btns.push([{ text: "📢 চ্যানেল সেটিংস", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি", callback_data: "set_zone" }]);
        btns.push([{ text: "🔢 অ্যাড লিমিট", callback_data: "set_ad_limit" }, { text: "💎 প্ল্যান তালিকা", callback_data: "view_premium" }]);
    } else {
        btns.push([{ text: "🎬 মুভি পোস্ট তৈরি 🔒", callback_data: "start_post" }]);
        btns.push([{ text: "💎 প্রিমিয়াম প্ল্যান দেখুন", callback_data: "view_premium" }]);
    }
    if (isAdmin) btns.push([{ text: "🛠 অ্যাডমিন প্যানেল", callback_data: "admin_panel" }]);
    btns.push([{ text: "💬 ওনার কন্টাক্ট", url: `https://t.me/${config.adminUser}` }]);
    return { inline_keyboard: btns };
}

// --- ৩. কমান্ড ও কলব্যাক হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    bot.sendMessage(chatId, "👋 **Movie Bot Master** এ স্বাগতম!", { reply_markup: await getMenu(chatId) });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isAdmin = (chatId === config.adminId);
    const isP = await isPremium(chatId);

    // সিকিউরিটি চেক
    if (["start_post", "setup_ch", "set_zone", "set_ad_limit"].includes(q.data) && !isP) {
        return bot.answerCallbackQuery(q.id, { text: "🛑 আপনার প্রিমিয়াম নেই!", show_alert: true });
    }

    switch (q.data) {
        case "admin_panel":
            if (!isAdmin) return;
            bot.sendMessage(chatId, "📊 **অ্যাডমিন ড্যাশবোর্ড:**", {
                reply_markup: { inline_keyboard: [
                    [{ text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }],
                    [{ text: "📝 প্ল্যান অ্যাড", callback_data: "add_plan" }, { text: "📈 লাইভ স্ট্যাটাস", callback_data: "view_stats" }]
                ]}
            });
            break;

        case "setup_ch":
            const pf = await Profile.findOne({ userId: chatId });
            let chMsg = "📢 **আপনার চ্যানেলসমূহ:**\n";
            pf.channels.length ? pf.channels.forEach((c, i) => chMsg += `${i+1}. ${c.name}\n`) : chMsg += "কিছুই নেই।";
            bot.sendMessage(chatId, chMsg, { reply_markup: { inline_keyboard: [[{ text: "➕ চ্যানেল অ্যাড", callback_data: "add_ch" }], [{ text: "🗑 ক্লিয়ার অল", callback_data: "clear_ch" }]] } });
            break;

        case "add_ch": userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); break;
        case "clear_ch": await Profile.findOneAndUpdate({ userId: chatId }, { channels: [] }); bot.sendMessage(chatId, "✅ সব চ্যানেল মোছা হয়েছে।"); break;
        case "set_zone": userState[chatId] = { step: 'zone' }; bot.sendMessage(chatId, "নতুন Zone ID দিন:"); break;
        case "set_ad_limit": userState[chatId] = { step: 'ad_limit' }; bot.sendMessage(chatId, "অ্যাড সংখ্যা দিন:"); break;
        case "add_plan": userState[chatId] = { step: 'plan_name' }; bot.sendMessage(chatId, "প্ল্যানের নাম:"); break;
        case "add_p": userState[chatId] = { step: 'add_p_id' }; bot.sendMessage(chatId, "ইউজার আইডি:"); break;
        case "del_p": userState[chatId] = { step: 'del_p_id' }; bot.sendMessage(chatId, "যাকে বাদ দিবেন তার আইডি:"); break;
        case "view_stats":
            const tu = await User.countDocuments();
            const tp = await Premium.countDocuments();
            bot.sendMessage(chatId, `📊 মোট ইউজার: ${tu}\n💎 প্রিমিয়াম: ${tp}`);
            break;
        case "view_premium":
            const plans = await Plan.find();
            let pTxt = "💎 **প্যাকেজসমূহ:**\n\n";
            plans.length ? plans.forEach(p => pTxt += `✅ ${p.name} - ${p.price}\n`) : pTxt += "নেই।";
            bot.sendMessage(chatId, pTxt, { reply_markup: { inline_keyboard: [[{ text: "💬 যোগাযোগ", url: `https://t.me/${config.adminUser}` }]] } });
            break;
        case "start_post":
            userState[chatId] = { step: 'title', links: [] };
            bot.sendMessage(chatId, "মুভির নাম লিখুন:");
            break;
        case "confirm":
            const s = userState[chatId];
            const profile = await Profile.findOne({ userId: chatId });
            const pid = Math.random().toString(36).substring(7);
            await new Post({ id: pid, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: profile.zoneId, adLimit: profile.adCount, channels: profile.channels }).save();
            const url = `${config.appUrl}/post/${pid}`;
            bot.sendMessage(chatId, `✅ সফল!\n🔗 লিঙ্ক: ${url}\n📝 কোড: <code>&lt;a href="${url}"&gt;🎬 Watch ${s.title}&lt;/a&gt;</code>`, { parse_mode: 'HTML' });
            delete userState[chatId];
            break;
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true });
        bot.sendMessage(chatId, "✅ জোন আইডি আপডেট হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'ad_limit') {
        await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) || 3 }, { upsert: true });
        bot.sendMessage(chatId, "✅ লিমিট আপডেট হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'ch_name') {
        s.cN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক:");
    } else if (s.step === 'ch_link') {
        await Profile.findOneAndUpdate({ userId: chatId }, { $push: { channels: { name: s.cN, link: text } } }, { upsert: true });
        bot.sendMessage(chatId, "✅ চ্যানেল যুক্ত হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'plan_name') {
        s.pN = text; s.step = 'plan_price'; bot.sendMessage(chatId, "দাম:");
    } else if (s.step === 'plan_price') {
        s.pP = text; s.step = 'plan_days'; bot.sendMessage(chatId, "দিন (সংখ্যা):");
    } else if (s.step === 'plan_days') {
        await new Plan({ name: s.pN, price: s.pP, days: parseInt(text) }).save();
        bot.sendMessage(chatId, "✅ প্ল্যান সেভ হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'add_p_id') {
        s.targetId = text; s.step = 'add_p_days'; bot.sendMessage(chatId, "কত দিন?");
    } else if (s.step === 'add_p_days') {
        const exp = moment().add(parseInt(text), 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.targetId) }, { expiry: exp }, { upsert: true });
        bot.sendMessage(chatId, "✅ মেম্বার যুক্ত!"); delete userState[chatId];
    } else if (s.step === 'del_p_id') {
        await Premium.deleteOne({ userId: parseInt(text) });
        bot.sendMessage(chatId, "❌ বাতিল করা হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক? না হলে Confirm চাপুন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } });
        s.step = 'q_name';
    }
});

// --- ৫. ল্যান্ডিং পেজ ও অ্যাড লজিক ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Not Found");

    let ads = "";
    for (let i = 0; i < p.adLimit; i++) {
        ads += `<div style="margin:10px 0;"><script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script></div>`;
    }

    res.send(`
    <html>
    <head><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${p.title}</title>
    <style>body{background:#000;color:#fff;text-align:center;font-family:sans-serif;padding:20px;} img{max-width:100%;border-radius:10px;} .btn{display:block;background:#e50914;color:#fff;padding:15px;margin:10px;text-decoration:none;border-radius:5px;font-weight:bold;}</style>
    </head>
    <body>
        <h2>${p.title}</h2><img src="${p.image}">
        <div id="ads">${ads}</div>
        ${p.links.map(l => `<a href="${l.link}" class="btn">Download ${l.q}</a>`).join('')}
        <div style="margin-top:20px;">${p.channels.map(c => `<a href="${c.link}" style="color:#0088cc;margin:5px;">Join ${c.name}</a>`).join('')}</div>
        <div id="ads-footer">${ads}</div>
    </body>
    </html>`);
});

app.get('/', (req, res) => res.send("Active"));
app.listen(process.env.PORT || 3000, () => {
    setInterval(() => { if(config.appUrl) axios.get(config.appUrl).catch(()=>{}); }, 5 * 60 * 1000);
});
