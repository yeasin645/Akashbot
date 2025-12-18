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
    .then(() => console.log("✅ MongoDB Connected: Premium Feature Locking Active!"))
    .catch(err => console.error("❌ MongoDB Error:", err));

// --- Mongoose Schemas ---

const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String, name: String, poster: String, lang: String, quality: String, movieLink: String, downloadLink: String
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: { type: String, unique: true },
    username: String,
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    zoneId: { type: String, default: defaultZoneId },
    channels: [{ name: String, link: String }],
    totalClicks: { type: Number, default: 0 }
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({ name: String, link: String }));
const State = mongoose.model('State', new mongoose.Schema({ chatId: String, step: String, data: Object }));

// --- হেল্পার ফাংশনসমূহ ---

const isAdmin = (msg) => msg.from.id.toString() === adminId;

async function checkPremium(userId) {
    const user = await UserProfile.findOne({ userId });
    if (!user) return false;
    if (user.isPremium && user.premiumExpiry > Date.now()) return true;
    return false;
}

// --- ওয়েব ভিউ (মুভি পেজ) ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ postId: req.params.id });
    const userId = req.query.user;

    if (!post) return res.status(404).send("মুভিটি পাওয়া যায়নি!");

    let userZone = defaultZoneId;
    let isUserActuallyPremium = false;
    let displayChannels = [];

    const adminChs = await AdminChannel.find();
    const profile = userId ? await UserProfile.findOne({ userId }) : null;

    if (profile && profile.isPremium && profile.premiumExpiry > Date.now()) {
        // যদি ইউজার প্রিমিয়াম হয় তবেই তার ডেটা লোড হবে
        isUserActuallyPremium = true;
        userZone = profile.zoneId || defaultZoneId;
        displayChannels = profile.channels.length > 0 ? profile.channels : adminChs;
    } else {
        // ফ্রি ইউজার বা আইডি ছাড়া ভিজিট করলে অ্যাডমিন কনফিগ লোড হবে
        userZone = defaultZoneId;
        displayChannels = adminChs;
    }

    let channelButtons = displayChannels.map(ch => 
        `<a href="${ch.link}" class="btn-ch">${ch.name}</a>`
    ).join('');

    res.send(`
    <!DOCTYPE html>
    <html lang="bn">
    <head>
        <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${post.name}</title>
        ${!isUserActuallyPremium ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}
        <style>
            body { font-family: sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; margin: 0; }
            .card { max-width: 450px; background: #1e293b; margin: auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
            img { width: 100%; height: auto; }
            .p-20 { padding: 20px; }
            .btn { display: block; width: 100%; padding: 15px; margin-top: 10px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 16px; text-decoration: none; box-sizing: border-box; }
            .btn-watch { background: #38bdf8; color: #0f172a; }
            .btn-down { background: #22c55e; color: white; }
            .btn-ch { display: inline-block; background: #475569; color: white; padding: 8px 15px; margin: 5px; border-radius: 5px; font-size: 13px; text-decoration: none; }
            .ch-section { margin-top: 15px; border-top: 1px solid #334155; padding-top: 15px; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${post.poster}">
            <div class="p-20">
                ${isUserActuallyPremium ? '<b style="color:gold;">⭐ প্রিমিয়াম মেম্বার (অ্যাডমুক্ত)</b>' : ''}
                <h2 style="margin:0 0 10px;">${post.name}</h2>
                <p style="font-size:14px; color:#94a3b8;">ভাষা: ${post.lang} | কোয়ালিটি: ${post.quality}</p>
                <button class="btn btn-watch" onclick="start('watch')">অনলাইনে দেখুন</button>
                <button class="btn btn-down" onclick="start('down')">ডাউনলোড করুন</button>
                <div class="ch-section">
                    <p style="font-size:12px; color:#cbd5e1; margin-bottom:10px;">আমাদের সাথে যুক্ত থাকুন:</p>
                    ${channelButtons}
                </div>
            </div>
        </div>
        <script>
            let clicks = ${isUserActuallyPremium ? 3 : 0};
            function start(t) {
                if (clicks < 3) {
                    const zid = "${userZone}";
                    const func = "show_" + zid;
                    if (typeof window[func] === 'function') {
                        window[func]().then(() => { clicks++; fetch('/api/track?user=${userId}'); alert("ধাপ " + clicks + "/৩ সম্পন্ন!"); })
                        .catch(() => { clicks++; });
                    } else { clicks++; alert("বিজ্ঞাপন লোড হচ্ছে..."); }
                } else {
                    const l = (t === 'watch') ? "${post.movieLink}" : "${post.downloadLink}";
                    if(l === 'skip') alert("লিঙ্ক নেই!"); else window.location.href = l;
                }
            }
        </script>
    </body>
    </html>`);
});

app.get('/api/track', async (req, res) => {
    if (req.query.user) await UserProfile.updateOne({ userId: req.query.user }, { $inc: { totalClicks: 1 } });
    res.sendStatus(200);
});

// --- টেলিগ্রাম বট কমান্ডসমূহ ---

bot.onText(/\/start/, async (msg) => {
    await UserProfile.findOneAndUpdate({ userId: msg.from.id.toString() }, { username: msg.from.username }, { upsert: true });
    bot.sendMessage(msg.chat.id, `হ্যালো ${msg.from.first_name}!\nমুভি দেখার বটের সকল ফিচার ব্যবহার করতে /premium চেক করুন।`, { parse_mode: "Markdown" });
});

// --- শুধুমাত্র প্রিমিয়াম মেম্বারদের জন্য লক করা কমান্ডসমূহ ---

bot.onText(/\/setzone (.+)/, async (msg, match) => {
    const isPrem = await checkPremium(msg.from.id.toString());
    if (!isPrem) return bot.sendMessage(msg.chat.id, "❌ দুঃখিত! এই সুবিধাটি শুধুমাত্র প্রিমিয়াম মেম্বারদের জন্য। মেম্বারশিপ নিতে /premium দেখুন।");
    
    await UserProfile.updateOne({ userId: msg.from.id.toString() }, { zoneId: match[1].trim() });
    bot.sendMessage(msg.chat.id, "✅ আপনার Zone ID সেট হয়েছে। এখন থেকে আপনার লিঙ্কের আয় আপনার একাউন্টে যাবে।");
});

bot.onText(/\/addmychannel/, async (msg) => {
    const isPrem = await checkPremium(msg.from.id.toString());
    if (!isPrem) return bot.sendMessage(msg.chat.id, "❌ আপনার চ্যানেলের লিঙ্ক সেট করতে প্রিমিয়াম মেম্বারশিপ প্রয়োজন।");

    await State.findOneAndUpdate({ chatId: msg.chat.id }, { step: 'user_ch_name', data: {} }, { upsert: true });
    bot.sendMessage(msg.chat.id, "📢 আপনার চ্যানেলের নাম লিখুন:");
});

bot.onText(/\/clearchannels/, async (msg) => {
    const isPrem = await checkPremium(msg.from.id.toString());
    if (!isPrem) return;
    await UserProfile.updateOne({ userId: msg.from.id.toString() }, { $set: { channels: [] } });
    bot.sendMessage(msg.chat.id, "✅ আপনার সকল পার্সোনাল চ্যানেল মুছে ফেলা হয়েছে।");
});

// --- পাবলিক কমান্ড ---
bot.onText(/\/stats/, async (msg) => {
    const user = await UserProfile.findOne({ userId: msg.from.id.toString() });
    if (!user) return;
    const isPrem = user.isPremium && user.premiumExpiry > Date.now();
    let txt = `📊 *আপনার প্রোফাইল*\n\n⭐ মেম্বারশিপ: ${isPrem ? "প্রিমিয়াম" : "ফ্রি ইউজার"}\n🛰 Zone ID: \`${isPrem ? user.zoneId : "Default"}\`\n🖱 মোট ক্লিক: ${user.totalClicks}`;
    bot.sendMessage(msg.chat.id, txt, { parse_mode: "Markdown" });
});

bot.onText(/\/premium/, (msg) => {
    const text = "💎 *আমাদের প্রিমিয়াম সুবিধা সমূহ:*\n\n1. মুভি পেজে নিজের বিজ্ঞাপনের জোন আইডি সেট করার ক্ষমতা।\n2. মুভি পেজে নিজের টেলিগ্রাম চ্যানেল দেখানোর সুবিধা।\n3. আপনি নিজে মুভি দেখলে কোনো বিজ্ঞাপন আসবে না।\n\n💰 *পেমেন্ট করতে অ্যাডমিনকে নক দিন:* [এখানে ক্লিক করুন](https://t.me/YourUsername)";
    bot.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
});

// --- অ্যাডমিন কমান্ডসমূহ ---

bot.onText(/\/post/, async (msg) => {
    if (isAdmin(msg)) {
        await State.findOneAndUpdate({ chatId: msg.chat.id }, { step: 'm_name', data: {} }, { upsert: true });
        bot.sendMessage(msg.chat.id, "🎬 মুভির নাম লিখুন:");
    }
});

bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (!isAdmin(msg)) return;
    const uid = match[1];
    const days = parseInt(match[2]);
    const exp = Date.now() + (days * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: uid }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${uid} এখন ${days} দিনের জন্য প্রিমিয়াম মেম্বার।`);
});

bot.onText(/\/setchannel/, async (msg) => {
    if (isAdmin(msg)) {
        await State.findOneAndUpdate({ chatId: msg.chat.id }, { step: 'adm_ch_name', data: {} }, { upsert: true });
        bot.sendMessage(msg.chat.id, "📢 মেইন (অ্যাডমিন) চ্যানেলের নাম:");
    }
});

// মেসেজ হ্যান্ডলার (মাল্টি-স্টেপ লজিক)
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    let d = state.data;
    switch (state.step) {
        // ইউজারের নিজস্ব চ্যানেল অ্যাড
        case 'user_ch_name':
            d.name = text; state.step = 'user_ch_link'; await state.save();
            return bot.sendMessage(msg.chat.id, "🔗 চ্যানেলের লিঙ্ক দিন:");
        case 'user_ch_link':
            await UserProfile.updateOne({ userId: msg.from.id.toString() }, { $push: { channels: { name: d.name, link: text } } });
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ আপনার নিজস্ব চ্যানেল অ্যাড হয়েছে।");

        // অ্যাডমিন চ্যানেল অ্যাড
        case 'adm_ch_name':
            d.name = text; state.step = 'adm_ch_link'; await state.save();
            return bot.sendMessage(msg.chat.id, "🔗 চ্যানেলের লিঙ্ক দিন:");
        case 'adm_ch_link':
            await new AdminChannel({ name: d.name, link: text }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ মেইন চ্যানেল অ্যাড হয়েছে।");

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
            return bot.sendMessage(msg.chat.id, `✅ মুভি সফলভাবে সেভ হয়েছে!\n\nইউজার লিঙ্ক:\n\`${myAppUrl}/post/${pid}?user=${msg.from.id}\``, { parse_mode: "Markdown" });
    }
    state.data = d; await state.save();
    bot.sendMessage(msg.chat.id, "পরবর্তী তথ্য দিন...");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 সার্ভার চালু হয়েছে...`));
