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

// --- MongoDB Connection ---
mongoose.connect(mongoUri)
    .then(() => console.log("✅ MongoDB Connected Successfully!"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String,
    name: String,
    poster: String,
    lang: String,
    links: [{ quality: String, url: String }]
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

// --- Security Check ---
async function isAuth(userId) {
    if (!userId) return false;
    if (userId.toString() === adminId) return true;
    const user = await UserProfile.findOne({ userId });
    return user && user.isPremium && user.premiumExpiry > Date.now();
}

// --- Web View (Movie Page) ---
app.get('/post/:id', async (req, res) => {
    try {
        const postId = req.params.id;
        const userId = req.query.user;

        // মুভি ডেটা খুঁজে বের করা
        const post = await Post.findOne({ postId: postId });
        if (!post) {
            return res.status(404).send("<h1 style='text-align:center; color:white; background:#0f172a; height:100vh; padding-top:50px;'>Movie Not Found!</h1>");
        }

        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const userIsPrem = await isAuth(userId);
        const activeZoneId = (profile && profile.zoneId) ? profile.zoneId : defaultZoneId;

        // কোয়ালিটি বাটনসমূহ
        let qButtons = post.links.map(l => 
            `<button class="btn-quality" onclick="handleAdClick('${l.url}')">${l.quality} - Download</button>`
        ).join('');

        res.send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${post.name}</title>
            <!-- Monetag SDK -->
            ${!userIsPrem ? `<script src='//libtl.com/sdk.js' data-zone='${activeZoneId}' data-sdk='show_${activeZoneId}'></script>` : ''}
            <style>
                body { font-family: 'Segoe UI', sans-serif; background: #0f172a; color: white; margin: 0; padding: 20px; display: flex; justify-content: center; }
                .card { width: 100%; max-width: 450px; background: #1e293b; border-radius: 20px; overflow: hidden; box-shadow: 0 15px 35px rgba(0,0,0,0.6); }
                .poster-img { width: 100%; height: auto; display: block; border-bottom: 4px solid #38bdf8; }
                .content { padding: 25px; text-align: center; }
                .movie-title { font-size: 24px; font-weight: bold; margin: 0 0 10px; color: #38bdf8; }
                .movie-info { font-size: 14px; color: #94a3b8; margin-bottom: 20px; }
                .status-box { background: rgba(56, 189, 248, 0.1); border: 1px dashed #38bdf8; padding: 12px; border-radius: 12px; margin-bottom: 20px; color: #38bdf8; font-weight: bold; font-size: 15px; }
                .btn-quality { display: block; width: 100%; padding: 16px; margin-top: 12px; border: none; border-radius: 12px; font-weight: bold; cursor: pointer; color: white; background: #38bdf8; font-size: 16px; transition: 0.3s; }
                .btn-quality:hover { background: #0ea5e9; transform: translateY(-2px); }
            </style>
        </head>
        <body>
            <div class="card">
                <img class="poster-img" src="${post.poster}" onerror="this.src='https://via.placeholder.com/450x600?text=No+Poster'" alt="Poster">
                <div class="content">
                    <div id="step-info" class="status-box">${userIsPrem ? '⭐ Premium Member (Ad-Free)' : 'বিজ্ঞাপন ধাপ: ০/৩ সম্পন্ন করুন'}</div>
                    <h2 class="movie-title">${post.name}</h2>
                    <p class="movie-info">Language: ${post.lang} | Quality: Select Below</p>
                    <div id="links-container">${qButtons}</div>
                </div>
            </div>

            <script>
                let currentStep = ${userIsPrem ? 3 : 0};
                let pendingUrl = "";

                function handleAdClick(url) {
                    pendingUrl = url;
                    if (currentStep < 3) {
                        const zid = "${activeZoneId}";
                        const showFunc = "show_" + zid;

                        if (typeof window[showFunc] === 'function') {
                            window[showFunc]().then(() => {
                                currentStep++;
                                updateStatusUI();
                                fetch('/api/track?user=${userId}');
                            }).catch(() => {
                                currentStep++;
                                updateStatusUI();
                            });
                        } else {
                            currentStep++;
                            updateStatusUI();
                        }
                    } else {
                        if (pendingUrl === "skip") alert("Link not available!");
                        else window.location.href = pendingUrl;
                    }
                }

                function updateStatusUI() {
                    const infoBox = document.getElementById('step-info');
                    if (infoBox) {
                        infoBox.innerText = "বিজ্ঞাপন ধাপ: " + currentStep + "/৩ সম্পন্ন";
                        if (currentStep >= 3) {
                            infoBox.style.color = "#22c55e";
                            infoBox.innerText = "✅ ধাপ সম্পন্ন! মুভি লিঙ্কে ক্লিক করুন।";
                        } else {
                            alert("ধাপ " + currentStep + " সফল! পরবর্তী বিজ্ঞাপনের জন্য আবার ক্লিক করুন।");
                        }
                    }
                }
            </script>
        </body>
        </html>`);
    } catch (e) {
        console.error(e);
        res.status(500).send("Internal Server Error");
    }
});

// ক্লিক ট্র্যাকিং
app.get('/api/track', async (req, res) => {
    if (req.query.user) await UserProfile.updateOne({ userId: req.query.user }, { $inc: { totalClicks: 1 } });
    res.sendStatus(200);
});

// --- Telegram Bot Commands ---

async function getMainMenu(userId) {
    const auth = await isAuth(userId);
    const owner = userId.toString() === adminId;
    let kb = [];
    if (auth) {
        kb.push([{ text: "🎬 নতুন মুভি পোস্ট করুন", callback_data: "post_new" }]);
        kb.push([{ text: "🛰 Zone ID সেট করুন", callback_data: "set_zone" }, { text: "📊 পরিসংখ্যান", callback_data: "my_stats" }]);
        if (owner) kb.push([{ text: "⚙️ প্রিমিয়াম মেম্বার অ্যাড", callback_data: "add_prem" }]);
    } else {
        kb.push([{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "buy_prem" }]);
    }
    kb.push([{ text: "🆔 আমার আইডি", callback_data: "my_id" }]);
    return { reply_markup: { inline_keyboard: kb } };
}

bot.onText(/\/start/, async (msg) => {
    const kb = await getMainMenu(msg.from.id);
    bot.sendMessage(msg.chat.id, "👋 স্বাগতম! মুভি পোস্ট করতে নিচের বাটন ব্যবহার করুন।", { parse_mode: "Markdown", ...kb });
});

bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const user = query.from.id.toString();
    bot.answerCallbackQuery(query.id);

    if (query.data === "post_new") {
        if (!(await isAuth(user))) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'name', data: { links: [] } }, { upsert: true });
        bot.sendMessage(chat, "🎬 ১. মুভির নাম লিখুন:");
    } else if (query.data === "my_stats") {
        const p = await UserProfile.findOne({ userId: user });
        bot.sendMessage(chat, `📊 *আপনার প্রোফাইল:*\n\nZone ID: \`${p ? p.zoneId : 'Default'}\`\nমোট ক্লিক: ${p ? p.totalClicks : 0}`, { parse_mode: "Markdown" });
    } else if (query.data === "my_id") {
        bot.sendMessage(chat, `🆔 আপনার আইডি: \`${user}\``, { parse_mode: "Markdown" });
    } else if (query.data === "add_link_more") {
        const s = await State.findOne({ chatId: chat });
        if (!s) return;
        s.step = 'quality'; await s.save();
        bot.sendMessage(chat, "💿 কোয়ালিটির নাম লিখুন (যেমন: 720p):");
    } else if (query.data === "save_post") {
        const s = await State.findOne({ chatId: chat });
        const pid = Date.now().toString().slice(-6);
        await new Post({ postId: pid, ...s.data }).save();
        await State.deleteOne({ chatId: chat });
        
        const url = `${myAppUrl}/post/${pid}?user=${user}`;
        const finalKb = { reply_markup: { inline_keyboard: [[{ text: "🔗 প্রিভিউ দেখুন", url: url }]] } };
        bot.sendMessage(chat, `✅ *মুভি সেভ হয়েছে!*\n\nআপনার লিঙ্ক: \`${url}\``, { parse_mode: "Markdown", ...finalKb });
    }
});

bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    let d = state.data;
    switch (state.step) {
        case 'name': d.name = text; state.step = 'poster'; 
            bot.sendMessage(msg.chat.id, "🖼 ২. পোস্টার লিঙ্ক দিন:"); break;
        case 'poster': d.poster = text; state.step = 'lang'; 
            bot.sendMessage(msg.chat.id, "🌐 ৩. মুভির ভাষা:"); break;
        case 'lang': d.lang = text; state.step = 'quality'; 
            bot.sendMessage(msg.chat.id, "💿 ৪. কোয়ালিটির নাম (উদা: 720p):"); break;
        case 'quality': d.temp_q = text; state.step = 'url';
            bot.sendMessage(msg.chat.id, `🔗 "${text}" এর লিঙ্কটি দিন (না থাকলে skip):`); break;
        case 'url':
            d.links.push({ quality: d.temp_q, url: text });
            state.step = 'done_choice';
            const kb = { reply_markup: { inline_keyboard: [
                [{ text: "➕ আরও কোয়ালিটি যোগ করুন", callback_data: "add_link_more" }],
                [{ text: "✅ পোস্ট সেভ করুন", callback_data: "save_post" }]
            ]}};
            state.data = d; await state.save();
            return bot.sendMessage(msg.chat.id, "লিঙ্ক যোগ হয়েছে। এখন কী করতে চান?", kb);
    }
    state.data = d; await state.save();
});

// প্রিমিয়াম মেম্বার অ্যাড (Admin Command)
bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন ${match[2]} দিনের জন্য প্রিমিয়াম।`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 সার্ভার রানিং: ${PORT}`));
