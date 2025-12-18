require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL;
const adminId = process.env.ADMIN_ID;
const mongoUri = process.env.MONGO_URI;
const defaultZoneId = process.env.ZONE_ID || '10341337';

const bot = new TelegramBot(token, { polling: true });

// --- MongoDB কানেকশন ---
mongoose.connect(mongoUri)
    .then(() => console.log("✅ MongoDB Connected! Unlimited Quality System Ready."))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String,
    name: String,
    poster: String,
    lang: String,
    links: [{ quality: String, url: String }] // আনলিমিটেড লিঙ্ক এরে
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: { type: String, unique: true },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    zoneId: { type: String, default: defaultZoneId },
    totalClicks: { type: Number, default: 0 }
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({ name: String, link: String }));
const State = mongoose.model('State', new mongoose.Schema({ chatId: String, step: String, data: Object }));

// --- হেল্পার ফাংশন ---
async function isAuth(userId) {
    if (userId.toString() === adminId) return true;
    const user = await UserProfile.findOne({ userId });
    return user && user.isPremium && user.premiumExpiry > Date.now();
}

// --- ওয়েব ভিউ (মুভি পেজ) ---
app.get('/post/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ postId: req.params.id });
        const userId = req.query.user;
        if (!post) return res.status(404).send("মুভি পাওয়া যায়নি!");

        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const isPrem = (userId === adminId) || (profile && profile.isPremium && profile.premiumExpiry > Date.now());

        const userZone = (profile && profile.zoneId) ? profile.zoneId : defaultZoneId;
        const adminChs = await AdminChannel.find();

        // কোয়ালিটি বাটন জেনারেট করা
        let movieButtons = post.links.map((item, index) => 
            `<button class="btn btn-watch" onclick="handleAdClick('${item.url}')">${item.quality} - দেখুন</button>`
        ).join('');

        res.send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${post.name}</title>
            ${!isPrem ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}
            <style>
                body { font-family: sans-serif; background: #0f172a; color: white; text-align: center; margin: 0; padding: 20px; }
                .card { max-width: 450px; background: #1e293b; margin: auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
                img { width: 100%; height: auto; border-bottom: 2px solid #38bdf8; }
                .content { padding: 20px; }
                .btn { display: block; width: 100%; padding: 15px; margin-top: 10px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; color: white; background: #38bdf8; font-size: 16px; }
                .btn:hover { background: #0ea5e9; }
                .step-info { background: rgba(56, 189, 248, 0.1); border: 1px dashed #38bdf8; padding: 10px; border-radius: 10px; margin-bottom: 15px; font-size: 14px; color: #38bdf8; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="${post.poster}">
                <div class="content">
                    <div id="status" class="step-info">${isPrem ? '⭐ প্রিমিয়াম মেম্বার' : 'বিজ্ঞাপন ধাপ: ০/৩ সম্পন্ন করুন'}</div>
                    <h2>${post.name}</h2>
                    <p>ভাষা: ${post.lang}</p>
                    <hr style="border:0; border-top:1px solid #334155; margin:15px 0;">
                    ${movieButtons}
                </div>
            </div>
            <script>
                let adCount = ${isPrem ? 3 : 0};
                let targetUrl = "";

                function handleAdClick(url) {
                    targetUrl = url;
                    if (adCount < 3) {
                        const zid = "${userZone}";
                        const func = "show_" + zid;
                        if (typeof window[func] === 'function') {
                            window[func]().then(() => { adCount++; updateUI(); });
                        } else { adCount++; updateUI(); }
                    } else {
                        window.location.href = targetUrl;
                    }
                }

                function updateUI() {
                    const s = document.getElementById('status');
                    if(s) s.innerText = "বিজ্ঞাপন ধাপ: " + adCount + "/৩";
                    if(adCount >= 3) alert("ধাপ সম্পন্ন! ডাউনলোড শুরু করতে আবার বাটনে ক্লিক করুন।");
                }
            </script>
        </body>
        </html>`);
    } catch (e) { res.status(500).send("সার্ভার এরর"); }
});

// --- টেলিগ্রাম বট লজিক ---

bot.onText(/\/start/, async (msg) => {
    const auth = await isAuth(msg.from.id);
    const menu = {
        reply_markup: {
            inline_keyboard: [
                auth ? [{ text: "🎬 মুভি পোস্ট করুন", callback_data: "post" }] : [],
                [{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "premium" }, { text: "🆔 আমার আইডি", callback_data: "myid" }],
                auth ? [{ text: "🛰 Zone ID সেট", callback_data: "set_zid" }, { text: "📊 পরিসংখ্যান", callback_data: "stats" }] : []
            ].filter(r => r.length > 0)
        }
    };
    bot.sendMessage(msg.chat.id, "👋 স্বাগতম! মুভি পোস্ট করতে নিচের বাটন ব্যবহার করুন।", menu);
});

bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const user = query.from.id.toString();
    bot.answerCallbackQuery(query.id);

    if (query.data === "post") {
        if (!(await isAuth(user))) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'name', data: { links: [] } }, { upsert: true });
        bot.sendMessage(chat, "🎬 ১. মুভির নাম লিখুন:");
    }
    // ... অন্যান্য বাটন লজিক (set_zid, stats ইত্যাদি আগের মতোই থাকবে)
});

// মেসেজ হ্যান্ডলার (ধাপে ধাপে আনলিমিটেড পোস্ট সিস্টেম)
bot.on('message', async (msg) => {
    const txt = msg.text;
    if (!txt || txt.startsWith('/')) return;

    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    if (!(await isAuth(msg.from.id))) return;

    let d = state.data;

    switch (state.step) {
        case 'name':
            d.name = txt;
            state.step = 'poster';
            bot.sendMessage(msg.chat.id, "🖼 ২. মুভির পোস্টার লিঙ্ক দিন:");
            break;
        case 'poster':
            d.poster = txt;
            state.step = 'lang';
            bot.sendMessage(msg.chat.id, "🌐 ৩. মুভির ভাষা লিখুন:");
            break;
        case 'lang':
            d.lang = txt;
            state.step = 'quality';
            bot.sendMessage(msg.chat.id, "💿 ৪. মুভির কোয়ালিটি লিখুন (যেমন: 720p, 1080p, বা 480p):\n\n(যদি কোনো কোয়ালিটি না থাকে তবে `skip` লিখুন)");
            break;
        case 'quality':
            if (txt.toLowerCase() === 'skip') {
                d.links.push({ quality: "Download", url: "skip" });
                return finishPost(msg.chat.id, d);
            }
            d.temp_quality = txt;
            state.step = 'url';
            bot.sendMessage(msg.chat.id, `🔗 এবার "${txt}" কোয়ালিটির ডাউনলোড লিঙ্কটি দিন (না থাকলে skip লিখুন):`);
            break;
        case 'url':
            d.links.push({ quality: d.temp_quality, url: txt });
            state.step = 'ask_more';
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "➕ আরও কোয়ালিটি যোগ করুন", callback_data: "add_more" }],
                        [{ text: "✅ পোস্ট সম্পন্ন করুন", callback_data: "finish_post" }]
                    ]
                }
            };
            bot.sendMessage(msg.chat.id, "✅ লিঙ্ক যোগ হয়েছে। আপনি কি আরও কোয়ালিটি যোগ করতে চান?", keyboard);
            break;
    }
    state.data = d;
    await state.save();
});

// আরও কোয়ালিটি এবং ফিনিশিং হ্যান্ডলার
bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const state = await State.findOne({ chatId: chat });
    if (!state) return;

    if (query.data === "add_more") {
        state.step = 'quality';
        await state.save();
        bot.sendMessage(chat, "💿 পরবর্তী কোয়ালিটির নাম লিখুন:");
    }

    if (query.data === "finish_post") {
        await finishPost(chat, state.data);
    }
});

async function finishPost(chat, data) {
    const pid = Date.now().toString().slice(-6);
    await new Post({ postId: pid, name: data.name, poster: data.poster, lang: data.lang, links: data.links }).save();
    await State.deleteOne({ chatId: chat });
    bot.sendMessage(chat, `✅ পোস্ট তৈরি হয়েছে!\n\n🔗 মুভি লিঙ্ক:\n${myAppUrl}/post/${pid}?user=${chat}`);
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 সার্ভার রানিং: ${PORT}`));
