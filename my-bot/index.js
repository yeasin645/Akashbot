require('dotenv').config();
const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const mongoose = require('mongoose');
const moment = require('moment-timezone');
const startPinger = require('./utils/pinger');

const app = express();
const bot = new TelegramBot(process.env.BOT_TOKEN, { polling: true });
const ADMIN_ID = parseInt(process.env.ADMIN_ID);

// --- MongoDB Connection ---
mongoose.connect(process.env.MONGODB_URI).then(() => console.log("✅ Database Connected!"));

// --- Database Schemas ---
const User = mongoose.model('User', new mongoose.Schema({ userId: Number, joinedAt: { type: Date, default: Date.now } }));
const PremiumUser = mongoose.model('PremiumUser', new mongoose.Schema({ userId: Number, packageName: String, expiryDate: Date }));
const UserProfile = mongoose.model('UserProfile', new mongoose.Schema({ userId: Number, savedChannels: { type: Array, default: [] }, userZoneId: { type: String, default: null } }));
const Post = mongoose.model('Post', new mongoose.Schema({ id: String, creatorId: Number, title: String, image: String, language: String, links: Array, channels: Array, zoneId: String, clicks: { type: Number, default: 3 } }));

let userState = {};

// --- Helper Functions ---
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

// --- Main Menu ---
async function showMainMenu(chatId) {
    let buttons = [
        [{ text: "🎬 মুভি পোস্ট তৈরি", callback_data: "start_post" }],
        [{ text: "📢 চ্যানেল সেটআপ", callback_data: "setup_channels_menu" }, { text: "🆔 জোন আইডি সেট", callback_data: "set_user_zone" }],
        [{ text: "💎 প্রিমিয়াম প্ল্যান", callback_data: "view_premium" }]
    ];
    if (chatId === ADMIN_ID) {
        buttons.push(
            [{ text: "📊 পরিসংখ্যান", callback_data: "view_stats" }, { text: "➕ মেম্বার অ্যাড", callback_data: "add_user_prompt" }],
            [{ text: "🗑 মেম্বার রিমুভ", callback_data: "del_user_prompt" }]
        );
    }
    bot.sendMessage(chatId, "🛠 **বট মেইন মেনু**", { parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
}

// --- Bot Logic ---
bot.onText(/\/start/, async (msg) => {
    await User.findOneAndUpdate({ userId: msg.chat.id }, { userId: msg.chat.id }, { upsert: true });
    showMainMenu(msg.chat.id);
});

bot.on('callback_query', async (q) => {
    const chatId = q.message.chat.id;
    const data = q.data;
    const premium = await isPremium(chatId);

    // সিকিউরিটি লক: প্রিমিয়াম চেক
    const restricted = ["start_post", "setup_channels_menu", "set_user_zone"];
    if (restricted.includes(data) && !premium) {
        return bot.answerCallbackQuery(q.id, { text: "❌ এই ফিচারটি শুধুমাত্র প্রিমিয়াম মেম্বারদের জন্য!", show_alert: true });
    }

    if (data === "start_post") {
        userState[chatId] = { step: 'title', links: [] };
        bot.sendMessage(chatId, "🎬 মুভির নাম লিখুন:");
    }
    else if (data === "view_stats" && chatId === ADMIN_ID) {
        const users = await User.countDocuments();
        const prem = await PremiumUser.countDocuments();
        bot.sendMessage(chatId, `📊 মোট ইউজার: ${users}\n💎 প্রিমিয়াম মেম্বার: ${prem}`);
    }
    else if (data === "add_user_prompt" && chatId === ADMIN_ID) {
        userState[chatId] = { step: 'add_user' };
        bot.sendMessage(chatId, "👤 অ্যাড করতে লিখুন: `UserID | Days | PackageName`", { parse_mode: 'Markdown' });
    }
    bot.answerCallbackQuery(q.id);
});

bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!text || text.startsWith('/')) return;

    if (userState[chatId]) {
        let s = userState[chatId];
        if (s.step === 'add_user' && chatId === ADMIN_ID) {
            const p = text.split('|');
            if (p.length < 3) return bot.sendMessage(chatId, "❌ ফরম্যাট ভুল।");
            const expiry = moment().add(parseInt(p[1]), 'days').toDate();
            await PremiumUser.findOneAndUpdate({ userId: parseInt(p[0]) }, { packageName: p[2].trim(), expiryDate: expiry }, { upsert: true });
            bot.sendMessage(chatId, "✅ মেম্বার সফলভাবে প্রিমিয়াম করা হয়েছে।");
            delete userState[chatId];
        }
        // অন্যান্য ইনপুট হ্যান্ডলিং এখানে আগের মতোই থাকবে...
    }
});

// --- Server Setup ---
app.get('/', (req, res) => res.send("🤖 Bot is Online!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
    startPinger(process.env.APP_URL);
});
