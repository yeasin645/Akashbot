const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME || "YourUsername", 
    appUrl: process.env.APP_URL 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেল ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected"));

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
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Plan = mongoose.model('Plan', new mongoose.Schema({ name: String, price: String, days: Number }));

let userState = {};

// বাটন মেনু
async function getMenu(chatId) {
    const isAdmin = (chatId === config.adminId);
    let btns = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটিংস", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি", callback_data: "set_zone" }],
        [{ text: "🔢 অ্যাড লিমিট", callback_data: "set_ad_limit" }, { text: "💎 প্ল্যান তালিকা", callback_data: "view_premium" }]
    ];
    if (isAdmin) btns.push([{ text: "🛠 অ্যাডমিন প্যানেল", callback_data: "admin_panel" }]);
    btns.push([{ text: "💬 ওনার কন্টাক্ট", url: `https://t.me/${config.adminUser}` }]);
    return { inline_keyboard: btns };
}

// --- ৩. কলব্যাক ও মেসেজ হ্যান্ডলিং ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    } else if (q.data === "set_zone") {
        userState[chatId] = { step: 'zone' };
        bot.sendMessage(chatId, "আপনার Adsterra Zone ID দিন (যেমন: 10341337):");
    } else if (q.data === "set_ad_limit") {
        userState[chatId] = { step: 'ad_limit' };
        bot.sendMessage(chatId, "কয়টি অ্যাড দেখাতে চান? (শুধু সংখ্যা দিন):");
    } else if (q.data === "confirm") {
        const s = userState[chatId];
        const prof = await Profile.findOne({ userId: chatId }) || { zoneId: '10341337', adCount: 3, channels: [] };
        const pid = Math.random().toString(36).substring(7);
        
        await new Post({ 
            id: pid, creatorId: chatId, title: s.title, image: s.image, 
            links: s.links, zoneId: prof.zoneId, adLimit: prof.adCount, channels: prof.channels 
        }).save();

        const postUrl = `${config.appUrl}/post/${pid}`;
        // সম্পূর্ণ HTML কোড যা টেলিগ্রামে ট্যাপ করলে কপি হবে
        const htmlCode = `&lt;a href="${postUrl}"&gt;🎬 Watch ${s.title}&lt;/a&gt;`;
        
        bot.sendMessage(chatId, `✅ সফল!\n\n🔗 লিঙ্ক: ${postUrl}\n\n📝 **চ্যানেলের জন্য কোড (কপি করুন):**\n<code>${htmlCode}</code>`, { parse_mode: 'HTML' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) {
        if(text === '/start') bot.sendMessage(chatId, "বট সচল!", { reply_markup: await getMenu(chatId) });
        return;
    }
    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true });
        bot.sendMessage(chatId, "✅ জোন আইডি সেট হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'ad_limit') {
        await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) }, { upsert: true });
        bot.sendMessage(chatId, "✅ অ্যাড লিমিট সেট হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক দিবেন? না দিলে Confirm চাপুন।", { 
            reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } 
        });
        s.step = 'q_name';
    }
});

// --- ৪. ল্যান্ডিং পেজ (যেখানে অ্যাড শো হবে) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Post Not Found!");

    // অ্যাড লিমিট অনুযায়ী স্ক্রিপ্ট লুপ
    let adScripts = "";
    for (let i = 0; i < p.adLimit; i++) {
        adScripts += `<script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script>\n`;
    }

    // চ্যানেল বাটন লজিক
    let channelButtons = p.channels.map(c => `<a href="${c.link}" class="btn-ch">${c.name}</a>`).join('');

    const htmlPage = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${p.title}</title>
        <style>
            body { background: #111; color: #fff; text-align: center; font-family: sans-serif; padding: 20px; }
            img { max-width: 100%; border-radius: 10px; margin: 20px 0; }
            .btn { display: block; background: #e50914; color: #fff; padding: 15px; margin: 10px auto; text-decoration: none; border-radius: 5px; width: 80%; font-weight: bold; }
            .btn-ch { display: inline-block; background: #0088cc; color: #fff; padding: 10px; margin: 5px; text-decoration: none; border-radius: 5px; font-size: 14px; }
            .ad-container { margin: 20px 0; border: 1px dashed #444; padding: 10px; }
        </style>
    </head>
    <body>
        <h1>${p.title}</h1>
        <img src="${p.image}" alt="Movie Poster">
        
        <div class="ad-container">
            <p style="font-size: 12px; color: #888;">Ads by Adsterra</p>
            ${adScripts}
        </div>

        <h3>Download Links:</h3>
        ${p.links.map(l => `<a href="${l.link}" class="btn">Download ${l.q}</a>`).join('')}

        <div style="margin-top: 30px;">
            <p>Join our channels:</p>
            ${channelButtons}
        </div>

        <div class="ad-container">${adScripts}</div>
    </body>
    </html>
    `;
    res.send(htmlPage);
});

app.get('/', (req, res) => res.send("Bot is Running..."));
app.listen(process.env.PORT || 3000, () => {
    setInterval(() => { if(config.appUrl) axios.get(config.appUrl).catch(()=>{}); }, 5 * 60 * 1000);
});
