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
    .then(() => console.log("✅ MongoDB Connected with Dashboard Support!"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Schemas ---
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

// --- Security Helper ---
async function isAuthorized(userId) {
    if (userId.toString() === adminId) return true;
    const user = await UserProfile.findOne({ userId });
    return user && user.isPremium && user.premiumExpiry > Date.now();
}

// --- Web View (Same logic as before) ---
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

        let channelButtons = displayChannels.map(ch => `<a href="${ch.link}" style="display:inline-block;background:#475569;padding:8px 12px;margin:5px;border-radius:5px;color:white;text-decoration:none;font-size:12px;">${ch.name}</a>`).join('');

        res.send(`<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${post.name}</title>${!isPrem ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}<style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{max-width:450px;background:#1e293b;margin:auto;border-radius:20px;overflow:hidden;box-shadow:0 10px 30px rgba(0,0,0,0.5);}img{width:100%;height:auto;}.p-20{padding:20px;}.btn{display:block;width:100%;padding:15px;margin-top:10px;border:none;border-radius:10px;font-weight:bold;cursor:pointer;text-decoration:none;color:white;font-size:16px;}.btn-watch{background:#38bdf8;color:#0f172a;}.btn-down{background:#22c55e;}</style></head><body><div class="card"><img src="${post.poster}"><div class="p-20">${isPrem ? '<b style="color:gold;">⭐ PREMIUM</b>' : ''}<h2>${post.name}</h2><p>${post.lang} | ${post.quality}</p><button class="btn btn-watch" onclick="startAd('watch')">WATCH ONLINE</button><button class="btn btn-down" onclick="startAd('down')">DOWNLOAD</button><div style="margin-top:20px;">${channelButtons}</div></div></div><script>let clicks = ${isPrem ? 3 : 0};function startAd(t){if(clicks<3){const zid="${userZone}";if(typeof window['show_'+zid]==='function'){window['show_'+zid]().then(()=>{clicks++;alert("Step "+clicks+"/3 Done");});}else{clicks++;alert("Ad Loading...");}}else{const l=(t==='watch')?"${post.movieLink}":"${post.downloadLink}";if(l==='skip')alert("Link Missing");else window.location.href=l;}}</script></body></html>`);
    } catch (e) { res.status(500).send("Server Error"); }
});

// --- Telegram Dashboard ---

bot.onText(/\/start/, async (msg) => {
    const isOwner = msg.from.id.toString() === adminId;
    const isPrem = await isAuthorized(msg.from.id);

    if (isOwner) {
        // ওনারের জন্য বাটন মেনু
        const adminKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "🎬 নতুন মুভি পোস্ট করুন", callback_data: "admin_post" }],
                    [{ text: "💎 প্রিমিয়াম মেম্বার অ্যাড", callback_data: "admin_add_premium" }, { text: "📢 মেইন চ্যানেল সেট", callback_data: "admin_set_channel" }],
                    [{ text: "📝 অফার টেক্সট এডিট", callback_data: "admin_edit_offer" }],
                    [{ text: "🛰 Zone ID সেট (নিজের)", callback_data: "user_set_zone" }, { text: "📊 পরিসংখ্যান", callback_data: "user_stats" }]
                ]
            }
        };
        bot.sendMessage(msg.chat.id, "🛠 *অ্যাডমিন ড্যাশবোর্ড*\nনিচের বাটনগুলো ব্যবহার করে বট নিয়ন্ত্রণ করুন।", { parse_mode: "Markdown", ...adminKeyboard });
    } else {
        // সাধারণ ইউজার বা প্রিমিয়াম ইউজারের জন্য বাটন
        const userKeyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: "💎 প্রিমিয়াম সুবিধা", callback_data: "user_premium" }, { text: "🆔 আমার আইডি", callback_data: "user_myid" }],
                    (isPrem ? [{ text: "🎬 মুভি পোস্ট", callback_data: "admin_post" }, { text: "🛰 Zone ID সেট", callback_data: "user_set_zone" }] : []),
                    (isPrem ? [{ text: "📊 আমার পরিসংখ্যান", callback_data: "user_stats" }] : [])
                ].filter(row => row.length > 0)
            }
        };
        bot.sendMessage(msg.chat.id, "👋 *স্বাগতম!*\nএই বটের ফিচারগুলো ব্যবহার করতে নিচের মেনু দেখুন।", { parse_mode: "Markdown", ...userKeyboard });
    }
});

// --- Callback Query Handler (বাটন ক্লিক হ্যান্ডলার) ---
bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id.toString();
    const action = query.data;

    // ক্লিকের উত্তর দেওয়া (Telegram requirement)
    bot.answerCallbackQuery(query.id);

    // ১. প্রিমিয়াম ইউজার/ওনার চেক ফর অ্যাকশন
    const isAuth = await isAuthorized(userId);

    switch (action) {
        case "admin_post":
            if (!isAuth) return bot.sendMessage(chatId, "❌ মেম্বারশিপ প্রয়োজন!");
            await State.findOneAndUpdate({ chatId }, { step: 'm_name', data: {} }, { upsert: true });
            bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
            break;

        case "admin_add_premium":
            if (userId !== adminId) return;
            bot.sendMessage(chatId, "🛠 মেম্বার অ্যাড করতে টাইপ করুন: \n`/addpremium ইউজারআইডি দিন` \n\nউদাহরণ: `/addpremium 1234567 30`", { parse_mode: "Markdown" });
            break;

        case "admin_set_channel":
            if (userId !== adminId) return;
            await State.findOneAndUpdate({ chatId }, { step: 'adm_ch_name', data: {} }, { upsert: true });
            bot.sendMessage(chatId, "📢 মেইন চ্যানেলের নাম দিন:");
            break;

        case "admin_edit_offer":
            if (userId !== adminId) return;
            await State.findOneAndUpdate({ chatId }, { step: 'set_offer_text' }, { upsert: true });
            bot.sendMessage(chatId, "📝 নতুন প্রিমিয়াম অফার টেক্সটটি লিখে পাঠান:");
            break;

        case "user_set_zone":
            if (!isAuth) return;
            bot.sendMessage(chatId, "🛰 আপনার Zone ID সেট করতে টাইপ করুন: \n`/setzone আপনারআইডি`", { parse_mode: "Markdown" });
            break;

        case "user_stats":
            if (!isAuth) return;
            const profile = await UserProfile.findOne({ userId });
            bot.sendMessage(chatId, `📊 *স্ট্যাটাস*\n\nZone ID: \`${profile.zoneId}\`\nমোট ক্লিক: ${profile.totalClicks}`, { parse_mode: "Markdown" });
            break;

        case "user_myid":
            bot.sendMessage(chatId, `🆔 আপনার আইডি: \`${userId}\``, { parse_mode: "Markdown" });
            break;

        case "user_premium":
            const offer = await Config.findOne({ key: 'premium_offer' });
            bot.sendMessage(chatId, offer ? offer.value : "💎 প্রিমিয়াম সুবিধা পেতে অ্যাডমিনকে নক দিন।", { parse_mode: "Markdown" });
            break;
    }
});

// --- মেসেজ হ্যান্ডলার (ইনপুট প্রসেসিং) ---
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    // ১. অ্যাডমিন অফার টেক্সট আপডেট
    if (state.step === 'set_offer_text' && msg.from.id.toString() === adminId) {
        await Config.findOneAndUpdate({ key: 'premium_offer' }, { value: text }, { upsert: true });
        await State.deleteOne({ chatId: msg.chat.id });
        return bot.sendMessage(msg.chat.id, "✅ প্রিমিয়াম অফার আপডেট হয়েছে।");
    }

    // ২. প্রিমিয়াম ইউজার চেক
    if (!(await isAuthorized(msg.from.id))) return;

    let d = state.data;
    switch (state.step) {
        // অ্যাডমিন চ্যানেল সেট
        case 'adm_ch_name': d.name = text; state.step = 'adm_ch_link'; break;
        case 'adm_ch_link':
            await new AdminChannel({ name: d.name, link: text }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ মেইন চ্যানেল সেট হয়েছে।");

        // মুভি পোস্ট
        case 'm_name': d.name = text; state.step = 'm_poster'; break;
        case 'm_poster': d.poster = text; state.step = 'm_lang'; break;
        case 'm_lang': d.lang = text; state.step = 'm_quality'; break;
        case 'm_quality': d.quality = text; state.step = 'm_link'; break;
        case 'm_link': d.movieLink = text; state.step = 'm_down'; break;
        case 'm_down':
            const pid = Date.now().toString().slice(-6);
            await new Post({ postId: pid, ...d, downloadLink: text }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, `✅ লিঙ্ক তৈরি হয়েছে:\n${myAppUrl}/post/${pid}?user=${msg.from.id}`);
    }
    state.data = d; await state.save();
    bot.sendMessage(msg.chat.id, "পরবর্তী তথ্য দিন (Cancel করতে /start দিন):");
});

// সরাসরি কমান্ড হ্যান্ডলার (Manual commands)
bot.onText(/\/setzone (.+)/, async (msg, match) => {
    if (!(await isAuthorized(msg.from.id))) return;
    await UserProfile.findOneAndUpdate({ userId: msg.from.id.toString() }, { zoneId: match[1].trim() }, { upsert: true });
    bot.sendMessage(msg.chat.id, "✅ Zone ID সেট হয়েছে।");
});

bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন প্রিমিয়াম মেম্বার।`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 সার্ভার চালু হয়েছে ${PORT} পোর্টে`));
