require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');

const app = express();
const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL;
const adminId = process.env.ADMIN_ID; // আপনার টেলিগ্রাম আইডি
const mongoUri = process.env.MONGO_URI;
const defaultZoneId = process.env.ZONE_ID || '10341337';

const bot = new TelegramBot(token, { polling: true });

// --- MongoDB কানেকশন ---
mongoose.connect(mongoUri)
    .then(() => console.log("✅ MongoDB Connected! Permission Locking Enabled."))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- Database Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    postId: String, name: String, poster: String, lang: String, quality: String, movieLink: String, downloadLink: String
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: { type: String, unique: true },
    isPremium: { type: Boolean, default: false },
    premiumExpiry: Date,
    zoneId: { type: String, default: defaultZoneId },
    channels: [{ name: String, link: String }]
}));

const AdminChannel = mongoose.model('AdminChannel', new mongoose.Schema({ name: String, link: String }));
const State = mongoose.model('State', new mongoose.Schema({ chatId: String, step: String, data: Object }));

// --- পারমিশন ফিল্টার (Main Security) ---
async function isAuthorized(userId) {
    if (userId.toString() === adminId) return true; // Owner ইজ অলওয়েজ অথোরাইজড
    const user = await UserProfile.findOne({ userId });
    return user && user.isPremium && user.premiumExpiry > Date.now();
}

// --- ওয়েব ভিউ (মুভি পেজ) ---
app.get('/post/:id', async (req, res) => {
    try {
        const post = await Post.findOne({ postId: req.params.id });
        const userId = req.query.user;
        if (!post) return res.status(404).send("মুভি পাওয়া যায়নি!");

        // চেক করা হচ্ছে যে শেয়ারকারী ইউজার প্রিমিয়াম কি না
        const profile = userId ? await UserProfile.findOne({ userId }) : null;
        const isPrem = (userId === adminId) || (profile && profile.isPremium && profile.premiumExpiry > Date.now());

        const userZone = (isPrem && profile && profile.zoneId) ? profile.zoneId : defaultZoneId;
        const adminChs = await AdminChannel.find();
        const displayChannels = (isPrem && profile && profile.channels.length > 0) ? profile.channels : adminChs;

        let channelButtons = displayChannels.map(ch => 
            `<a href="${ch.link}" class="btn-ch">${ch.name}</a>`
        ).join('');

        res.send(`
        <!DOCTYPE html>
        <html lang="bn">
        <head>
            <meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${post.name}</title>
            ${!isPrem ? `<script src='//libtl.com/sdk.js' data-zone='${userZone}' data-sdk='show_${userZone}'></script>` : ''}
            <style>
                body { font-family: sans-serif; background: #0f172a; color: white; text-align: center; padding: 20px; }
                .card { max-width: 450px; background: #1e293b; margin: auto; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
                img { width: 100%; height: auto; border-bottom: 2px solid #38bdf8; }
                .p-20 { padding: 20px; }
                .btn { display: block; width: 100%; padding: 15px; margin-top: 10px; border: none; border-radius: 10px; font-weight: bold; cursor: pointer; text-decoration: none; color: white; font-size: 16px; }
                .btn-watch { background: #38bdf8; color: #0f172a; }
                .btn-down { background: #22c55e; }
                .btn-ch { display: inline-block; background: #475569; padding: 8px 15px; margin: 5px; border-radius: 5px; text-decoration: none; color: white; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="card">
                <img src="${post.poster}">
                <div class="p-20">
                    ${isPrem ? '<b style="color:gold;">⭐ প্রিমিয়াম মেম্বার মুভি</b>' : ''}
                    <h2>${post.name}</h2>
                    <p>ভাষা: ${post.lang} | কোয়ালিটি: ${post.quality}</p>
                    <button class="btn btn-watch" onclick="startAd('watch')">অনলাইনে দেখুন</button>
                    <button class="btn btn-down" onclick="startAd('down')">ডাউনলোড করুন</button>
                    <div style="margin-top:20px;">${channelButtons}</div>
                </div>
            </div>
            <script>
                let clicks = ${isPrem ? 3 : 0};
                function startAd(t) {
                    if (clicks < 3) {
                        const zid = "${userZone}";
                        if (typeof window['show_'+zid] === 'function') {
                            window['show_'+zid]().then(() => { clicks++; alert("ধাপ " + clicks + "/৩ সম্পন্ন!"); });
                        } else { clicks++; alert("বিজ্ঞাপন লোড হচ্ছে..."); }
                    } else {
                        const l = (t === 'watch') ? "${post.movieLink}" : "${post.downloadLink}";
                        if(l === 'skip') alert("লিঙ্ক নেই!"); else window.location.href = l;
                    }
                }
            </script>
        </body>
        </html>`);
    } catch (e) { res.status(500).send("সার্ভার এরর!"); }
});

// --- টেলিগ্রাম বট কমান্ডসমূহ ---

// ১. স্টার্ট (সবার জন্য উন্মুক্ত)
bot.onText(/\/start/, async (msg) => {
    const auth = await isAuthorized(msg.from.id);
    if (!auth) {
        return bot.sendMessage(msg.chat.id, "❌ *বটটি প্রাইভেট!*\n\nএই বটটি ব্যবহারের অনুমতি আপনার নেই। শুধুমাত্র প্রিমিয়াম মেম্বাররাই এটি ব্যবহার করতে পারেন।\n\nমেম্বারশিপ নিতে অ্যাডমিনকে নক দিন: [অ্যাডমিন](https://t.me/YourUsername)", { parse_mode: "Markdown", disable_web_page_preview: true });
    }
    bot.sendMessage(msg.chat.id, "✅ স্বাগতম! আপনি একজন প্রিমিয়াম ইউজার।\n\nআপনি এখন /post, /setzone এবং /addmychannel ব্যবহার করতে পারবেন।");
});

// ২. প্রিমিয়াম/ওনার কমান্ডসমূহ (লক করা)
bot.onText(/\/setzone (.+)/, async (msg, match) => {
    if (!(await isAuthorized(msg.from.id))) return;
    await UserProfile.findOneAndUpdate({ userId: msg.from.id.toString() }, { zoneId: match[1].trim() }, { upsert: true });
    bot.sendMessage(msg.chat.id, "✅ আপনার পার্সোনাল Zone ID সেট হয়েছে।");
});

bot.onText(/\/addmychannel/, async (msg) => {
    if (!(await isAuthorized(msg.from.id))) return;
    await State.findOneAndUpdate({ chatId: msg.chat.id }, { step: 'user_ch_name', data: {} }, { upsert: true });
    bot.sendMessage(msg.chat.id, "📢 আপনার চ্যানেলের নাম লিখুন:");
});

// ৩. শুধুমাত্র ওনার কমান্ড (অ্যাডমিন প্রিমিয়াম অ্যাড করবে)
bot.onText(/\/addpremium (\d+) (\d+)/, async (msg, match) => {
    if (msg.from.id.toString() !== adminId) return;
    const exp = Date.now() + (parseInt(match[2]) * 24 * 60 * 60 * 1000);
    await UserProfile.findOneAndUpdate({ userId: match[1] }, { isPremium: true, premiumExpiry: exp }, { upsert: true });
    bot.sendMessage(msg.chat.id, `✅ ইউজার ${match[1]} এখন ${match[2]} দিনের জন্য প্রিমিয়াম মেম্বার।`);
});

bot.onText(/\/post/, async (msg) => {
    if (!(await isAuthorized(msg.from.id))) return;
    await State.findOneAndUpdate({ chatId: msg.chat.id }, { step: 'm_name', data: {} }, { upsert: true });
    bot.sendMessage(msg.chat.id, "🎬 মুভির নাম লিখুন:");
});

// মেসেজ হ্যান্ডলার (ইনপুট প্রসেসিং + লক)
bot.on('message', async (msg) => {
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    // প্রিমিয়াম চেক
    if (!(await isAuthorized(msg.from.id))) return;

    const state = await State.findOne({ chatId: msg.chat.id });
    if (!state) return;

    let d = state.data;
    switch (state.step) {
        case 'user_ch_name':
            d.name = text; state.step = 'user_ch_link'; await state.save();
            return bot.sendMessage(msg.chat.id, "🔗 চ্যানেলের লিঙ্ক দিন:");
        case 'user_ch_link':
            await UserProfile.updateOne({ userId: msg.from.id.toString() }, { $push: { channels: { name: d.name, link: text } } });
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, "✅ চ্যানেল অ্যাড হয়েছে।");

        case 'm_name': d.name = text; state.step = 'm_poster'; break;
        case 'm_poster': d.poster = text; state.step = 'm_lang'; break;
        case 'm_lang': d.lang = text; state.step = 'm_quality'; break;
        case 'm_quality': d.quality = text; state.step = 'm_link'; break;
        case 'm_link': d.movieLink = text; state.step = 'm_down'; break;
        case 'm_down':
            const pid = Date.now().toString().slice(-6);
            await new Post({ postId: pid, ...d, downloadLink: text }).save();
            await State.deleteOne({ chatId: msg.chat.id });
            return bot.sendMessage(msg.chat.id, `✅ লিঙ্ক:\n${myAppUrl}/post/${pid}?user=${msg.from.id}`);
    }
    state.data = d; await state.save();
    bot.sendMessage(msg.chat.id, "পরবর্তী তথ্য দিন:");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Private Bot running on port ${PORT}`));
