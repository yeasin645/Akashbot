require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const http = require('http');

const app = express();
const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL;
const adminId = process.env.ADMIN_ID;
const mongoUri = process.env.MONGO_URI;
const defaultZoneId = process.env.ZONE_ID || '10341337';

const bot = new TelegramBot(token, { polling: true });

// --- MongoDB কানেকশন ---
mongoose.connect(mongoUri)
    .then(() => console.log("✅ MongoDB Connected! System Optimized."))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Database Schemas ---
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

// --- হেল্পার ফাংশনসমূহ ---
async function getAuth(userId) {
    if (userId.toString() === adminId) return { owner: true, premium: true };
    const user = await UserProfile.findOne({ userId });
    const isPrem = user && user.isPremium && user.premiumExpiry > Date.now();
    return { owner: false, premium: isPrem };
}

async function getMenu(userId) {
    const { owner, premium } = await getAuth(userId);
    let kb = [];
    if (premium || owner) {
        kb.push([{ text: "🎬 মুভি পোস্ট করুন", callback_data: "post_start" }]);
        kb.push([{ text: "🛰 Zone ID সেট", callback_data: "set_zid" }, { text: "📊 পরিসংখ্যান", callback_data: "stats" }]);
        if (owner) kb.push([{ text: "⚙️ প্রিমিয়াম অ্যাড (ID Days)", callback_data: "add_prem_info" }, { text: "📝 অফার এডিট", callback_data: "edit_offer" }]);
    } else {
        kb.push([{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "view_prem" }]);
    }
    kb.push([{ text: "🆔 আমার আইডি", callback_data: "my_id" }]);
    return { reply_markup: { inline_keyboard: kb } };
}

// --- ওয়েব ভিউ (মুভি পেজ উইথ মনিটেগ কাউন্টার) ---
app.get('/post/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ postId: req.params.id });
        const userId = req.query.user;
        if (!post) return res.status(404).send("Movie Not Found");

        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const isPrem = (userId === adminId) || (profile && profile.isPremium && profile.premiumExpiry > Date.now());

        const userZone = (profile && profile.zoneId) ? profile.zoneId : defaultZoneId;
        
        // কোয়ালিটি বাটন জেনারেট
        let qButtons = post.links.map(l => 
            `<button class="btn" onclick="startAd('${l.url}')">${l.quality} - দেখুন</button>`
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
                .p-20 { padding: 20px; }
                .btn { display: block; width: 100%; padding: 15px; margin-top: 10px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; color: white; background: #38bdf8; font-size: 16px; }
                .status { background: rgba(56, 189, 248, 0.1); border: 1px dashed #38bdf8; padding: 10px; border-radius: 10px; margin-bottom: 15px; color: #38bdf8; font-size: 14px; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="${post.poster}">
                <div class="p-20">
                    <div id="ad-step" class="status">${isPrem ? '⭐ প্রিমিয়াম মেম্বার (অ্যাড মুক্ত)' : 'ধাপ: ০/৩ সম্পন্ন করুন'}</div>
                    <h2>${post.name}</h2>
                    <p>ভাষা: ${post.lang}</p>
                    ${qButtons}
                </div>
            </div>
            <script>
                let count = ${isPrem ? 3 : 0};
                let target = "";
                function startAd(url) {
                    target = url;
                    if (count < 3) {
                        const zid = "${userZone}";
                        if (typeof window['show_'+zid] === 'function') {
                            window['show_'+zid]().then(() => { count++; updateUI(); });
                        } else { count++; updateUI(); }
                    } else {
                        if(target === 'skip') alert("Link not found"); else window.location.href = target;
                    }
                }
                function updateUI() {
                    const s = document.getElementById('ad-step');
                    if(s) s.innerText = "ধাপ: " + count + "/৩ সম্পন্ন";
                    if(count >= 3) alert("সব ধাপ সম্পন্ন! মুভি দেখতে আবার বাটনে ক্লিক করুন।");
                }
            </script>
        </body>
        </html>`);
    } catch (e) { res.status(500).send("Error"); }
});

// --- টেলিগ্রাম হ্যান্ডলারস ---

bot.onText(/\/start/, async (msg) => {
    const kb = await getMenu(msg.from.id);
    bot.sendMessage(msg.chat.id, "🎬 *মুভি কন্ট্রোল প্যানেল*\n\nবাটন ব্যবহার করে আপনার কাজ সম্পন্ন করুন।", { parse_mode: "Markdown", ...kb });
});

bot.on('callback_query', async (query) => {
    const chat = query.message.chat.id;
    const user = query.from.id.toString();
    const data = query.data;
    bot.answerCallbackQuery(query.id);

    const { premium, owner } = await getAuth(user);

    if (data === "post_start") {
        if (!premium) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'm_name', data: { links: [] } }, { upsert: true });
        bot.sendMessage(chat, "🎬 ১. মুভির নাম লিখুন:");
    } else if (data === "set_zid") {
        if (!premium) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'set_zid' }, { upsert: true });
        bot.sendMessage(chat, "🛰 আপনার মনিটেগ Zone ID টি পাঠান:");
    } else if (data === "stats") {
        const u = await UserProfile.findOne({ userId: user });
        bot.sendMessage(chat, `📊 *আপনার প্রোফাইল*\n\nZone ID: \`${u ? u.zoneId : 'Default'}\`\nমেম্বারশিপ: ${premium ? "প্রিমিয়াম" : "ফ্রি"}`, { parse_mode: "Markdown" });
    } else if (data === "my_id") {
        bot.sendMessage(chat, `🆔 আপনার আইডি: \`${user}\``, { parse_mode: "Markdown" });
    } else if (data === "view_prem") {
        const c = await Config.findOne({ key: 'offer' });
        bot.sendMessage(chat, c ? c.value : "💎 প্রিমিয়াম হতে অ্যাডমিনকে নক দিন।", { parse_mode: "Markdown" });
    } else if (data === "add_prem_info") {
        if (!owner) return;
        bot.sendMessage(chat, "⚙️ প্রিমিয়াম দিতে টাইপ করুন:\n`/addpremium UserID Days`", { parse_mode: "Markdown" });
    } else if (data === "edit_offer") {
        if (!owner) return;
        await State.findOneAndUpdate({ chatId: chat }, { step: 'edit_off' }, { upsert: true });
        bot.sendMessage(chat, "📝 নতুন অফার টেক্সটটি পাঠান:");
    } else if (data === "add_more_links") {
        const s = await State.findOne({ chatId: chat });
        if (!s) return;
        s.step = 'm_quality';
        await s.save();
        bot.sendMessage(chat, "💿 পরবর্তী কোয়ালিটির নাম লিখুন (উদা: 1080p):");
    } else if (data === "finish_post") {
        const s = await State.findOne({ chatId: chat });
        if (!s) return;
        const pid = Date.now().toString().slice(-6);
        await new Post({ postId: pid, name: s.data.name, poster: s.data.poster, lang: s.data.lang, links: s.data.links }).save();
        await State.deleteOne({ chatId: chat });
        bot.sendMessage(chat, `✅ মুভি সফলভাবে সেভ হয়েছে!\n\n🔗 লিঙ্ক:\n${myAppUrl}/post/${pid}?user=${user}`);
    }
});

// মেসেজ ইনপুট হ্যান্ডলার
bot.on('message', async (msg) => {
    const txt = msg.text;
    if (!txt || txt.startsWith('/')) return;
    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    const { premium, owner } = await getAuth(msg.from.id);

    // অ্যাডমিন সেটিংস
    if (state.step === 'edit_off' && owner) {
        await Config.findOneAndUpdate({ key: 'offer' }, { value: txt }, { upsert: true });
        await State.deleteOne({ chatId: msg.chat.id });
        return bot.sendMessage(msg.chat.id, "✅ অফার আপডেট হয়েছে।");
    }

    if (state.step === 'set_zid' && premium) {
        await UserProfile.findOneAndUpdate({ userId: msg.from.id.toString() }, { zoneId: txt.trim() }, { upsert: true });
        await State.deleteOne({ chatId: msg.chat.id });
        return bot.sendMessage(msg.chat.id, "✅ Zone ID আপডেট সফল।");
    }

    if (!premium) return;

    // মুভি পোস্ট ফ্লো
    let d = state.data;
    switch (state.step) {
        case 'm_name': d.name = txt; state.step = 'm_poster'; break;
        case 'm_poster': d.poster = txt; state.step = 'm_lang'; break;
        case 'm_lang': d.lang = txt; state.step = 'm_quality'; break;
        case 'm_quality':
            if (txt.toLowerCase() === 'skip') {
                d.links.push({ quality: 'Download', url: 'skip' });
                state.step = 'ask_done';
            } else {
                d.temp_q = txt;
                state.step = 'm_url';
                return bot.sendMessage(msg.chat.id, `🔗 "${txt}" এর লিঙ্কটি দিন (না থাকলে skip লিখুন):`);
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
        return bot.sendMessage(msg.chat.id, "✅ লিঙ্ক যোগ হয়েছে। আপনি কি আরও কোয়ালিটি যোগ করতে চান?", finishKb);
    }

    state.data = d; await state.save();
    const prompts = { 'm_poster': "🖼 ২. পোস্টার লিঙ্ক দিন:", 'm_lang': "🌐 ৩. মুভির ভাষা:", 'm_quality': "💿 ৪. কোয়ালিটির নাম লিখুন (বা skip লিখুন):" };
    bot.sendMessage(msg.chat.id, prompts[state.step]);
});

bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন ${match[2]} দিনের জন্য প্রিমিয়াম।`);
});

// রেন্ডার স্লিপ প্রিভেন্টার (১০ মিনিট অন্তর পিং)
setInterval(() => { http.get(myAppUrl); }, 600000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 সার্ভার চালু পোর্টে: ${PORT}`));
