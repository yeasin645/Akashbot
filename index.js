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
    .then(() => console.log("✅ MongoDB Connected! Status: Healthy"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String, name: String, poster: String, lang: String,
    links: [{ quality: String, url: String }]
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: { type: String, unique: true },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    zoneId: { type: String, default: defaultZoneId },
    totalClicks: { type: Number, default: 0 }
}));

const Config = mongoose.model('Config', new mongoose.Schema({ key: String, value: String }));
const State = mongoose.model('State', new mongoose.Schema({ chatId: String, step: String, data: Object }));

// --- হেল্পার ফাংশন ---
async function isAuth(userId) {
    if (userId.toString() === adminId) return true;
    const user = await UserProfile.findOne({ userId });
    return user && user.isPremium && user.premiumExpiry > Date.now();
}

async function getMenu(userId) {
    const auth = await isAuth(userId);
    const isAdmin = userId.toString() === adminId;
    let kb = [];
    if (auth) {
        kb.push([{ text: "🎬 নতুন মুভি পোস্ট করুন", callback_data: "post_start" }]);
        kb.push([{ text: "🛰 Zone ID সেট", callback_data: "set_zid" }, { text: "📊 স্ট্যাটাস", callback_data: "stats" }]);
        if (isAdmin) kb.push([{ text: "⚙️ প্রিমিয়াম অ্যাড", callback_data: "add_prem_info" }, { text: "📝 অফার এডিট", callback_data: "edit_offer" }]);
    } else {
        kb.push([{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "view_prem" }]);
    }
    kb.push([{ text: "🆔 আমার আইডি", callback_data: "my_id" }]);
    return { reply_markup: { inline_keyboard: kb } };
}

// --- ওয়েব ভিউ (মুভি পেজ) ---
app.get('/post/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ postId: req.params.id });
        const userId = req.query.user;
        if (!post) return res.status(404).send("<h1>Movie Not Found!</h1>");

        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const isPrem = (userId === adminId) || (profile && profile.isPremium && profile.premiumExpiry > Date.now());
        const userZone = (profile && profile.zoneId) ? profile.zoneId : defaultZoneId;

        let qButtons = post.links.map(l => 
            `<button class="btn" onclick="startAd('${l.url}')">${l.quality} - ডাউনলোড</button>`
        ).join('');

        res.send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${post.name}</title>
            ${!isPrem ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: white; text-align: center; margin: 0; padding: 20px; }
                .card { max-width: 450px; background: #1e293b; margin: auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
                img { width: 100%; height: auto; border-bottom: 2px solid #38bdf8; }
                .p-20 { padding: 25px; }
                .btn { display: block; width: 100%; padding: 15px; margin-top: 15px; border: none; border-radius: 12px; font-weight: bold; cursor: pointer; color: white; background: #38bdf8; font-size: 16px; transition: 0.3s; }
                .btn:hover { background: #0ea5e9; transform: scale(1.02); }
                .status-box { background: rgba(56, 189, 248, 0.1); border: 1px dashed #38bdf8; padding: 12px; border-radius: 12px; margin-bottom: 20px; color: #38bdf8; font-size: 14px; font-weight: bold; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="${post.poster}">
                <div class="p-20">
                    <div id="step-info" class="status-box">${isPrem ? '⭐ প্রিমিয়াম মেম্বার (অ্যাড মুক্ত)' : 'বিজ্ঞাপন ধাপ: ০/৩ সম্পন্ন করুন'}</div>
                    <h2 style="margin:0 0 10px;">${post.name}</h2>
                    <p style="color:#94a3b8; font-size:14px;">ভাষা: ${post.lang}</p>
                    <div style="margin-top:20px;">${qButtons}</div>
                </div>
            </div>
            <script>
                let count = ${isPrem ? 3 : 0};
                let targetLink = "";
                function startAd(url) {
                    targetLink = url;
                    if (count < 3) {
                        const zid = "${userZone}";
                        if (typeof window['show_'+zid] === 'function') {
                            window['show_'+zid]().then(() => { count++; updateUI(); });
                        } else { count++; updateUI(); }
                    } else {
                        if(targetLink === 'skip') alert("দুঃখিত, লিঙ্ক পাওয়া যায়নি!"); 
                        else window.location.href = targetLink;
                    }
                }
                function updateUI() {
                    const el = document.getElementById('step-info');
                    if(el) el.innerText = "বিজ্ঞাপন ধাপ: " + count + "/৩ সম্পন্ন";
                    if(count >= 3) alert("সব ধাপ সম্পন্ন! মুভি পেতে আবার বাটনে ক্লিক করুন।");
                }
            </script>
        </body>
        </html>`);
    } catch (e) { res.status(500).send("সার্ভার এরর!"); }
});

// --- টেলিগ্রাম বট লজিক ---

bot.onText(/\/start/, async (msg) => {
    await State.deleteOne({ chatId: msg.chat.id }); // রিসেট স্টেট
    const kb = await getMenu(msg.from.id);
    bot.sendMessage(msg.chat.id, "🎬 *মুভি কন্ট্রোল প্যানেল*\n\nনিচের বাটনগুলো ব্যবহার করুন।", { parse_mode: "Markdown", ...kb });
});

bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const user = query.from.id.toString();
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    const auth = await isAuth(user);

    if (data === "post_start") {
        if (!auth) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'm_name', data: { links: [] } }, { upsert: true });
        bot.sendMessage(chat, "🎬 ১. মুভির নাম লিখুন:");
    } else if (data === "add_more_links") {
        const s = await State.findOne({ chatId: chat });
        if (!s) return;
        s.step = 'm_quality';
        await s.save();
        bot.sendMessage(chat, "💿 কোয়ালিটির নাম লিখুন (উদা: 720p):");
    } else if (data === "finish_post") {
        const s = await State.findOne({ chatId: chat });
        if (!s) return;
        const pid = Date.now().toString().slice(-6);
        await new Post({ postId: pid, name: s.data.name, poster: s.data.poster, lang: s.data.lang, links: s.data.links }).save();
        await State.deleteOne({ chatId: chat });
        
        const finalUrl = `${myAppUrl}/post/${pid}?user=${user}`;
        const finishKb = { reply_markup: { inline_keyboard: [
            [{ text: "🔗 প্রিভিউ দেখুন", url: finalUrl }],
            [{ text: "🏠 মেইন মেনু", callback_data: "go_start" }]
        ]}};
        bot.sendMessage(chat, `✅ *মুভি সফলভাবে সেভ হয়েছে!*\n\n🔗 আপনার লিঙ্ক:\n\`${finalUrl}\``, { parse_mode: "Markdown", ...finishKb });
    } else if (data === "go_start") {
        const kb = await getMenu(user);
        bot.sendMessage(chat, "🏠 মেইন মেনু:", kb);
    }
    // ... অন্যান্য বাটন (set_zid, stats) আগের মতো কাজ করবে ...
});

bot.on('message', async (msg) => {
    const txt = msg.text;
    if (!txt || txt.startsWith('/')) return;
    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    let d = state.data;
    switch (state.step) {
        case 'm_name': d.name = txt; state.step = 'm_poster'; 
            bot.sendMessage(msg.chat.id, "🖼 ২. পোস্টার লিঙ্ক দিন:"); break;
        case 'm_poster': d.poster = txt; state.step = 'm_lang'; 
            bot.sendMessage(msg.chat.id, "🌐 ৩. মুভির ভাষা:"); break;
        case 'm_lang': d.lang = txt; state.step = 'm_quality'; 
            bot.sendMessage(msg.chat.id, "💿 ৪. কোয়ালিটির নাম (উদা: 720p) অথবা skip লিখুন:"); break;
        case 'm_quality':
            if (txt.toLowerCase() === 'skip') {
                d.links.push({ quality: 'Download', url: 'skip' });
                state.step = 'ask_done';
            } else {
                d.temp_q = txt; state.step = 'm_url';
                return bot.sendMessage(msg.chat.id, `🔗 "${txt}" এর লিঙ্কটি দিন (না থাকলে skip):`);
            }
            break;
        case 'm_url':
            d.links.push({ quality: d.temp_q, url: txt });
            state.step = 'ask_done';
            break;
    }

    if (state.step === 'ask_done') {
        const finishKb = { reply_markup: { inline_keyboard: [
            [{ text: "➕ আরও কোয়ালিটি যোগ করুন", callback_data: "add_more_links" }],
            [{ text: "✅ পোস্ট সম্পন্ন করুন", callback_data: "finish_post" }]
        ]}};
        state.data = d; await state.save();
        return bot.sendMessage(msg.chat.id, "✅ লিঙ্ক যোগ হয়েছে। আরও লিঙ্ক দিবেন নাকি সেভ করবেন?", finishKb);
    }

    state.data = d; await state.save();
});

// সরাসরি অ্যাডমিন কমান্ড (Premium)
bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন প্রিমিয়াম।`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server Running on Port: ${PORT}`));
