const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); 
const app = express();

// --- Configuration (Environment Variables) ---
const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL; 
const mongoUri = process.env.MONGODB_URI; 
const ADMIN_ID = parseInt(process.env.ADMIN_ID); 
const ADMIN_USERNAME = process.env.ADMIN_USERNAME; 

const bot = new TelegramBot(token, { polling: true });

// --- MongoDB Connection ---
mongoose.connect(mongoUri).then(() => console.log("✅ MongoDB Connected!"));

// --- Schemas ---
const Post = mongoose.model('Post', new mongoose.Schema({
    id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, createdAt: { type: Date, default: Date.now }
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: Number, savedChannels: { type: Array, default: [] } 
}));

const Setting = mongoose.model('Setting', new mongoose.Schema({
    key: String, value: mongoose.Schema.Types.Mixed
}));

const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({
    userId: Number, packageName: String, expiryDate: Date
}));

let userState = {};

// --- Helper Functions ---
async function getSet(key, defaultValue) {
    const data = await Setting.findOne({ key });
    return data ? data.value : defaultValue;
}
async function saveSet(key, value) {
    await Setting.findOneAndUpdate({ key }, { value }, { upsert: true });
}
async function isPremium(chatId) {
    if (chatId === ADMIN_ID) return true;
    const user = await PremiumUser.findOne({ userId: chatId });
    if (!user) return false;
    if (new Date() > user.expiryDate) {
        await PremiumUser.deleteOne({ userId: chatId });
        return false;
    }
    return true;
}

// --- HTML Generator ---
function generateHTML(post, zoneId, clicks) {
    let qBtns = post.links.map(i => `<button class="btn q-btn" onclick="startAd('${i.link}')">${i.quality} - আনলক</button>`).join('');
    let chSection = (post.channels && post.channels.length > 0) ? 
        `<div class="channel-box"><h3>📢 জয়েন করুন:</h3>${post.channels.map(ch => `<a href="${ch.link}" target="_blank" class="ch-link">${ch.name}</a>`).join('')}</div>` : "";

    return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
    <style>body{font-family:sans-serif;background:#0f172a;color:white;text-align:center;padding:20px;display:flex;justify-content:center;align-items:center;min-height:100vh;}
    .card{background:#1e293b;padding:20px;border-radius:15px;border:1px solid #334155;max-width:400px;width:100%;}img{width:100%;border-radius:10px;margin-bottom:15px;}
    .channel-box{background:rgba(59,130,246,0.1);padding:10px;margin-bottom:15px;border-radius:10px;border:1px dashed #3b82f6;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:6px 12px;margin:4px;border-radius:6px;font-size:13px;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}
    .q-btn{background:#334155;border:1px solid #475569;}#st{color:#fbbf24;margin-bottom:10px;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2><p>Language: ${post.language}</p>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("পোস্টটি পাওয়া যায়নি!");
    const zoneId = await getSet('zone_id', '10341337');
    const clicks = await getSet('required_clicks', 3);
    res.send(generateHTML(post, zoneId, clicks));
});

// --- Settings Menu ---
async function showSettings(chatId) {
    const premium = await isPremium(chatId);
    let buttons = [[{ text: "🎬 নতুন পোস্ট তৈরি", callback_data: "start_post" }]];
    
    if (premium) { 
        buttons.push([{ text: "📢 চ্যানেল বাটন সেটআপ", callback_data: "setup_channels_menu" }]); 
    }
    
    buttons.push([{ text: "💎 প্রিমিয়াম প্ল্যান ও অফার", callback_data: "view_premium" }]);
    
    if (chatId === ADMIN_ID) {
        buttons.push(
            [{ text: "⚙️ জোন আইডি", callback_data: "set_zone_id" }, { text: "🖱 ক্লিক সেট", callback_data: "set_clicks" }],
            [{ text: "🎁 অফার এডিট", callback_data: "set_offer_prompt" }, { text: "➕ মেম্বার অ্যাড", callback_data: "add_user_prompt" }]
        );
    }
    
    bot.sendMessage(chatId, "🛠 বোট সেটিংস ও কন্ট্রোল প্যানেল:", { reply_markup: { inline_keyboard: buttons } });
}

// --- Bot Logic ---
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "🎬 মুভি পোস্ট মেকার বোট!\nসব ফিচার ব্যবহার করতে /settings লিখুন।"));

bot.onText(/\/settings/, (msg) => showSettings(msg.chat.id));

// --- Callback Queries ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    if (data === "view_premium") {
        const offer = await getSet('premium_offer', "এখনও কোনো অফার যোগ করা হয়নি।");
        bot.sendMessage(chatId, `💎 **প্রিমিয়াম অফারসমূহ:**\n\n${offer}\n\n📌 কিনলে পাবেন: আনলিমিটেড মুভি পোস্ট ও নিজস্ব চ্যানেল বাটন।\n\nকিনতে যোগাযোগ করুন: @${ADMIN_USERNAME}`, { parse_mode: 'Markdown' });
    }
    else if (data === "set_offer_prompt" && chatId === ADMIN_ID) {
        userState[chatId] = { step: 'manual_offer' };
        bot.sendMessage(chatId, "📝 নতুন অফার টেক্সটটি লিখুন।\nউদাহরণ: `1 Day - 20 BDT | 1 Month - 100 BDT`", { parse_mode: 'Markdown' });
    }
    else if (data === "add_user_prompt" && chatId === ADMIN_ID) {
        userState[chatId] = { step: 'manual_add_user' };
        bot.sendMessage(chatId, "👤 মেম্বার অ্যাড করতে তথ্য পাঠান:\n\n`UserID | Days | PackageName`\n\nউদাহরণ: `1234567 | 30 | Monthly`", { parse_mode: 'Markdown' });
    }
    else if (data === "set_zone_id") { userState[chatId] = { step: 'manual_zone' }; bot.sendMessage(chatId, "🆔 Adsterra Zone ID দিন:"); }
    else if (data === "set_clicks") { userState[chatId] = { step: 'manual_clicks' }; bot.sendMessage(chatId, "🖱 ক্লিক সংখ্যা (সংখ্যা) দিন:"); }
    
    // পোস্ট ও চ্যানেল প্রসেস (আগের মতোই)
    else if (data === "setup_channels_menu") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let msgText = "📢 সেভ করা চ্যানেল:\n";
        if (!profile || profile.savedChannels.length === 0) msgText += "নেই।";
        else profile.savedChannels.forEach((ch, i) => msgText += `${i+1}. ${ch.name}\n`);
        bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_new_ch" }], [{ text: "🗑 মুছুন", callback_data: "clear_channels" }]] } });
    }
    else if (data === "add_new_ch") { userState[chatId] = { step: 'get_ch_name' }; bot.sendMessage(chatId, "চ্যানেলের নাম:"); }
    else if (data === "clear_channels") { await UserProfile.findOneAndUpdate({ userId: chatId }, { savedChannels: [] }); bot.sendMessage(chatId, "✅ ক্লিয়ার হয়েছে।"); }
    else if (data === "start_post") {
        if (!(await isPremium(chatId))) return bot.sendMessage(chatId, "❌ আপনি প্রিমিয়াম মেম্বার নন।");
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 ১. মুভির নাম:");
    }
    else if (data === "skip_q") {
        bot.sendMessage(chatId, "নিচে কনফার্ম করুন:", { reply_markup: { inline_keyboard: [[{ text: "✅ কনফার্ম পোস্ট", callback_data: "confirm" }]] } });
    }
    else if (data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: profile ? profile.savedChannels : [] }).save();
        bot.sendMessage(chatId, `✅ সফল!\n🔗 ${myAppUrl}/post/${id}`);
        delete userState[chatId];
    }
});

// --- Message & State Handler ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        
        // Admin Actions
        if (s.step === 'manual_offer' && chatId === ADMIN_ID) {
            await saveSet('premium_offer', text);
            bot.sendMessage(chatId, "✅ প্রিমিয়াম অফার সেভ হয়েছে।");
            delete userState[chatId];
        }
        else if (s.step === 'manual_add_user' && chatId === ADMIN_ID) {
            const p = text.split('|');
            if (p.length < 3) return bot.sendMessage(chatId, "❌ ফরম্যাট ভুল।");
            const uid = parseInt(p[0].trim()), days = parseInt(p[1].trim()), pkg = p[2].trim();
            const expiry = moment().add(days, 'days').tz("Asia/Dhaka");
            await PremiumUser.findOneAndUpdate({ userId: uid }, { packageName: pkg, expiryDate: expiry.toDate() }, { upsert: true });
            bot.sendMessage(uid, `🎉 প্রিমিয়াম (${pkg}) চালু হয়েছে। মেয়াদ: ${expiry.format('DD-MM-YYYY')}`);
            bot.sendMessage(chatId, "✅ ইউজার অ্যাড হয়েছে।");
            delete userState[chatId];
        }
        else if (s.step === 'manual_zone') { await saveSet('zone_id', text); bot.sendMessage(chatId, "✅ জোন আইডি আপডেট হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'manual_clicks') { await saveSet('required_clicks', parseInt(text)); bot.sendMessage(chatId, "✅ ক্লিক আপডেট হয়েছে।"); delete userState[chatId]; }
        
        // Movie Process
        else if (s.step === 'get_ch_name') { s.tempName = text; s.step = 'get_ch_link'; bot.sendMessage(chatId, "চ্যানেল লিঙ্ক:"); }
        else if (s.step === 'get_ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempName, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "🖼 পোস্টার লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "🌐 ভাষা:"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "📊 কোয়ালিটি:"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "🔗 ড্রাইভ/মুভি লিঙ্ক:"); }
        else if (s.step === 'q_link') {
            s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name';
            bot.sendMessage(chatId, "যুক্ত হয়েছে। আরও দিতে চাইলে কোয়ালিটি লিখুন নাহলে Skip করুন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip", callback_data: "skip_q" }]] } });
        }
    }
});

// --- Manual Admin Commands ---
bot.onText(/\/setoffer (.+)/, async (msg, match) => { if (msg.chat.id === ADMIN_ID) await saveSet('premium_offer', match[1]); bot.sendMessage(ADMIN_ID, "✅ অফার আপডেট হয়েছে।"); });
bot.onText(/\/addpremium (.+)\|(.+)\|(.+)/, async (msg, match) => {
    if (msg.chat.id !== ADMIN_ID) return;
    const uid = parseInt(match[1]), days = parseInt(match[2]), pkg = match[3];
    const expiry = moment().add(days, 'days').tz("Asia/Dhaka");
    await PremiumUser.findOneAndUpdate({ userId: uid }, { packageName: pkg, expiryDate: expiry.toDate() }, { upsert: true });
    bot.sendMessage(uid, `🎉 প্রিমিয়াম (${pkg}) চালু। মেয়াদ: ${expiry.format('DD-MM-YYYY')}`);
    bot.sendMessage(ADMIN_ID, "✅ ডান।");
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 Server Ready"));
