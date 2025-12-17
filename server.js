const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();

const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL;
const bot = new TelegramBot(token, { polling: true });

let currentZoneId = process.env.ZONE_ID || '10341337';
let requiredClicks = 3; 
let channels = []; 

let posts = {};
let userState = {};

app.get('/post/:id', (req, res) => {
    const post = posts[req.params.id];
    if (!post) return res.send("পোস্টটি পাওয়া যায়নি!");
    res.send(generateHTML(post, currentZoneId, requiredClicks, channels));
});

// HTML জেনারেটর ফাংশন
function generateHTML(post, zoneId, clicksCount, channelList) {
    let qualityButtons = "";
    post.links.forEach((item) => {
        qualityButtons += `<button class="btn q-btn" onclick="startAd('${item.link}')">${item.quality} - আনলক করুন</button>`;
    });

    let channelSection = "";
    if (channelList.length > 0) {
        channelSection = `<div class="channel-box"><h3>📢 জয়েন করুন:</h3>`;
        channelList.forEach((ch, index) => {
            channelSection += `<a href="${ch}" target="_blank" class="ch-link">চ্যানেল ${index + 1}</a>`;
        });
        channelSection += `</div>`;
    }

    return `<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${post.title}</title>
    <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
    <style>
        body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
        .card { width: 95%; max-width: 400px; background: white; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); overflow: hidden; text-align: center; padding-bottom: 20px; }
        img { width: 100%; height: auto; display: block; border-bottom: 1px solid #eee; }
        .content { padding: 15px; }
        .status { font-size: 14px; color: #d32f2f; margin-bottom: 15px; font-weight: bold; background: #ffebee; padding: 10px; border-radius: 8px; }
        .channel-box { background: #e3f2fd; padding: 10px; margin-bottom: 15px; border-radius: 10px; border: 1px dashed #2196f3; }
        .ch-link { display: inline-block; background: #2196f3; color: white; text-decoration: none; padding: 5px 10px; margin: 5px; border-radius: 5px; font-size: 12px; }
        .btn { background: #0088cc; color: white; border: none; padding: 12px; width: 90%; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 15px; margin-bottom: 10px; }
        .q-btn { background: #333; }
    </style>
</head>
<body>
    <div class="card">
        <img src="${post.image}">
        <div class="content">
            <h2 style="margin: 0 0 10px 0;">${post.title}</h2>
            ${channelSection}
            <div class="status" id="stat-text">অ্যাড দেখা হয়েছে: 0/${clicksCount}</div>
            ${qualityButtons}
        </div>
    </div>
    <script>
        let currentClicks = 0;
        const target = ${clicksCount};
        function startAd(targetUrl) {
            const zoneFunc = "show_" + "${zoneId}";
            const stat = document.getElementById('stat-text');
            if (currentClicks < target) {
                if (typeof window[zoneFunc] === 'function') {
                    window[zoneFunc]().then(() => {
                        currentClicks++;
                        stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target;
                        if(currentClicks === target) alert("অ্যাড সম্পন্ন! আবার ক্লিক করুন।");
                    }).catch(() => { currentClicks++; stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target; });
                } else { currentClicks++; stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target; }
            } else { window.location.href = targetUrl; }
        }
    </script>
</body>
</html>`;
}

// কমান্ডসমূহ
bot.onText(/\/setchannels/, (msg) => {
    userState[msg.chat.id] = { step: 'ch1' };
    bot.sendMessage(msg.chat.id, "📢 ১ম চ্যানেলের লিঙ্ক দিন (অথবা 'skip'):");
});

bot.onText(/\/post/, (msg) => {
    userState[msg.chat.id] = { step: 1, links: [] };
    bot.sendMessage(msg.chat.id, "🎬 মুভির নাম (Title) লিখুন:");
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!userState[chatId] || !text || text.startsWith('/')) return;

    let state = userState[chatId];

    if (state.step === 'ch1') {
        channels = []; if (text.toLowerCase() !== 'skip') channels.push(text);
        state.step = 'ch2'; bot.sendMessage(chatId, "📢 ২য় চ্যানেল (অথবা 'skip'):");
    } else if (state.step === 'ch2') {
        if (text.toLowerCase() !== 'skip') channels.push(text);
        state.step = 'ch3'; bot.sendMessage(chatId, "📢 ৩য় চ্যানেল (অথবা 'skip'):");
    } else if (state.step === 'ch3') {
        if (text.toLowerCase() !== 'skip') channels.push(text);
        delete userState[chatId]; bot.sendMessage(chatId, "✅ চ্যানেল সেট হয়েছে।");
    } else if (state.step === 1) {
        state.title = text; state.step = 2; bot.sendMessage(chatId, "🖼 পোস্টার লিঙ্ক দিন:");
    } else if (state.step === 2) {
        state.image = text; state.step = 3; bot.sendMessage(chatId, "📊 ১ম কোয়ালিটি অথবা 'skip':");
    } else if (state.step === 3) {
        if (text.toLowerCase() !== 'skip') { state.tempQ = text; state.step = 4; bot.sendMessage(chatId, `🔗 ${text} লিঙ্ক:`); }
        else { state.step = 5; bot.sendMessage(chatId, "📊 ২য় কোয়ালিটি অথবা 'skip':"); }
    } else if (state.step === 4) {
        state.links.push({ quality: state.tempQ, link: text }); state.step = 5; bot.sendMessage(chatId, "📊 ২য় কোয়ালিটি অথবা 'skip':");
    } else if (state.step === 5) {
        if (text.toLowerCase() !== 'skip') { state.tempQ = text; state.step = 6; bot.sendMessage(chatId, `🔗 ${text} লিঙ্ক:`); }
        else { state.step = 7; bot.sendMessage(chatId, "📊 ৩য় কোয়ালিটি অথবা 'skip':"); }
    } else if (state.step === 6) {
        state.links.push({ quality: state.tempQ, link: text }); state.step = 7; bot.sendMessage(chatId, "📊 ৩য় কোয়ালিটি অথবা 'skip':");
    } else if (state.step === 7) {
        if (text.toLowerCase() !== 'skip') { state.tempQ = text; state.step = 8; bot.sendMessage(chatId, `🔗 ${text} লিঙ্ক:`); }
        else { completePost(chatId); }
    } else if (state.step === 8) {
        state.links.push({ quality: state.tempQ, link: text }); completePost(chatId);
    }
});

function completePost(chatId) {
    const state = userState[chatId];
    const opts = { reply_markup: { inline_keyboard: [[{ text: "✅ ফাইনাল করুন", callback_data: 'confirm_post' }]] } };
    bot.sendMessage(chatId, `সব তথ্য ঠিক আছে?\n\nনাম: ${state.title}`, opts);
}

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'confirm_post' && userState[chatId]) {
        const state = userState[chatId];
        const postId = Date.now().toString().slice(-6);
        posts[postId] = { title: state.title, image: state.image, links: state.links };

        const finalUrl = `${myAppUrl}/post/${postId}`;
        const rawHtml = generateHTML(state.title, state.image, state.quality, state.video, currentZoneId, requiredClicks, channels);

        // ১. লিঙ্ক পাঠানো
        bot.sendMessage(chatId, `🎉 পোস্ট তৈরি হয়েছে।\n🔗 **লিঙ্ক:** ${finalUrl}`);
        
        // ২. HTML কোড পাঠানো (কপি করার জন্য)
        bot.sendMessage(chatId, `📄 **ব্লগার/HTML কোড:**\n\n\`\`\`html\n${generateHTML(posts[postId], currentZoneId, requiredClicks, channels)}\n\`\`\``, { parse_mode: 'MarkdownV2' });

        // ৩. প্রিভিউ বাটন
        const previewOpts = { reply_markup: { inline_keyboard: [[{ text: "👁️ লাইভ প্রিভিউ দেখুন", url: finalUrl }]] } };
        bot.sendMessage(chatId, "নিচের বাটনে ক্লিক করে প্রিভিউ দেখে নিন:", previewOpts);

        delete userState[chatId];
    }
});

app.listen(process.env.PORT || 3000);
