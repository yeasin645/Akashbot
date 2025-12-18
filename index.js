const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
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

let userState = {};

// মেনু জেনারেটর
async function getMenu(chatId) {
    const isAdmin = (chatId === config.adminId);
    let btns = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটিংস", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি", callback_data: "set_zone" }],
        [{ text: "🔢 অ্যাড লিমিট", callback_data: "set_ad_limit" }]
    ];
    if (isAdmin) btns.push([{ text: "🛠 অ্যাডমিন প্যানেল", callback_data: "admin_panel" }]);
    btns.push([{ text: "💬 ওনার কন্টাক্ট", url: `https://t.me/${config.adminUser}` }]);
    return { inline_keyboard: btns };
}

// --- ৩. কলব্যাক ও ইনপুট লজিক ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    if (q.data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    } else if (q.data === "set_zone") {
        userState[chatId] = { step: 'zone' };
        bot.sendMessage(chatId, "Adsterra Zone ID দিন:");
    } else if (q.data === "set_ad_limit") {
        userState[chatId] = { step: 'ad_limit' };
        bot.sendMessage(chatId, "কয়টি অ্যাড দেখাতে চান? (সংখ্যা দিন):");
    } else if (q.data === "confirm") {
        const s = userState[chatId];
        const prof = await Profile.findOne({ userId: chatId }) || { zoneId: '10341337', adCount: 3, channels: [] };
        const pid = Math.random().toString(36).substring(7);
        
        await new Post({ 
            id: pid, creatorId: chatId, title: s.title, image: s.image, 
            links: s.links, zoneId: prof.zoneId, adLimit: prof.adCount, channels: prof.channels 
        }).save();

        const postUrl = `${config.appUrl}/post/${pid}`;
        const htmlCode = `&lt;a href="${postUrl}"&gt;🎬 Watch ${s.title}&lt;/a&gt;`;
        
        bot.sendMessage(chatId, `✅ সফল!\n\n🔗 লিঙ্ক: ${postUrl}\n\n📝 **চ্যানেলে পোস্ট করার কোড (কপি করুন):**\n<code>${htmlCode}</code>`, { parse_mode: 'HTML' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) {
        if(text === '/start') bot.sendMessage(chatId, "মেনু ওপেন করা হলো:", { reply_markup: await getMenu(chatId) });
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
    } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক দিবেন? না দিলে Confirm চাপুন।", { 
            reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } 
        });
        s.step = 'q_name';
    }
});

// --- ৪. ল্যান্ডিং পেজ (অ্যাড ফিক্সড ভার্সন) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Post Not Found!");

    // অ্যাড জেনারেটর লুপ (লিমিট অনুযায়ী)
    let adsHtml = "";
    for (let i = 0; i < p.adLimit; i++) {
        adsHtml += `
        <div class="ad-box">
            <script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script>
        </div>`;
    }

    const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${p.title}</title>
        <style>
            body { background: #0b0b0b; color: #eee; font-family: sans-serif; text-align: center; padding: 15px; }
            .card { background: #1a1a1a; padding: 20px; border-radius: 15px; box-shadow: 0 0 15px rgba(0,0,0,0.5); }
            img { width: 100%; max-width: 350px; border-radius: 10px; border: 2px solid #333; }
            .dl-btn { display: block; background: linear-gradient(45deg, #f01, #901); color: #fff; padding: 12px; margin: 10px auto; text-decoration: none; border-radius: 8px; width: 85%; font-weight: bold; }
            .ad-box { margin: 15px 0; min-height: 50px; background: rgba(255,255,255,0.05); padding: 5px; }
            .badge { background: #333; padding: 5px 10px; border-radius: 5px; font-size: 12px; color: #aaa; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>${p.title}</h2>
            <img src="${p.image}">
            
            <p class="badge">Ads Loaded: ${p.adLimit}</p>

            <div id="ads-area">
                ${adsHtml}
            </div>

            <h3>Download Now</h3>
            ${p.links.map(l => `<a href="${l.link}" class="dl-btn">Download ${l.q}</a>`).join('')}
            
            <div style="margin-top:20px;">
                ${p.channels.map(c => `<a href="${c.link}" style="color:#08c; text-decoration:none; margin:5px;">Join ${c.name}</a>`).join('')}
            </div>
        </div>
        
        <div class="ad-box">${adsHtml}</div>
    </body>
    </html>`;
    
    res.send(htmlContent);
});

app.listen(process.env.PORT || 3000, () => {
    setInterval(() => { if(config.appUrl) axios.get(config.appUrl).catch(()=>{}); }, 5 * 60 * 1000);
});
