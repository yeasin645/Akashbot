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
const User = mongoose.model('User', new mongoose.Schema({ userId: Number, joinedAt: { type: Date, default: Date.now } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String, clicks: Number, createdAt: { type: Date, default: Date.now } }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Setting = mongoose.model('Setting', new mongoose.Schema({ key: String, value: mongoose.Schema.Types.Mixed }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));

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
    .card{background:#1e293b;padding:20px;border-radius:15px;border:1px solid #334155;max-width:400px;width:100%;box-shadow:0 10px 25px rgba(0,0,0,0.5);}img{width:100%;border-radius:10px;margin-bottom:15px;object-fit:cover;}
    .channel-box{background:rgba(59,130,246,0.1);padding:10px;margin-bottom:15px;border-radius:10px;border:1px dashed #3b82f6;}
    .ch-link{display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 15px;margin:4px;border-radius:6px;font-size:14px;font-weight:bold;}
    .btn{background:#2563eb;color:white;padding:14px;width:100%;border-radius:10px;margin:10px 0;border:none;font-weight:bold;cursor:pointer;}
    .q-btn{background:#334155;border:1px solid #475569;}#st{color:#fbbf24;margin-bottom:10px;font-weight:bold;}</style></head>
    <body><div class="card"><img src="${post.image}"><h2>${post.title}</h2><p style="color:#94a3b8">Language: ${post.language}</p>${chSection}<div id="st">অ্যাড দেখা হয়েছে: 0/${clicks}</div>${qBtns}</div>
    <script>let c=0;function startAd(u){if(c<${clicks}){if(typeof window['show_'+'${zoneId}'] === 'function'){window['show_'+'${zoneId}']().then(()=>{c++;document.getElementById('st').innerText="অ্যাড দেখা হয়েছে: "+c+"/${clicks}";});}else{c++;}}else{location.href=u;}}</script></body></html>`;
}

// --- MAIN MENU FUNCTION (এখানেই বাটন ঠিক করা হয়েছে) ---
async function showMainMenu(chatId) {
    // সাধারণ বাটন যেগুলো সবাই দেখবে
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ", callback_data: "setup_channels_menu" }, { text: "🆔 জোন আইডি সেট", callback_data: "set_user_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    
    // এডমিন বাটন শুধুমাত্র আপনার জন্য
    if (chatId === ADMIN_ID) {
        buttons.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "add_user_prompt" }],
            [{ text: "🗑 মেম্বার রিমুভ", callback_data: "del_user_prompt" }, { text: "🎁 অফার এডিট", callback_data: "set_offer_prompt" }],
            [{ text: "⚙️ ডিফল্ট জোন/ক্লিক সেট", callback_data: "admin_config_menu" }]
        );
    }
    
    bot.sendMessage(chatId, "🛠 **মুভি মেকার মেইন মেনু**\nনিচের বাটনগুলো ব্যবহার করুন:", { 
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: buttons } 
    });
}

// --- Routes & Command ---
app.get('/post/:id', async (req, res) => {
    const post = await Post.findOne({ id: req.params.id });
    if (!post) return res.send("পোস্ট পাওয়া যায়নি!");
    res.send(generateHTML(post, post.zoneId, post.clicks));
});

bot.onText(/\/start|\/settings/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    showMainMenu(msg.chat.id);
});

// --- Button Clicks (Callback Query) ---
bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const premium = await isPremium(chatId);

    // সিকিউরিটি লক: প্রিমিয়াম না হলে ৩টি বাটন কাজ করবে না
    const lockButtons = ["start_post", "setup_channels_menu", "set_user_zone", "add_new_ch"];
    if (lockButtons.includes(data) && !premium) {
        return bot.answerCallbackQuery(q.id, { text: "❌ এক্সেস নেই! আগে প্রিমিয়াম মেম্বারশিপ কিনুন।", show_alert: true });
    }

    // বাটন অ্যাকশনসমূহ
    if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
    }
    else if (data === "set_user_zone") {
        userState[chatId] = { step: 'get_user_zone' };
        bot.sendMessage(chatId, "📝 আপনার নিজস্ব Adsterra Zone ID টি দিন:");
    }
    else if (data === "setup_channels_menu") {
        const profile = await UserProfile.findOne({ userId: chatId });
        let msgText = "📢 **চ্যানেল তালিকা:**\n";
        if (!profile || profile.savedChannels.length === 0) msgText += "নেই।";
        else profile.savedChannels.forEach((ch, i) => msgText += `${i+1}. ${ch.name}\n`);
        bot.sendMessage(chatId, msgText, { reply_markup: { inline_keyboard: [[{ text: "➕ যোগ করুন", callback_data: "add_new_ch" }], [{ text: "🗑 মুছুন", callback_data: "clear_channels" }]] } });
    }
    else if (data === "view_premium") {
        const offer = await getSet('premium_offer', "অফার যোগ করা হয়নি। ওনারের সাথে কথা বলুন।");
        bot.sendMessage(chatId, `💎 **প্রিমিয়াম অফার:**\n\n${offer}\n\nযোগাযোগ: @${ADMIN_USERNAME}`, { parse_mode: 'Markdown' });
    }

    // এডমিন বাটন অ্যাকশন
    if (chatId === ADMIN_ID) {
        if (data === "view_stats") {
            const totalUsers = await User.countDocuments();
            const totalPremium = await PremiumUser.countDocuments();
            bot.sendMessage(chatId, `📊 **পরিসংখ্যান:**\n\n👥 মোট ইউজার: ${totalUsers}\n💎 প্রিমিয়াম: ${totalPremium}`);
        }
        else if (data === "add_user_prompt") { userState[chatId] = { step: 'manual_add_user' }; bot.sendMessage(chatId, "👤 লিখুন: `UserID | Days | Plan`", { parse_mode: 'Markdown' }); }
        else if (data === "del_user_prompt") { userState[chatId] = { step: 'manual_del_user' }; bot.sendMessage(chatId, "🗑 রিমুভ করতে User ID দিন:"); }
        else if (data === "set_offer_prompt") { userState[chatId] = { step: 'manual_offer' }; bot.sendMessage(chatId, "📝 নতুন অফার টেক্সট দিন:"); }
        else if (data === "admin_config_menu") {
             bot.sendMessage(chatId, "⚙️ কনফিগ মেনু:", { reply_markup: { inline_keyboard: [[{ text: "🆔 ডিফল্ট জোন", callback_data: "set_admin_zone" }], [{ text: "🖱 ডিফল্ট ক্লিক", callback_data: "set_admin_clicks" }]] } });
        }
        else if (data === "set_admin_zone") { userState[chatId] = { step: 'get_admin_zone' }; bot.sendMessage(chatId, "🆔 ডিফল্ট জোন আইডি দিন:"); }
        else if (data === "set_admin_clicks") { userState[chatId] = { step: 'get_admin_clicks' }; bot.sendMessage(chatId, "🖱 ডিফল্ট ক্লিক সংখ্যা দিন:"); }
    }

    // পোস্ট প্রসেস কনফার্ম
    if (data === "skip_q") {
        bot.sendMessage(chatId, "সব ঠিক থাকলে জেনারেট করুন:", { reply_markup: { inline_keyboard: [[{ text: "🚀 জেনারেট করুন", callback_data: "confirm_post" }]] } });
    }
    else if (data === "confirm_post" && userState[chatId]) {
        const s = userState[chatId];
        const profile = await UserProfile.findOne({ userId: chatId });
        const adminZone = await getSet('zone_id', '10341337');
        const adminClicks = await getSet('required_clicks', 3);
        const finalZone = (profile && profile.userZoneId) ? profile.userZoneId : adminZone;
        const id = Math.random().toString(36).substring(7);
        const userChannels = profile ? profile.savedChannels : [];

        await new Post({ id, creatorId: chatId, title: s.title, image: s.image, language: s.language, links: s.links, channels: userChannels, zoneId: finalZone, clicks: adminClicks }).save();
        const htmlCode = generateHTML({ ...s, channels: userChannels }, finalZone, adminClicks);
        await bot.sendMessage(chatId, `✅ সফল!\n🔗 প্রিভিউ: ${myAppUrl}/post/${id}`);
        await bot.sendMessage(chatId, `\`\`\`html\n${htmlCode}\n\`\`\``, { parse_mode: 'MarkdownV2' });
        delete userState[chatId];
    }
    bot.answerCallbackQuery(q.id);
});

// --- Message Listener (Input Handling) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        // এডমিন ইনপুট
        if (s.step === 'manual_add_user' && chatId === ADMIN_ID) {
            const p = text.split('|'); if (p.length < 3) return;
            const expiry = moment().add(parseInt(p[1]), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0]) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ প্রিমিয়াম অ্যাড হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'manual_del_user' && chatId === ADMIN_ID) {
            await PremiumUser.deleteOne({ userId: parseInt(text) });
            bot.sendMessage(chatId, "✅ রিমুভ হয়েছে।"); delete userState[chatId];
        }
        else if (s.step === 'manual_offer' && chatId === ADMIN_ID) { await saveSet('premium_offer', text); bot.sendMessage(chatId, "✅ অফার আপডেট হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'get_admin_zone' && chatId === ADMIN_ID) { await saveSet('zone_id', text); bot.sendMessage(chatId, "✅ ডিফল্ট জোন সেভড।"); delete userState[chatId]; }
        else if (s.step === 'get_admin_clicks' && chatId === ADMIN_ID) { await saveSet('required_clicks', parseInt(text)); bot.sendMessage(chatId, "✅ ডিফল্ট ক্লিক সেভড।"); delete userState[chatId]; }

        // ইউজার ইনপুট
        else if (s.step === 'get_user_zone') { await UserProfile.findOneAndUpdate({ userId: chatId }, { userZoneId: text.trim() }, { upsert: true }); bot.sendMessage(chatId, "✅ আপনার জোন আইডি সেভ হয়েছে।"); delete userState[chatId]; }
        else if (s.step === 'get_ch_name') { s.tempName = text; s.step = 'get_ch_link'; bot.sendMessage(chatId, "লিঙ্ক দিন:"); }
        else if (s.step === 'get_ch_link') { await UserProfile.findOneAndUpdate({ userId: chatId }, { $push: { savedChannels: { name: s.tempName, link: text } } }, { upsert: true }); bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।"); delete userState[chatId]; }
        
        // মুভি প্রসেস
        else if (s.step === 'title') { s.title = text; s.step = 'image'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক:"); }
        else if (s.step === 'image') { s.image = text; s.step = 'lang'; bot.sendMessage(chatId, "ভাষা:"); }
        else if (s.step === 'lang') { s.language = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি:"); }
        else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "লিঙ্ক:"); }
        else if (s.step === 'q_link') { s.links.push({ quality: s.tempQ, link: text }); s.step = 'q_name'; bot.sendMessage(chatId, "আরও কোয়ালিটি দিন বা Skip করুন।", { reply_markup: { inline_keyboard: [[{ text: "⏩ Skip", callback_data: "skip_q" }]] } }); }
    }
});

app.listen(process.env.PORT || 3000, () => console.log("🚀 FINAL BOT READY!"));
