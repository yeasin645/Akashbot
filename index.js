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
    .then(() => console.log("✅ MongoDB Connected! System is fast and ready."))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- মড্যুলার ডেটাবেস মডেলসমূহ ---
const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String, name: String, poster: String, lang: String, quality: String, movieLink: String, downloadLink: String
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: { type: String, unique: true },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    zoneId: { type: String, default: defaultZoneId },
    channels: [{ name: String, link: String }],
    totalClicks: { type: Number, default: 0 }
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({ name: String, link: String }));
const Config = mongoose.model('Config', new mongoose.Schema({ key: String, value: String }));
const State = mongoose.model('State', new mongoose.Schema({ chatId: String, step: String, data: Object }));

// --- হেল্পার ফাংশনসমূহ ---

async function getAuthStatus(userId) {
    if (userId.toString() === adminId) return { owner: true, premium: true };
    const user = await UserProfile.findOne({ userId });
    const isPrem = user && user.isPremium && user.premiumExpiry > Date.now();
    return { owner: false, premium: isPrem };
}

// ডাইনামিক বাটন মেনু জেনারেটর
async function getMainMenu(userId) {
    const { owner, premium } = await getAuthStatus(userId);
    let keyboard = [];

    if (owner) {
        keyboard.push([{ text: "🎬 মুভি পোস্ট", callback_data: "action_post" }]);
        keyboard.push([{ text: "⚙️ প্রিমিয়াম অ্যাড", callback_data: "action_add_prem" }, { text: "📢 মেইন চ্যানেল", callback_data: "action_set_ch" }]);
        keyboard.push([{ text: "📝 অফার এডিট", callback_data: "action_edit_off" }]);
        keyboard.push([{ text: "🛰 Zone ID", callback_data: "action_set_zid" }, { text: "📊 পরিসংখ্যান", callback_data: "action_stats" }]);
    } else if (premium) {
        keyboard.push([{ text: "🎬 মুভি পোস্ট", callback_data: "action_post" }]);
        keyboard.push([{ text: "🛰 আমার Zone ID", callback_data: "action_set_zid" }, { text: "📢 আমার চ্যানেল", callback_data: "action_add_my_ch" }]);
        keyboard.push([{ text: "📊 আমার পরিসংখ্যান", callback_data: "action_stats" }, { text: "🆔 আমার আইডি", callback_data: "action_myid" }]);
    } else {
        keyboard.push([{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "action_view_prem" }]);
        keyboard.push([{ text: "🆔 আমার আইডি", callback_data: "action_myid" }]);
    }

    return { reply_markup: { inline_keyboard: keyboard } };
}

// --- মুভি পেজ (কাউন্ট সিস্টেম সহ) ---
app.get('/post/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ postId: req.params.id });
        const userId = req.query.user;
        if (!post) return res.status(404).send("Movie Not Found");

        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const isPrem = (userId === adminId) || (profile && profile.isPremium && profile.premiumExpiry > Date.now());

        const userZone = (isPrem && profile && profile.zoneId) ? profile.zoneId : defaultZoneId;
        const adminChs = await AdminChannel.find();
        const displayChannels = (isPrem && profile && profile.channels.length > 0) ? profile.channels : adminChs;

        let channelButtons = displayChannels.map(ch => `<a href="${ch.link}" class="ch-btn">${ch.name}</a>`).join('');

        res.send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${post.name}</title>
            ${!isPrem ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}
            <style>
                body { font-family: sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; margin: 0; }
                .card { max-width: 450px; background: #1e293b; margin: auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
                img { width: 100%; border-bottom: 3px solid #38bdf8; }
                .content { padding: 25px; }
                .btn { display: block; width: 100%; padding: 16px; margin-top: 12px; border: none; border-radius: 12px; font-weight: bold; cursor: pointer; font-size: 17px; text-decoration: none; color: white; }
                .btn-watch { background: #38bdf8; color: #0f172a; }
                .btn-down { background: #22c55e; }
                .ch-btn { display: inline-block; background: #334155; padding: 8px 15px; margin: 5px; border-radius: 8px; color: white; text-decoration: none; font-size: 12px; }
                .step-box { background: rgba(56, 189, 248, 0.1); border: 1px dashed #38bdf8; padding: 10px; border-radius: 10px; margin-bottom: 15px; font-size: 14px; color: #38bdf8; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="${post.poster}">
                <div class="content">
                    <div id="status" class="step-box">${isPrem ? '⭐ প্রিমিয়াম মেম্বার' : 'বিজ্ঞাপন ধাপ: ০/৩'}</div>
                    <h2 style="margin:0;">${post.name}</h2>
                    <p style="color:#94a3b8; font-size:13px;">${post.lang} | ${post.quality}</p>
                    <button class="btn btn-watch" onclick="runAd('watch')">অনলাইনে দেখুন</button>
                    <button class="btn btn-down" onclick="runAd('down')">ডাউনলোড করুন</button>
                    <div style="margin-top:20px;">${channelButtons}</div>
                </div>
            </div>
            <script>
                let count = ${isPrem ? 3 : 0};
                function runAd(type) {
                    if (count < 3) {
                        const zid = "${userZone}";
                        if (typeof window['show_'+zid] === 'function') {
                            window['show_'+zid]().then(() => { count++; updateUI(); fetch('/api/track?user=${userId}'); });
                        } else { count++; updateUI(); }
                    } else {
                        const l = (type === 'watch') ? "${post.movieLink}" : "${post.downloadLink}";
                        if(l === 'skip') alert("Link not found"); else window.location.href = l;
                    }
                }
                function updateUI() {
                    const s = document.getElementById('status');
                    if(s) s.innerText = "বিজ্ঞাপন ধাপ: " + count + "/৩";
                    if(count >= 3) alert("সব ধাপ সম্পন্ন! আবার বাটনে ক্লিক করুন।");
                }
            </script>
        </body>
        </html>`);
    } catch (e) { res.status(500).send("Error"); }
});

app.get('/api/track', async (req, res) => {
    if (req.query.user) await UserProfile.updateOne({ userId: req.query.user }, { $inc: { totalClicks: 1 } });
    res.sendStatus(200);
});

// --- টেলিগ্রাম হ্যান্ডলারস (সম্পূর্ণ বাটন-ভিত্তিক) ---

bot.onText(/\/start/, async (msg) => {
    const keyboard = await getMainMenu(msg.from.id);
    bot.sendMessage(msg.chat.id, "🎬 *মুভি মেনু ড্যাশবোর্ড*\nআপনার পছন্দমতো বাটন নির্বাচন করুন।", { parse_mode: "Markdown", ...keyboard });
});

bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const user = query.from.id.toString();
    const action = query.data;
    bot.answerCallbackQuery(query.id);

    const { premium, owner } = await getAuthStatus(user);

    switch (action) {
        case "action_post":
            if (!premium) return;
            await State.findOneAndUpdate({ chatId: chat }, { step: 'n', data: {} }, { upsert: true });
            bot.sendMessage(chat, "🎬 মুভির নাম লিখুন:");
            break;
        case "action_stats":
            const up = await UserProfile.findOne({ userId: user });
            bot.sendMessage(chat, `📊 *স্ট্যাটাস*\n\nZone ID: \`${up ? up.zoneId : 'Default'}\`\nমোট ক্লিক: ${up ? up.totalClicks : 0}`, { parse_mode: "Markdown" });
            break;
        case "action_myid":
            bot.sendMessage(chat, `🆔 আপনার আইডি: \`${user}\``, { parse_mode: "Markdown" });
            break;
        case "action_view_prem":
            const conf = await Config.findOne({ key: 'off' });
            bot.sendMessage(chat, conf ? conf.value : "💎 প্রিমিয়াম হতে অ্যাডমিনকে নক দিন।", { parse_mode: "Markdown" });
            break;
        case "action_set_zid":
            if (!premium) return;
            await State.findOneAndUpdate({ chatId: chat }, { step: 'sz' }, { upsert: true });
            bot.sendMessage(chat, "🛰 আপনার মনিটেগ Zone ID টি লিখে পাঠান:");
            break;
        case "action_add_my_ch":
            if (!premium) return;
            await State.findOneAndUpdate({ chatId: chat }, { step: 'ucn', data: {} }, { upsert: true });
            bot.sendMessage(chat, "📢 আপনার চ্যানেলের নাম দিন:");
            break;
        case "action_add_prem":
            if (!owner) return;
            bot.sendMessage(chat, "⚙️ প্রিমিয়াম অ্যাড করতে টাইপ করুন: \n`/addpremium ইউজারআইডি দিন` \n\nউদাহরণ: `/addpremium 12345 30`", { parse_mode: "Markdown" });
            break;
        case "action_set_ch":
            if (!owner) return;
            await State.findOneAndUpdate({ chatId: chat }, { step: 'acn', data: {} }, { upsert: true });
            bot.sendMessage(chat, "📢 অ্যাডমিন চ্যানেলের নাম দিন:");
            break;
        case "action_edit_off":
            if (!owner) return;
            await State.findOneAndUpdate({ chatId: chat }, { step: 'eo' }, { upsert: true });
            bot.sendMessage(chat, "📝 নতুন প্রিমিয়াম অফার টেক্সটটি লিখে পাঠান:");
            break;
    }
});

// মেসেজ প্রসেসর (Fast State Management)
bot.on('message', async (msg) => {
    const txt = msg.text;
    if (!txt || txt.startsWith('/')) return;
    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    const { premium, owner } = await getAuthStatus(msg.from.id);

    if (state.step === 'eo' && owner) {
        await Config.findOneAndUpdate({ key: 'off' }, { value: txt }, { upsert: true });
        await State.deleteOne({ chatId: msg.chat.id });
        return bot.sendMessage(msg.chat.id, "✅ অফার আপডেট হয়েছে।");
    }

    if (state.step === 'sz' && premium) {
        await UserProfile.findOneAndUpdate({ userId: msg.from.id.toString() }, { zoneId: txt.trim() }, { upsert: true });
        await State.deleteOne({ chatId: msg.chat.id });
        return bot.sendMessage(msg.chat.id, "✅ Zone ID আপডেট সফল!");
    }

    if (!premium) return;

    let d = state.data;
    switch (state.step) {
        // মুভি পোস্ট ধাপসমূহ
        case 'n': d.n = txt; state.step = 'p'; break;
        case 'p': d.p = txt; state.step = 'l'; break;
        case 'l': d.l = txt; state.step = 'q'; break;
        case 'q': d.q = txt; state.step = 'ml'; break;
        case 'ml': d.ml = txt; state.step = 'dl'; break;
        case 'dl':
            const pid = Date.now().toString().slice(-6);
            await new Post({ postId: pid, name: d.n, poster: d.p, lang: d.l, quality: d.q, movieLink: d.ml, downloadLink: txt }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, `✅ লিঙ্ক জেনারেট হয়েছে:\n${myAppUrl}/post/${pid}?user=${msg.from.id}`);
        
        // ইউজার চ্যানেল ধাপসমূহ
        case 'ucn': d.cn = txt; state.step = 'ucl'; break;
        case 'ucl':
            await UserProfile.updateOne({ userId: msg.from.id.toString() }, { $push: { channels: { name: d.cn, link: txt } } });
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ পার্সোনাল চ্যানেল অ্যাড হয়েছে।");

        // অ্যাডমিন চ্যানেল ধাপসমূহ
        case 'acn': d.cn = txt; state.step = 'acl'; break;
        case 'acl':
            await new AdminChannel({ name: d.cn, link: txt }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ অ্যাডমিন চ্যানেল অ্যাড হয়েছে।");
    }
    state.data = d; await state.save();
    bot.sendMessage(msg.chat.id, "পরবর্তী তথ্য দিন (Cancel করতে /start দিন):");
});

// সরাসরি অ্যাডমিন কমান্ড (Premium Grant)
bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন ${match[2]} দিনের জন্য প্রিমিয়াম।`);
});

// --- Uptime Keep-Alive (বট বন্ধ হওয়া ঠেকাতে) ---
setInterval(() => {
    const http = require('http');
    http.get(myAppUrl.replace('https://', 'http://'));
}, 600000); // প্রতি ১০ মিনিটে একবার পিং করবে

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 বট সচল পোর্টে: ${PORT}`));
