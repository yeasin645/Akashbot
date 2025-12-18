const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone'); 
const app = express();

// --- Configuration ---
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
    id: String,
    creatorId: Number,
    title: String,
    image: String,
    links: Array,
    channels: Array, // এই ইউজারের সেভ করা চ্যানেলগুলো এখানে ঢুকবে
    createdAt: { type: Date, default: Date.now }
}));

const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({
    userId: Number,
    savedChannels: { type: Array, default: [] } // ইউজার এখানে তার চ্যানেল সেভ রাখবে
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
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

// --- Website Route ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("পোস্টটি পাওয়া যায়নি!");
    const zoneId = await getSet('zone_id', '10341337');
    const clicks = await getSet('required_clicks', 3);
    res.send(generateHTML(post, zoneId, clicks));
});

// --- Bot Logic ---
bot.onText(/\/start/, (msg) => bot.sendMessage(msg.chat.id, "🎬 **মুভি পোস্ট মেকার**\n\nসব ফিচারের জন্য /settings কমান্ডটি ব্যবহার করুন।"));

bot.onText(/\/settings/, async (msg) => {
    const chatId = msg.chat.id;
    const premium = await isPremium(chatId);
    
    let buttons = [[{ text: "🎬 নতুন মুভি পোস্ট", callback_data: "start_post" }]];
    
    if (premium) {
        buttons.push([{ text: "📢 আমার চ্যানেল সেটআপ", callback_data: "setup_channels" }]);
    }
    
    buttons.push([{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]);

    if (chatId === ADMIN_ID) {
        buttons.push([{ text: "⚙️ বিজ্ঞাপন সেটিংস", callback_data: "ad_settings" }], [{ text: "➕ প্রিমিয়াম মেম্বার অ্যাড", callback_data: "add_user" }]);
    }
    bot.sendMessage(chatId, "🛠 **বোট মেইন মেনু**", { reply_markup: { inline_keyboard: buttons } });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;

    if (data === "start_post") {
        if (!(await isPremium(chatId))) return bot.sendMessage(chatId, "❌ আপনি প্রিমিয়াম মেম্বার নন।");
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    }
    else if (data === "setup_channels") {
        userState[chatId] = { step: 'setup_ch_name', tempChans: [] };
        bot.sendMessage(chatId, "📢 আপনার চ্যানেলের নাম দিন (এটি আপনার প্রতিটি পোস্টে অটো যোগ হবে):");
    }
    else if (data === "add_more_ch") {
        userState[chatId].step = 'setup_ch_name';
        bot.sendMessage(chatId, "📢 পরবর্তী চ্যানেলের নাম দিন:");
    }
    else if (data === "save_ch_final") {
        await UserProfile.findOneAndUpdate({ userId: chatId }, { savedChannels: userState[chatId].tempChans }, { upsert: true });
        bot.sendMessage(chatId, "✅ আপনার চ্যানেল লিস্ট সফলভাবে সেভ হয়েছে!");
        delete userState[chatId];
    }
    else if (data === "confirm" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const userChannels = profile ? profile.savedChannels : [];
        
        const id = Math.random().toString(36).substring(7);
        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, links: s.links, channels: userChannels }).save();

        const zoneId = await getSet('zone_id', '10341337');
        const clicks = await getSet('required_clicks', 3);
        const finalHtml = generateHTML({...s, channels: userChannels}, zoneId, clicks);

        await bot.sendMessage(chatId, `✅ **সফল!**\n🔗 ${myAppUrl}/post/${id}`);
        await bot.sendMessage(chatId, `📄 **HTML কোড:**\n\n\`\`\`html\n${finalHtml}\n\`\`\``, { parse_mode: 'Markdown' });
        delete userState[chatId];
    }
    else if (data === "ad_settings" && chatId === ADMIN_ID) bot.sendMessage(chatId, "`/setzone ID` বা `/setclicks সংখ্যা` দিন।");
    else if (data === "add_user" && chatId === ADMIN_ID) bot.sendMessage(chatId, "`/addpremium ID | Days | Package` দিন।");
});

// --- Message Handler ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!userState[chatId] || !text || text.startsWith('/')) return;
    
    let s = userState[chatId];

    // চ্যানেল সেটআপ লজিক (আলাদা)
    if (s.step === 'setup_ch_name') {
        s.lastChName = text; s.step = 'setup_ch_link';
        bot.sendMessage(chatId, `🔗 '${text}' চ্যানেলের লিঙ্ক দিন:`);
    }
    else if (s.step === 'setup_ch_link') {
        s.tempChans.push({ name: s.lastChName, link: text });
        bot.sendMessage(chatId, "চ্যানেল যুক্ত হয়েছে। আরও যোগ করবেন?", {
            reply_markup: {
                inline_keyboard: [[{ text: "➕ আরও অ্যাড", callback_data: "add_more_ch" }, { text: "✅ সেভ করুন", callback_data: "save_ch_final" }]]
            }
        });
    }
    // মুভি পোস্ট লজিক
    else if (s.step === 'title') {
        s.title = text; s.step = 'image';
        bot.sendMessage(chatId, "🖼 মুভি পোস্টার ইমেজ লিঙ্ক দিন:");
    } 
    else if (s.step === 'image') {
        s.image = text; s.step = 'q_name';
        bot.sendMessage(chatId, "📊 মুভি কোয়ালিটির নাম দিন (উদা: 720p):");
    } 
    else if (s.step === 'q_name') {
        s.tempQ = text; s.step = 'q_link';
        bot.sendMessage(chatId, `🔗 '${text}' কোয়ালিটির লিঙ্ক দিন:`);
    } 
    else if (s.step === 'q_link') {
        s.links.push({ quality: s.tempQ, link: text });
        bot.sendMessage(chatId, "✅ কোয়ালিটি সেভ হয়েছে।", {
            reply_markup: {
                inline_keyboard: [[{ text: "➕ আরও কোয়ালিটি", callback_data: "confirm_next_q" }, { text: "🏁 পোস্ট সম্পন্ন করুন", callback_data: "confirm" }]]
            }
        });
        s.step = 'q_name'; // পরবর্তী কোয়ালিটির জন্য রেডি
    }
});

// --- Admin ---
bot.onText(/\/addpremium (.+)\|(.+)\|(.+)/, async (msg, match) => {
    if (msg.chat.id !== ADMIN_ID) return;
    const targetId = parseInt(match[1].trim());
    const days = parseInt(match[2].trim());
    const expiry = moment().add(days, 'days').tz("Asia/Dhaka");
    await PremiumUser.findOneAndUpdate({ userId: targetId }, { packageName: match[3].trim(), expiryDate: expiry.toDate() }, { upsert: true });
    bot.sendMessage(targetId, `🎉 প্রিমিয়াম চালু! মেয়াদ: ${expiry.format('DD-MM-YYYY hh:mm A')}`);
    bot.sendMessage(ADMIN_ID, "✅ ডান।");
});

bot.onText(/\/setzone (.+)/, async (msg, match) => { if (msg.chat.id === ADMIN_ID) await saveSet('zone_id', match[1].trim()); });
bot.onText(/\/setclicks (\d+)/, async (msg, match) => { if (msg.chat.id === ADMIN_ID) await saveSet('required_clicks', parseInt(match[1])); });

app.listen(process.env.PORT || 3000, () => console.log("Server Running"));
