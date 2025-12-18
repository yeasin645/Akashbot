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
    adminUser: process.env.ADMIN_USERNAME || "AdminUsername",
    appUrl: process.env.APP_URL 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেল ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected"));

const Profile = mongoose.model('Profile', new mongoose.Schema({ 
    userId: { type: Number, unique: true }, 
    zoneId: { type: String, default: '10341337' }, // ডিফল্ট জোন আইডি
    adCount: { type: Number, default: 3 },
    channels: { type: Array, default: [] }
}));

const Post = mongoose.model('Post', new mongoose.Schema({ 
    id: String, title: String, image: String, links: Array, 
    zoneId: String, adLimit: Number, channels: Array 
}));

let userState = {};

// --- ৩. বোট লজিক ও বাটন হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    
    bot.sendMessage(chatId, "🎬 **Movie Bot Control Panel**\nআপনার সেটিংস কনফিগার করুন এবং মুভি পোস্ট তৈরি করুন।", {
        reply_markup: {
            inline_keyboard: [
                [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
                [{ text: "🆔 জোন আইডি পরিবর্তন", callback_data: "set_zone" }, { text: "🔢 অ্যাড লিমিট", callback_data: "set_limit" }],
                [{ text: "📢 চ্যানেল যোগ করুন", callback_data: "add_ch" }, { text: "🗑 চ্যানেল ক্লিয়ার", callback_data: "clear_ch" }]
            ]
        }
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    
    if (q.data === "set_zone") {
        userState[chatId] = { step: 'zone' };
        bot.sendMessage(chatId, "আপনার নতুন **Monetag Zone ID** দিন (উদা: 10341337):");
    } else if (q.data === "set_limit") {
        userState[chatId] = { step: 'limit' };
        bot.sendMessage(chatId, "মুভি ডাউনলোডের আগে কয়টি অ্যাড ক্লিক করতে হবে? (সংখ্যা দিন):");
    } else if (q.data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    } else if (q.data === "clear_ch") {
        await Profile.findOneAndUpdate({ userId: chatId }, { channels: [] });
        bot.sendMessage(chatId, "✅ সব চ্যানেল ডিলিট করা হয়েছে।");
    } else if (q.data === "confirm_post") {
        const s = userState[chatId];
        const pf = await Profile.findOne({ userId: chatId });
        const pid = Math.random().toString(36).substring(7);
        
        await new Post({ 
            id: pid, title: s.title, image: s.image, links: s.links, 
            zoneId: pf.zoneId, adLimit: pf.adCount, channels: pf.channels 
        }).save();

        const postUrl = `${config.appUrl}/post/${pid}`;
        bot.sendMessage(chatId, `✅ সফলভাবে পোস্ট তৈরি হয়েছে!\n🔗 লিঙ্ক: ${postUrl}\n\n📝 **চ্যানেল কোড:**\n<code>&lt;a href="${postUrl}"&gt;🎬 Watch ${s.title}&lt;/a&gt;</code>`, { parse_mode: 'HTML' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() });
        bot.sendMessage(chatId, `✅ জোন আইডি **${text}** সেট করা হয়েছে। এখন থেকে আপনার সব পোস্টে এই আইডি এবং Show আইডি কাজ করবে।`); 
        delete userState[chatId];
    } else if (s.step === 'limit') {
        await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) || 3 });
        bot.sendMessage(chatId, "✅ অ্যাড লিমিট আপডেট হয়েছে।"); delete userState[chatId];
    } else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q'; bot.sendMessage(chatId, "কোয়ালিটি (720p/1080p):"); }
    else if (s.step === 'q') { s.tmpQ = text; s.step = 'link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
    else if (s.step === 'link') {
        s.links.push({ q: s.tmpQ, link: text });
        bot.sendMessage(chatId, "আরও লিঙ্ক যোগ করবেন? না হলে Confirm চাপুন।", { 
            reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm & Save", callback_data: "confirm_post" }]] } 
        });
        s.step = 'q';
    }
});

// --- ৪. ল্যান্ডিং পেজ (অ্যাড ট্র্যাকিং ও ডাইনামিক SDK) ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Link Expired or Not Found!");

    res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Download ${p.title}</title>
        
        <script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script>
        
        <style>
            body { background:#0a0a0a; color:#fff; font-family: sans-serif; text-align:center; padding:15px; }
            .card { background:#161616; padding:20px; border-radius:15px; border:1px solid #333; max-width:500px; margin:auto; }
            img { width:100%; border-radius:10px; margin:15px 0; }
            .btn { display:block; background:#e50914; color:#fff; padding:15px; margin:10px 0; text-decoration:none; border-radius:8px; font-weight:bold; cursor:pointer; font-size:18px; border:none; width:100%; }
            .info { background:#222; padding:10px; border-radius:30px; margin-bottom:15px; color:#ff9800; font-weight:bold; }
            .hidden { display:none; }
        </style>
    </head>
    <body>
        <div class="card">
            <h2>${p.title}</h2>
            <img src="${p.image}">
            
            <div class="info">
                Ads Status: <span id="count">0</span> / ${p.adLimit}
            </div>

            <p id="msg">নিচের বাটনে ক্লিক করে অ্যাড লোড করুন।</p>

            <div id="action-area">
                ${p.links.map((l, i) => `
                    <button class="btn unlock-btn" onclick="showAd('${l.link}', ${i})">🔓 Unlock ${l.q}</button>
                    <a href="${l.link}" class="btn hidden dl-link" id="dl-${i}">📥 Download ${l.q}</a>
                `).join('')}
            </div>

            <div style="margin-top:20px;">
                ${p.channels.map(c => `<a href="${c.link}" style="color:#0088cc; display:block; margin:5px;">Join: ${c.name}</a>`).join('')}
            </div>
        </div>

        <script>
            let clicks = 0;
            const target = ${p.adLimit};

            function showAd(url, idx) {
                // মনিটেগ শো আইডি ট্রিগার
                if (typeof show_${p.zoneId} === 'function') {
                    show_${p.zoneId}();
                }

                clicks++;
                document.getElementById('count').innerText = clicks;

                if (clicks >= target) {
                    document.getElementById('msg').innerText = "✅ লিঙ্ক আনলক হয়েছে!";
                    document.getElementById('msg').style.color = "#4caf50";
                    
                    // আনলক বাটন হাইড এবং ডাউনলোড লিঙ্ক শো
                    document.querySelectorAll('.unlock-btn').forEach(b => b.classList.add('hidden'));
                    document.querySelectorAll('.dl-link').forEach(l => l.classList.remove('hidden'));
                } else {
                    alert("বিজ্ঞাপন লোড হয়েছে। আরও " + (target - clicks) + " বার ক্লিক করুন।");
                }
            }
        </script>
    </body>
    </html>
    `);
});

app.listen(process.env.PORT || 3000, () => {
    setInterval(() => { if(config.appUrl) axios.get(config.appUrl).catch(()=>{}); }, 5 * 60 * 1000);
});
