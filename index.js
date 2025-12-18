const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME, 
    appUrl: process.env.APP_URL, 
    dbVersion: "30.0" // রিভিশন ভার্সন
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস ও মডেল ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected")).catch(e => console.log(e));

const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ 
    userId: Number, 
    zoneId: {type: String, default: '10341337'}, 
    adCount: { type: Number, default: 3 }, 
    channels: { type: Array, default: [] } 
}));
const Post = mongoose.model('Post', new mongoose.Schema({ 
    id: String, creatorId: Number, title: String, image: String, links: Array, 
    zoneId: String, adLimit: Number, channels: Array 
}));

let userState = {};

// প্রিমিয়াম চেক লজিক
async function isPremium(id) {
    if (id === config.adminId) return true;
    const p = await Premium.findOne({ userId: id });
    if (!p) return false;
    if (new Date() > p.expiry) { 
        await Premium.deleteOne({ userId: id }); 
        return false; 
    }
    return true;
}

// বাটন লেআউট
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

// --- ৩. কমান্ড ও বাটন হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id, name: msg.from.first_name }, { upsert: true });
    bot.sendMessage(msg.chat.id, "🎬 **Movie Master Pro Panel**\nআপনার প্রয়োজনীয় অপশনটি বেছে নিন।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(msg.chat.id) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    // লকিং ও ওনার কন্টাক্ট সিস্টেম
    if (["start_post", "setup_ch", "set_zone", "set_ad_limit"].includes(q.data) && !isP) {
        return bot.sendMessage(chatId, "🛑 **এই ফিচারটি শুধুমাত্র প্রিমিয়াম ইউজারদের জন্য!**\n\nপ্রিমিয়াম নিতে নিচের বাটনে ক্লিক করে ওনারকে মেসেজ দিন।", { reply_markup: ownerBtn });
    }

    if (q.data === "add_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'add_p_id' };
        bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার **Telegram ID** দিন:");
    }
    else if (q.data === "del_p" && chatId === config.adminId) {
        userState[chatId] = { step: 'del_p_id' };
        bot.sendMessage(chatId, "যার প্রিমিয়াম বাতিল করবেন তার **ID** দিন:");
    }
    else if (q.data === "view_stats" && chatId === config.adminId) {
        const u = await User.countDocuments(); const p = await Premium.countDocuments();
        bot.sendMessage(chatId, `📊 **লাইভ পরিসংখ্যান:**\n👥 মোট ইউজার: ${u}\n💎 প্রিমিয়াম মেম্বার: ${p}`);
    }
    else if (q.data === "setup_ch") {
        const pr = await Profile.findOne({ userId: chatId });
        let txt = "📢 **আপনার চ্যানেলসমূহ:**\n";
        if (!pr || !pr.channels.length) txt += "বর্তমানে কোনো চ্যানেল নেই।"; 
        else pr.channels.forEach((c, i) => txt += `${i+1}. ${c.name}\n`);
        bot.sendMessage(chatId, txt, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_new_ch" }], [{ text: "🗑 সব মুছুন", callback_data: "clear_ch" }]] } });
    }
    else if (q.data === "add_new_ch") { userState[chatId] = { step: 'ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম লিখুন:"); }
    else if (q.data === "clear_ch") { await Profile.findOneAndUpdate({ userId: chatId }, { channels: [] }); bot.sendMessage(chatId, "✅ সব চ্যানেল মোছা হয়েছে।"); }
    else if (q.data === "set_zone") { userState[chatId] = { step: 'zone' }; bot.sendMessage(chatId, "Adsterra Zone ID দিন:"); }
    else if (q.data === "set_ad_limit") { userState[chatId] = { step: 'ad_limit' }; bot.sendMessage(chatId, "অ্যাড লিমিট দিন (উদা: ৩):"); }
    else if (q.data === "start_post") { userState[chatId] = { step: 'title', links: [] }; bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:"); }
    else if (q.data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const pr = await Profile.findOne({ userId: chatId }) || { zoneId: '10341337', adCount: 3, channels: [] };
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: pr.zoneId, adLimit: pr.adCount, channels: pr.channels }).save();
        
        // HTML কোড জেনারেটর (Markdown Code Block এ)
        const qBtns = s.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - আনলক</button>`).join('\n');
        const chLinks = pr.channels.map(c => `<a href="${c.link}" class="ch-link">${c.name}</a>`).join('');
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${pr.zoneId}' data-sdk='show_${pr.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;}</style></head><body><div class="card"><img src="${s.image}"><h2>${s.title}</h2><div style="margin-bottom:15px">${chLinks}</div><hr><div id="st">${pr.adCount}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${pr.adCount}){if(typeof window['show_'+'${pr.zoneId}'] === 'function'){window['show_'+'${pr.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${pr.adCount}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
        
        bot.sendMessage(chatId, `✅ **সফল!**\n\n🌐 **Preview:** ${config.appUrl}/post/${id}\n\n📄 **নিচের কোডটি কপি করুন:**`);
        bot.sendMessage(chatId, `\`\`\`html\n${html}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. মেসেজ ও স্মার্ট ইনপুট লজিক ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id; const text = msg.text; if (!text || text.startsWith('/')) return;
    const s = userState[chatId]; if (!s) return;

    // মেম্বার অ্যাড রিভিশন
    if (s.step === 'add_p_id') { s.pUserId = text.trim(); s.step = 'add_p_days'; bot.sendMessage(chatId, "কত দিনের জন্য দিবেন? (সংখ্যা দিন):"); }
    else if (s.step === 'add_p_days') {
        const days = parseInt(text);
        const target = await User.findOne({ userId: parseInt(s.pUserId) });
        const expiryDate = moment().add(days, 'days').tz("Asia/Dhaka");
        await Premium.findOneAndUpdate({ userId: parseInt(s.pUserId) }, { expiry: expiryDate.toDate() }, { upsert: true });
        bot.sendMessage(chatId, `✅ সফল! ${s.pUserId} এখন প্রিমিয়াম।`);
        const nTxt = `🎊 **অভিনন্দন! আপনি প্রিমিয়াম পেয়েছেন** 🎊\n\n👤 **নাম:** ${target ? target.name : 'ইউজার'}\n⏳ **মেয়াদ:** ${days} দিন\n📅 **শেষ হবে:** ${expiryDate.format('DD-MM-YYYY hh:mm A')}`;
        bot.sendMessage(s.pUserId, nTxt, { parse_mode: 'Markdown' }).catch(() => {});
        delete userState[chatId];
    }
    // মেম্বার ডিলিট রিভিশন
    else if (s.step === 'del_p_id') {
        await Premium.deleteOne({ userId: parseInt(text.trim()) });
        bot.sendMessage(chatId, `❌ ID: ${text} এর প্রিমিয়াম বাতিল করা হয়েছে।`);
        delete userState[chatId];
    }
    // চ্যানেল ও সেটিংস রিভিশন
    else if (s.step === 'ch_name') { s.cN = text; s.step = 'ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক দিন:"); }
    else if (s.step === 'ch_link') { await Profile.findOneAndUpdate({ userId: chatId }, { $push: { channels: { name: s.cN, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভড।"); delete userState[chatId]; }
    else if (s.step === 'zone') { await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ জোন আইডি আপডেট হয়েছে।"); delete userState[chatId]; }
    else if (s.step === 'ad_limit') { await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) }, { upsert: true }); bot.sendMessage(chatId, "✅ অ্যাড লিমিট আপডেট হয়েছে।"); delete userState[chatId]; }
    // মুভি পোস্ট রিভিশন
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text }); s.step = 'q_name';
        bot.sendMessage(chatId, "আরও কোয়ালিটি অ্যাড করবেন? নাহলে নিচে ক্লিক করুন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } });
    }
});

// --- ৫. অলওয়েজ অনলাইন (Keep-Alive) ও সার্ভার ---
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id }); if (!p) return res.send("Not Found");
    const qBtns = p.links.map(l => `<button class="btn" onclick="startAd('${l.link}')">${l.q} - ডাউনলোড</button>`).join('');
    const chLinks = p.channels.map(c => `<a href="${c.link}" target="_blank" class="ch-link">${c.name}</a>`).join('');
    res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><script src='//libtl.com/sdk.js' data-zone='${p.zoneId}' data-sdk='show_${p.zoneId}'></script><style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:15px;}.card{background:#1e293b;padding:20px;border-radius:15px;max-width:400px;margin:auto;}img{width:100%;border-radius:10px;margin-bottom:15px;}.btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}.ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:5px;border-radius:6px;}</style></head><body><div class="card"><img src="${p.image}"><h2>${p.title}</h2><div style="margin-bottom:15px">${chLinks}</div><hr><div id="st">${p.adLimit}টি অ্যাড দেখুন।</div>${qBtns}</div><script>let c=0;function startAd(u){if(c<${p.adLimit}){if(typeof window['show_'+'${p.zoneId}'] === 'function'){window['show_'+'${p.zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${p.adLimit}";});}else{c++;}}else{location.href=u;}}</script></body></html>`);
});

app.get('/', (req, res) => res.send("Bot Active 🚀"));

app.listen(process.env.PORT || 3000, () => {
    console.log("Server running...");
    if (config.appUrl) {
        cron.schedule('*/5 * * * *', () => {
            axios.get(config.appUrl).then(() => console.log("Self-Ping Done")).catch(() => {});
        });
    }
});
