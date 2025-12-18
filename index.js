const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');

const app = express();
app.use(express.json());

// --- ১. কনফিগারেশন ---
const config = {
    token: process.env.BOT_TOKEN,
    mongoUri: process.env.MONGODB_URI,
    adminId: parseInt(process.env.ADMIN_ID),
    adminUser: process.env.ADMIN_USERNAME, 
    appUrl: process.env.APP_URL, 
};

const bot = new TelegramBot(config.token, { polling: true });

// --- ২. ডাটাবেস মডেলসমূহ ---
mongoose.connect(config.mongoUri).then(() => console.log("✅ DB Connected"));

const User = mongoose.model('User', new mongoose.Schema({ userId: Number, name: String }));
const Premium = mongoose.model('Premium', new mongoose.Schema({ userId: Number, expiry: Date }));
const Profile = mongoose.model('Profile', new mongoose.Schema({ 
    userId: { type: Number, unique: true }, 
    zoneId: { type: String, default: '10341337' }, 
    adCount: { type: Number, default: 3 }, 
    channels: { type: Array, default: [] } 
}));
const Plan = mongoose.model('Plan', new mongoose.Schema({ name: String, price: String, days: Number })); // প্ল্যান মডেল
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
    if (new Date() > p.expiry) { 
        await Premium.deleteOne({ userId: id }); 
        return false; 
    }
    return true;
}

// মেইন মেনু বাটন
function getMenu(chatId) {
    let btns = [
        [{ text: "🎬 মুভি পোস্ট তৈরি 🔒", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটিংস 🔒", callback_data: "setup_ch" }, { text: "🆔 জোন আইডি 🔒", callback_data: "set_zone" }],
        [{ text: "🔢 অ্যাড লিমিট 🔒", callback_data: "set_ad_limit" }, { text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === config.adminId) {
        btns.push(
            [{ text: "📊 স্ট্যাটাস", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "add_p" }],
            [{ text: "📝 প্ল্যান সেটআপ (Admin)", callback_data: "manage_plans" }, { text: "🗑 মেম্বার ডিলিট", callback_data: "del_p" }]
        );
    }
    return { inline_keyboard: btns };
}

// --- ৩. কমান্ড ও বাটন লজিক ---
bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await User.findOneAndUpdate({ userId: chatId }, { userId: chatId, name: msg.from.first_name }, { upsert: true });
    await Profile.findOneAndUpdate({ userId: chatId }, { userId: chatId }, { upsert: true });
    
    bot.sendMessage(chatId, "👋 স্বাগতম! আপনার মুভি কন্ট্রোল প্যানেল তৈরি।", { 
        parse_mode: 'Markdown', 
        reply_markup: getMenu(chatId) 
    });
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const isP = await isPremium(chatId);

    if (["start_post", "setup_ch", "set_zone", "set_ad_limit"].includes(q.data) && !isP) {
        return bot.sendMessage(chatId, "🛑 দুঃখিত, এটি শুধুমাত্র প্রিমিয়াম ইউজারদের জন্য।", { 
            reply_markup: { inline_keyboard: [[{ text: "💎 প্ল্যান দেখুন", callback_data: "view_premium" }]] } 
        });
    }

    switch (q.data) {
        case "view_premium":
            const allPlans = await Plan.find();
            let pText = "💎 **আমাদের বর্তমান প্রিমিয়াম প্ল্যানসমূহ:**\n\n";
            if (allPlans.length === 0) pText += "_কোনো প্ল্যান এখনো সেট করা হয়নি।_";
            else allPlans.forEach(p => pText += `✅ **${p.name}**\n💰 দাম: ${p.price}\n⏳ মেয়াদ: ${p.days} দিন\n\n`);
            
            bot.sendMessage(chatId, pText, { 
                parse_mode: 'Markdown',
                reply_markup: { inline_keyboard: [[{ text: "💬 কিনতে যোগাযোগ করুন", url: `https://t.me/${config.adminUser}` }]] } 
            });
            break;

        case "manage_plans": // এডমিন নতুন প্ল্যান এড করবে
            bot.sendMessage(chatId, "📝 প্ল্যান ম্যানেজমেন্ট:", {
                reply_markup: { inline_keyboard: [[{ text: "➕ নতুন প্ল্যান যোগ করুন", callback_data: "add_new_plan" }], [{ text: "🗑 সব প্ল্যান মুছুন", callback_data: "clear_plans" }]] }
            });
            break;

        case "add_new_plan":
            userState[chatId] = { step: 'plan_name' };
            bot.sendMessage(chatId, "প্ল্যানটির নাম দিন (উদা: Basic Plan):");
            break;

        case "clear_plans":
            await Plan.deleteMany({});
            bot.sendMessage(chatId, "✅ সব প্রিমিয়াম প্ল্যান মুছে ফেলা হয়েছে।");
            break;

        case "setup_ch":
            const prof = await Profile.findOne({ userId: chatId });
            let chList = "📢 **আপনার চ্যানেলসমূহ:**\n";
            if (!prof.channels.length) chList += "_কিছুই নেই_";
            else prof.channels.forEach((c, i) => chList += `${i+1}. ${c.name}\n`);
            bot.sendMessage(chatId, chList, {
                reply_markup: { inline_keyboard: [[{ text: "➕ অ্যাড চ্যানেল", callback_data: "add_ch" }], [{ text: "🗑 ডিলিট অল", callback_data: "clear_ch" }]] }
            });
            break;

        case "add_ch":
            userState[chatId] = { step: 'ch_name' };
            bot.sendMessage(chatId, "চ্যানেলের নাম দিন:");
            break;

        case "set_zone":
            userState[chatId] = { step: 'zone' };
            bot.sendMessage(chatId, "Adsterra Zone ID দিন:");
            break;

        case "set_ad_limit":
            userState[chatId] = { step: 'ad_limit' };
            bot.sendMessage(chatId, "কতটি অ্যাড দেখাতে চান? (সংখ্যা দিন):");
            break;

        case "add_p":
            userState[chatId] = { step: 'add_p_id' };
            bot.sendMessage(chatId, "যাকে প্রিমিয়াম দিবেন তার Telegram ID দিন:");
            break;

        case "view_stats":
            const totalUsers = await User.countDocuments();
            const totalP = await Premium.countDocuments();
            bot.sendMessage(chatId, `📊 **বট স্ট্যাটাস:**\n\n👥 মোট ইউজার: ${totalUsers}\n💎 প্রিমিয়াম মেম্বার: ${totalP}`);
            break;
    }
    bot.answerCallbackQuery(q.id);
});

// --- ৪. টেক্সট ইনপুট হ্যান্ডলিং ---
bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;
    const s = userState[chatId];
    if (!s) return;

    // প্ল্যান এড করার লজিক
    if (s.step === 'plan_name') {
        s.pN = text; s.step = 'plan_price';
        bot.sendMessage(chatId, "প্ল্যানটির দাম লিখুন (উদা: ১০০ টাকা):");
    } else if (s.step === 'plan_price') {
        s.pP = text; s.step = 'plan_days';
        bot.sendMessage(chatId, "মেয়াদ কত দিন? (শুধু সংখ্যা দিন, উদা: ৩০):");
    } else if (s.step === 'plan_days') {
        await new Plan({ name: s.pN, price: s.pP, days: parseInt(text) }).save();
        bot.sendMessage(chatId, `✅ সফল! **${s.pN}** প্রিমিয়াম লিস্টে যুক্ত হয়েছে।`);
        delete userState[chatId];
    }

    // জোন আইডি ও অ্যাড লিমিট সেভ
    else if (s.step === 'zone') {
        await Profile.findOneAndUpdate({ userId: chatId }, { zoneId: text });
        bot.sendMessage(chatId, "✅ Zone ID সেভ হয়েছে।");
        delete userState[chatId];
    } else if (s.step === 'ad_limit') {
        await Profile.findOneAndUpdate({ userId: chatId }, { adCount: parseInt(text) });
        bot.sendMessage(chatId, "✅ Ad Limit আপডেট হয়েছে।");
        delete userState[chatId];
    }

    // মেম্বারশিপ এড
    else if (s.step === 'add_p_id') {
        s.target = text; s.step = 'add_p_days';
        bot.sendMessage(chatId, "কত দিনের জন্য দিবেন? (সংখ্যা দিন):");
    } else if (s.step === 'add_p_days') {
        const exp = moment().add(parseInt(text), 'days').toDate();
        await Premium.findOneAndUpdate({ userId: parseInt(s.target) }, { expiry: exp }, { upsert: true });
        bot.sendMessage(chatId, `✅ ইউজার ${s.target} এখন প্রিমিয়াম।`);
        bot.sendMessage(s.target, "🎊 অভিনন্দন! আপনার প্রিমিয়াম মেম্বারশিপ একটিভ হয়েছে।").catch(()=>{});
        delete userState[chatId];
    }

    // চ্যানেল লজিক
    else if (s.step === 'ch_name') {
        s.cN = text; s.step = 'ch_link';
        bot.sendMessage(chatId, "চ্যানেলের লিঙ্ক দিন:");
    } else if (s.step === 'ch_link') {
        await Profile.findOneAndUpdate({ userId: chatId }, { $push: { channels: { name: s.cN, link: text } } });
        bot.sendMessage(chatId, "✅ চ্যানেল সেভ হয়েছে।");
        delete userState[chatId];
    }
});

// --- ৫. এক্সপ্রেস সার্ভার ---
app.get('/', (req, res) => res.send("Movie Bot is Active!"));
app.listen(process.env.PORT || 3000);
