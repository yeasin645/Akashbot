const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন (আপনার তথ্য দিয়ে পূরণ করুন) ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME, 
    appUrl: process.env.APP_URL, 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস ও মডেল ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected")).catch(e => console.log(e));

const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
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

// প্রিমিয়াম চেক
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
        [{ text: "🎬 মুভি পোস্ট তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটিংস 🔒", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি 🔒", callback_data: "set_zone" }],
        [{ text: "🔢 অ্যাড লিমিট 🔒", callback_data: "set_ad_limit" }, { text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === config.adminId) {
        btns.push(
            [{ text: "📊 স্ট্যাটাস (Admin)", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড (Admin)", callback_data: "add_p" }],
            [{ text: "🗑 মেম্বার ডিলিট (Admin)", callback_data: "del_p" }]
        );
    }
    return { inline_keyboard: btns };
}

// --- ৩. কমান্ড ও বাটন হ্যান্ডলিং ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
    // ডিফল্ট প্রোফাইল তৈরি (যদি না থাকে)
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true, new: true });
    
    bot.sendMessage(chatId, "👋 স্বাগতম! আপনার মুভি বোট কন্ট্রোল প্যানেল।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(chatId) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    // প্রিমিয়াম লক চেক
    if (["start_post", "setup_ch", "set_zone", "set_ad_limit"].includes(q.data) && !isP) {
        return bot.sendMessage(chatId, "🛑 এই ফিচারটি ব্যবহার করতে প্রিমিয়াম লাগবে।", { 
            reply_markup: { inline_keyboard: [[{ text: "💬 ওনারের সাথে যোগাযোগ", url: `https://t.me/${config.adminUser}` }]] } 
        });
    }

    // বাটন অ্যাকশন
    switch (q.data) {
        case "setup_ch":
            const pr = await Profile.findOne({ userId: chatId });
            let txt = "📢 **আপনার চ্যানেলসমূহ:**\n";
            if (!pr || !pr.channels.length) txt += "_কোনো চ্যানেল যুক্ত নেই।_"; 
            else pr.channels.forEach((c, i) => txt += `✅ ${i+1}. ${c.name}\n`);
            bot.sendMessage(chatId, txt, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "➕ চ্যানেল যোগ করুন", callback_data: "add_new_ch" }], [{ text: "🗑 সব মুছুন", callback_data: "clear_ch" }]] } 
            });
            break;

        case "add_new_ch":
            userState[chatId] = { step: 'ch_name' };
            bot.sendMessage(chatId, "চ্যানেলের নাম লিখুন (উদা: My Channel):");
            break;

        case "clear_ch":
            await Profile.findOneAndUpdate({ userId: chatId }, { channels: [] });
            bot.sendMessage(chatId, "✅ সব চ্যানেল ডিলিট করা হয়েছে।");
            break;

        case "set_zone":
            userState[chatId] = { step: 'zone' };
            bot.sendMessage(chatId, "আপনার Adsterra Zone ID দিন:");
            break;

        case "set_ad_limit":
            userState[chatId] = { step: 'ad_limit' };
            bot.sendMessage(chatId, "অ্যাড লিমিট দিন (সংখ্যায়):");
            break;

        case "view_premium":
            bot.sendMessage(chatId, "💎 **আমাদের প্রিমিয়াম প্ল্যান:**\n1. ১ মাস - ১০০ টাকা\n2. ৩ মাস - ২৫০ টাকা\n\nকিনতে ওনারকে মেসেজ দিন।", { 
                reply_markup: { inline_keyboard: [[{ text: "💬 ওনারকে মেসেজ দিন", url: `https://t.me/${config.adminUser}` }]] } 
            });
            break;

        case "add_p":
            if (chatId === config.adminId) {
                userState[chatId] = { step: 'add_p_id' };
                bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার **User ID** দিন:");
            }
            break;

        case "del_p":
            if (chatId === config.adminId) {
                userState[chatId] = { step: 'del_p_id' };
                bot.sendMessage(chatId, "প্রিমিয়াম বাতিল করতে **User ID** দিন:");
            }
            break;

        case "start_post":
            userState[chatId] = { step: 'title', links: [] };
            bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
            break;

        case "confirm":
            if (userState[chatId] && userState[chatId].step === 'q_name') {
                const s = userState[chatId];
                const myPr = await Profile.findOne({ userId: chatId });
                const id = Math.random().toString(36).substring(7);
                await new Post({ id, creatorId: chatId, title: s.title, image: s.image, links: s.links, zoneId: myPr.zoneId, adLimit: myPr.adCount, channels: myPr.channels }).save();
                bot.sendMessage(chatId, `✅ সফল!\n🔗 লিঙ্ক: ${config.appUrl}/post/${id}\n\nবটে সাবমিট করার কোডটি নিচে দেওয়া হলো।`);
                // কোড জেনারেট অংশ (আগের মতোই থাকবে)
                delete userState[chatId];
            }
            break;
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. মেসেজ হ্যান্ডলিং (ইনপুট সেভ করা) ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text.trim() }, { upsert: true });
        bot.sendMessage(chatId, `✅ জোন আইডি সেট হয়েছে: ${text}`);
        delete userState[chatId];
    }
    else if (s.step === 'ad_limit') {
        const limit = parseInt(text);
        if (isNaN(limit)) return bot.sendMessage(chatId, "❌ দয়া করে একটি সংখ্যা দিন।");
        await Profile.findOneAndUpdate({ userId: chatId }, { adCount: limit }, { upsert: true });
        bot.sendMessage(chatId, `✅ অ্যাড লিমিট সেট হয়েছে: ${limit}`);
        delete userState[chatId];
    }
    else if (s.step === 'ch_name') {
        s.cN = text;
        s.step = 'ch_link';
        bot.sendMessage(chatId, "চ্যানেলের লিঙ্ক দিন (উদা: https://t.me/...):");
    }
    else if (s.step === 'ch_link') {
        await Profile.findOneAndUpdate({ userId: chatId }, { $push: { channels: { name: s.cN, link: text } } });
        bot.sendMessage(chatId, "✅ চ্যানেল যুক্ত হয়েছে।");
        delete userState[chatId];
    }
    else if (s.step === 'add_p_id') {
        s.targetId = text;
        s.step = 'add_p_days';
        bot.sendMessage(chatId, "কত দিনের জন্য? (সংখ্যায়):");
    }
    else if (s.step === 'add_p_days') {
        const days = parseInt(text);
        const expiry = moment().add(days, 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.targetId) }, { expiry }, { upsert: true });
        bot.sendMessage(chatId, `✅ ID: ${s.targetId} এখন ${days} দিনের জন্য প্রিমিয়াম।`);
        bot.sendMessage(s.targetId, `🎊 অভিনন্দন! আপনি ${days} দিনের প্রিমিয়াম মেম্বারশিপ পেয়েছেন।`).catch(() => {});
        delete userState[chatId];
    }
    else if (s.step === 'del_p_id') {
        await Premium.deleteOne({ userId: parseInt(text) });
        bot.sendMessage(chatId, "❌ প্রিমিয়াম বাতিল করা হয়েছে।");
        delete userState[chatId];
    }
    // মুভি পোস্ট লজিক (আগের মতো)
    else if (s.step === 'title') { s.title = text; s.step = 'img'; bot.sendMessage(chatId, "ইমেজ লিঙ্ক দিন:"); }
    else if (s.step === 'img') { s.image = text; s.step = 'q_name'; bot.sendMessage(chatId, "কোয়ালিটি লিখুন (720p):"); }
    else if (s.step === 'q_name') { s.tempQ = text; s.step = 'q_link'; bot.sendMessage(chatId, "ডাউনলোড লিঙ্ক দিন:"); }
    else if (s.step === 'q_link') {
        s.links.push({ q: s.tempQ, link: text });
        s.step = 'q_name';
        bot.sendMessage(chatId, "আরও কোয়ালিটি যোগ করতে নাম লিখুন, নয়তো **Confirm** এ ক্লিক করুন।", {
            reply_markup: { inline_keyboard: [[{ text: "🚀 Confirm", callback_data: "confirm" }]] }
        });
    }
});

// --- ৫. সার্ভার লজিক ---
app.get('/', (req, res) => res.send("Bot is Running..."));
app.get('/post/:id', async (req, res) => {
    const p = await Post.findOne({ id: req.params.id });
    if (!p) return res.send("Not Found");
    // HTML রেন্ডারিং (আগের মতোই সুন্দর ডিজাইন)
    res.send(`...HTML Code...`);
});

app.listen(process.env.PORT || 3000, () => {
    console.log("Server Active");
});
