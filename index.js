const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (Render-এ অবশ্যই এগুলো সেট করবেন) ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME, 
    appUrl: process.env.APP_URL, 
    dbVersion: "25.0" 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস কানেকশন ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ Database Connected!")).catch(err => console.log("DB Error:", err));

// --- ৩. ডাটা মডেলসমূহ ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ userId: Number, zoneId: {type: String, default: '10341337'}, adCount: { type: Number, default: 3 }, channels: { type: Array, default: [] } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, links: Array, zoneId: String, adLimit: Number, channels: Array }));

let userState = {};

// প্রিমিয়াম চেক ফাংশন
async function isPremium(id) {
    if (id === config.adminId) return true;
    const p = await Premium.findOne({ userId: id });
    if (!p) return false;
    if (new Date() > p.expiry) { await Premium.deleteOne({ userId: id }); return false; }
    return true;
}

// বাটন মেনু জেনারেটর
function getMenu(chatId) {
    let btns = [
        [{ text: "🎬 মুভি পোস্ট ও কোড তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটিংস 🔒", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি 🔒", callback_data: "set_zone" }],
        [{ text: "🔢 অ্যাড লিমিট 🔒", callback_data: "set_ad_limit" }, { text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === config.adminId) {
        btns.push(
            [{ text: "📊 পরিসংখ্যান (Admin)", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড (Admin)", callback_data: "add_p" }],
            [{ text: "🗑 মেম্বার ডিলিট (Admin)", callback_data: "del_p" }]
        );
    }
    return { inline_keyboard: btns };
}

const ownerBtn = { inline_keyboard: [[{ text: "💬 ওনারকে মেসেজ দিন", url: `https://t.me/${config.adminUser}` }]] };

// --- ৪. কমান্ড ও বাটন অ্যাকশন ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id, name: msg.from.first_name }, { upsert: true });
    bot.sendMessage(msg.chat.id, "🎬 **Movie Master Final Panel**\nআপনার প্রয়োজনীয় অপশনটি সিলেক্ট করুন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(msg.chat.id) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    // লকিং সিস্টেম
    const locked = ["start_post", "setup_ch", "set_zone", "set_ad_limit"];
    if (locked.includes(q.data) && !isP) {
        return bot.sendMessage(chatId, "🛑 **দুঃখিত! এই ফিচারটি শুধু প্রিমিয়াম মেম্বারদের জন্য।**\nনিচের বাটন থেকে ওনারের সাথে যোগাযোগ করুন।", { reply_markup: ownerBtn });
    }

    if (q.data === "add_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_p_id' };
        bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার **Telegram ID** দিন:");
    }
    else if (q.data === "view_stats" && chatId === config.adminId) {
        const u = await User.countDocuments(); const p = await Premium.countDocuments();
        bot.sendMessage(chatId, `📊 **পরিসংখ্যান:**\n👥 মোট ইউজার: ${u}\n💎 প্রিমিয়াম মেম্বার: ${p}`);
    }
    else if (q.data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    }
    else if (q.data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const pr = await Profile.findOne({ userId: chatId }) || { zoneId: '10341337', adCount: 3, channels: [] };
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: pr.zoneId, adLimit: pr.adCount, channels: pr.channels }).save();
        
        // HTML কোড জেনারেশন
        const qBtns = s.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - আনলক</button>`).join('\n');
        const chLinks = pr.channels.map(c => `<a href="${c.link}" class="ch-link">${c.name}</a>`).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${pr.zoneId}' data-sdk='show_${pr.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;}</style></head><body><div class="card"><img src="${s.image}"><h2>${s.title}</h2><div style="margin-bottom:15px">${chLinks}</div><hr><div id="st">${pr.adCount}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${pr.adCount}){if(typeof window['show_'+'${pr.zoneId}'] === 'function'){window['show_'+'${pr.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${pr.adCount}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
        
        bot.sendMessage(chatId, `✅ **সফলভাবে তৈরি হয়েছে!**\n\n🌐 **Preview:** ${config.appUrl}/post/${id}\n\n📄 **কোডটি কপি করুন:**`);
        bot.sendMessage(chatId, `\`\`\`html\n${html}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৫. মেসেজ ও ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text;
    if (!text || text.startsWith('/')) return;
    
    const s = userState[chatId];
    if (!s) return;

    // মেম্বার অ্যাড স্টেপ
    if (s.step === 'add_p_id') { 
        s.pUserId = text.trim(); 
        s.step = 'add_p_days'; 
        bot.sendMessage(chatId, "কত দিনের জন্য দিবেন? (শুধু সংখ্যা দিন):"); 
    }
    else if (s.step === 'add_p_days') {
        const days = parseInt(text);
        if (isNaN(days)) return bot.sendMessage(chatId, "❌ ভুল! শুধু সংখ্যা লিখুন।");
        const targetUser = await User.findOne({ userId: parseInt(s.pUserId) });
        const expiryDate = moment().add(days, 'days').tz("Asia/Dhaka");
        await Premium.findOneAndUpdate({ userId: parseInt(s.pUserId) }, { expiry: expiryDate.toDate() }, { upsert: true });
        
        bot.sendMessage(chatId, `✅ সফল! ID: ${s.pUserId} কে প্রিমিয়াম দেওয়া হয়েছে।`);
        const notif = `🎊 **অভিনন্দন! আপনি প্রিমিয়াম মেম্বারশিপ পেয়েছেন** 🎊\n\n👤 **নাম:** ${targetUser ? targetUser.name : 'ইউজার'}\n🆔 **ID:** \`${s.pUserId}\` \n⏳ **মেয়াদ:** ${days} দিন\n📅 **শেষ হবে:** ${expiryDate.format('DD-MM-YYYY hh:mm A')}`;
        bot.sendMessage(s.pUserId, notif, { parse_mode: 'Markdown' }).catch(() => {});
        delete userState[chatId];
    }
    // মুভি পোস্ট স্টেপ
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "মুভি লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        s.step = 'q_name';
        bot.sendMessage(chatId, "আরও কোয়ালিটি অ্যাড করবেন? নাহলে নিচের বাটনে ক্লিক করুন।", {
            reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm & Finish", callback_data: "confirm" }]] }
        });
    }
});

// --- ৬. সার্ভার ও Anti-Sleep সিস্টেম ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id }); 
    if (!p) return res.status(404).send("Not Found");
    const qBtns = p.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - ডাউনলোড</button>`).join('');
    const chLinks = p.channels.map(c => `<a href="${c.link}" target="_blank" class="ch-link">${c.name}</a>`).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;}</style></head><body><div class="card"><img src="${p.image}"><h2>${p.title}</h2><div style="margin-bottom:15px">${chLinks}</div><hr><div id="st">${p.adLimit}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${p.adLimit}){if(typeof window['show_'+'${p.zoneId}'] === 'function'){window['show_'+'${p.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${p.adLimit}";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot Active 🚀"));

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running...");
    if (config.appUrl) {
        cron.schedule('*/5 * * * *', () => {
            axios.get(config.appUrl).then(() => console.log("Ping Success")).catch(() => {});
        });
    }
});
