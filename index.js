const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (আপনার তথ্য দিয়ে দিন) ---
const config = {
    token: process.env.BOT_TOKEN, // বটের টোকেন
    mongoUri: process.env.MONGODB_URI, // ডাটাবেস লিঙ্ক
    adminId: parseInt(process.env.ADMIN_ID), // আপনার আইডি
    adminUser: process.env.ADMIN_USERNAME || "YourUsername", // আপনার ইউজারনেম (অ্যাট @ ছাড়া)
    appUrl: process.env.APP_URL // আপনার রেন্ডার ইউআরএল
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেলসমূহ ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected")).catch(e => console.log(e));

const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Plan = mongoose.model('Plan', new mongoose.Schema({ name: String, price: String, days: Number }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ 
    userId: { type: Number, unique: true }, 
    zoneId: { type: String, default: '10341337' }, 
    adCount: { type: Number, default: 3 }, 
    channels: { type: Array, default: [] } 
}));
const Post = mongoose.model('Post', new mongoose.Schema({ 
    id: String, creatorId: Number, title: String, image: String, links: Array, 
    zoneId: String, adLimit: Number, channels: Array 
}));

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
async function getMenu(chatId) {
    const isP = await isPremium(chatId);
    const isAdmin = (chatId === config.adminId);
    let btns = [];

    if (isP || isAdmin) {
        btns.push([{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }]);
        btns.push([{ text: "📢 চ্যানেল সেটিংস", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি", callback_data: "set_zone" }]);
        btns.push([{ text: "🔢 অ্যাড লিমিট", callback_data: "set_ad_limit" }, { text: "💎 প্ল্যান তালিকা", callback_data: "view_premium" }]);
    } else {
        btns.push([{ text: "🎬 মুভি পোস্ট তৈরি 🔒", callback_data: "start_post" }]);
        btns.push([{ text: "💎 প্রিমিয়াম প্ল্যান দেখুন", callback_data: "view_premium" }]);
    }

    if (isAdmin) {
        btns.push([{ text: "🛠 অ্যাডমিন প্যানেল (মালিক)", callback_data: "admin_panel" }]);
    }

    btns.push([{ text: "💬 ওনার কন্টাক্ট", url: `https://t.me/${config.adminUser}` }]);
    return { inline_keyboard: btns };
}

// --- ৩. কমান্ড ও কলব্যাক হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    bot.sendMessage(chatId, "👋 **Movie Pro Panel** এ স্বাগতম!\nনিচের বাটনগুলো ব্যবহার করুন।", { reply_markup: await getMenu(chatId) });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);
    const isAdmin = (chatId === config.adminId);

    switch (q.data) {
        case "admin_panel":
            if (!isAdmin) return;
            bot.sendMessage(chatId, "📊 **অ্যাডমিন প্যানেল:**", {
                reply_markup: { inline_keyboard: [
                    [{ text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }],
                    [{ text: "📝 নতুন প্ল্যান যোগ", callback_data: "add_plan" }, { text: "🗑 সব প্ল্যান মুছুন", callback_data: "clear_plans" }]
                ]}
            });
            break;

        case "view_premium":
            const plans = await Plan.find();
            let pTxt = "💎 **আমাদের প্রিমিয়াম প্ল্যানসমূহ:**\n\n";
            if(plans.length > 0) {
                plans.forEach(p => pTxt += `✅ ${p.name}\n💰 দাম: ${p.price}\n⏳ মেয়াদ: ${p.days} দিন\n------------------\n`);
            } else {
                pTxt += "বর্তমানে কোনো প্ল্যান সেট করা নেই।";
            }
            bot.sendMessage(chatId, pTxt, { 
                reply_markup: { inline_keyboard: [[{ text: "💬 কিনতে ওনারকে মেসেজ দিন", url: `https://t.me/${config.adminUser}` }]] } 
            });
            break;

        case "add_plan":
            if (!isAdmin) return;
            userState[chatId] = { step: 'plan_name' };
            bot.sendMessage(chatId, "প্ল্যানের নাম দিন (যেমন: Monthly Pro):");
            break;

        case "clear_plans":
            if (!isAdmin) return;
            await Plan.deleteMany({});
            bot.sendMessage(chatId, "✅ সব প্ল্যান ডিলিট করা হয়েছে।");
            break;

        case "add_p":
            if (!isAdmin) return;
            userState[chatId] = { step: 'add_p_id' };
            bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার আইডি (User ID) দিন:");
            break;
        
        // মুভি পোস্ট ও অন্যান্য বাটন আগের মতোই থাকবে...
        case "start_post":
            if (!isP) return bot.sendMessage(chatId, "🛑 প্রিমিয়াম নেই!");
            userState[chatId] = { step: 'title', links: [] };
            bot.sendMessage(chatId, "মুভির নাম লিখুন:");
            break;

        case "confirm":
            const s = userState[chatId];
            const profile = await Profile.findOne({ userId: chatId });
            const pid = Math.random().toString(36).substring(7);
            await new Post({ id: pid, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: profile.zoneId, adLimit: profile.adCount, channels: profile.channels }).save();
            
            const postLink = `${config.appUrl}/post/${pid}`;
            const htmlCode = `&lt;a href="${postLink}"&gt;🎬 Watch ${s.title}&lt;/a&gt;`;
            bot.sendMessage(chatId, `✅ সফল!\n\n🔗 লিঙ্ক: ${postLink}\n\n📝 **HTML কোড (কপি করুন):**\n<code>${htmlCode}</code>`, { parse_mode: 'HTML' });
            delete userState[chatId];
            break;
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. মেসেজ লজিক (ইনপুট হ্যান্ডলিং) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    // নতুন প্ল্যান অ্যাড করার লজিক
    if (s.step === 'plan_name') { s.pN = text; s.step = 'plan_price'; bot.sendMessage(chatId, "প্ল্যানের দাম কত? (যেমন: ২০০ টাকা):"); }
    else if (s.step === 'plan_price') { s.pP = text; s.step = 'plan_days'; bot.sendMessage(chatId, "প্ল্যানটির মেয়াদ কত দিন? (শুধু সংখ্যা দিন):"); }
    else if (s.step === 'plan_days') { 
        await new Plan({ name: s.pN, price: s.pP, days: parseInt(text) }).save(); 
        bot.sendMessage(chatId, "✅ নতুন প্রিমিয়াম প্ল্যান সফলভাবে অ্যাড হয়েছে!"); 
        delete userState[chatId]; 
    }
    // মেম্বার অ্যাড করার লজিক
    else if (s.step === 'add_p_id') { s.targetId = text; s.step = 'add_p_days'; bot.sendMessage(chatId, "কত দিনের জন্য প্রিমিয়াম দিবেন? (শুধু সংখ্যা):"); }
    else if (s.step === 'add_p_days') {
        const exp = moment().add(parseInt(text), 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.targetId) }, { expiry: exp }, { upsert: true });
        bot.sendMessage(chatId, "✅ ইউজারকে প্রিমিয়াম দেওয়া হয়েছে।");
        bot.sendMessage(s.targetId, "🎉 অভিনন্দন! আপনি প্রিমিয়াম এক্সেস পেয়েছেন।").catch(()=>{});
        delete userState[chatId];
    }
    // মুভি পোস্ট লজিক
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি (উদা: 720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        bot.sendMessage(chatId, "আরও কোয়ালিটি দিতে চাইলে নাম দিন, নতুবা Confirm এ ক্লিক করুন।", { reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] } });
        s.step = 'q_name';
    }
});

// --- ৫. সার্ভার ও Keep Alive ---
app.get('/', (req, res) => res.send("Bot Active! 🚀"));
app.listen(process.env.PORT || 3000, () => {
    console.log("Server Running...");
    // রেন্ডারে বট স্লিপ হওয়া রোধ করতে ৫ মিনিট পর পর পিং করবে
    setInterval(() => {
        if(config.appUrl) axios.get(config.appUrl).then(()=>console.log("Keep Alive")).catch(()=>null);
    }, 5 * 60 * 1000);
});
