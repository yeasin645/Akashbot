const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();

const token = process.env.BOT_TOKEN;
const myAppUrl = process.env.APP_URL;
const bot = new TelegramBot(token, { polling: true });

let currentZoneId = process.env.ZONE_ID || '10341337';
let requiredClicks = 3; 

let posts = {};
let userState = {};

app.get('/post/:id', (req, res) => {
    const post = posts[req.params.id];
    if (!post) return res.send("পোস্টটি পাওয়া যায়নি!");

    const html = generateHTML(post, currentZoneId, requiredClicks);
    res.send(html);
});

function generateHTML(post, zoneId, clicksCount) {
    // কোয়ালিটি বাটন তৈরি
    let qualityButtons = "";
    post.links.forEach((item, index) => {
        qualityButtons += `<button class="btn q-btn" onclick="startAd('${item.link}')">${item.quality} - আনলক করুন</button>`;
    });

    return `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${post.title}</title>
        <script src='//libtl.com/sdk.js' data-zone='${zoneId}' data-sdk='show_${zoneId}'></script>
        <style>
            body { font-family: Arial, sans-serif; background: #f0f2f5; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .card { width: 90%; max-width: 400px; background: white; border-radius: 20px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); overflow: hidden; text-align: center; padding-bottom: 20px; }
            img { width: 100%; height: auto; display: block; }
            .content { padding: 20px; }
            .status { font-size: 14px; color: #d32f2f; margin-bottom: 15px; font-weight: bold; background: #ffebee; padding: 5px; border-radius: 5px; }
            .btn { background: #0088cc; color: white; border: none; padding: 12px; width: 90%; border-radius: 10px; font-weight: bold; cursor: pointer; font-size: 15px; margin-bottom: 10px; transition: 0.3s; }
            .q-btn { background: #333; }
            .btn:active { transform: scale(0.95); }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${post.image}">
            <div class="content">
                <h2 style="margin: 0 0 15px 0;">${post.title}</h2>
                <div class="status" id="stat-text">অ্যাড দেখা হয়েছে: 0/${clicksCount}</div>
                ${qualityButtons}
            </div>
        </div>
        <script>
            let currentClicks = 0;
            const target = ${clicksCount};
            let pendingUrl = "";

            function startAd(targetUrl) {
                pendingUrl = targetUrl;
                const zoneFunc = "show_" + "${zoneId}";
                const stat = document.getElementById('stat-text');

                if (currentClicks < target) {
                    if (typeof window[zoneFunc] === 'function') {
                        window[zoneFunc]().then(() => {
                            currentClicks++;
                            stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target;
                            if(currentClicks === target) checkRedirect();
                        }).catch(() => {
                            currentClicks++;
                            stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target;
                            if(currentClicks === target) checkRedirect();
                        });
                    } else {
                        currentClicks++;
                        stat.innerText = "অ্যাড দেখা হয়েছে: " + currentClicks + "/" + target;
                        if(currentClicks === target) checkRedirect();
                    }
                } else {
                    window.location.href = pendingUrl;
                }
            }

            function checkRedirect() {
                alert("সব অ্যাড সম্পন্ন! আবার বাটনে ক্লিক করুন ভিডিও দেখতে।");
            }
        </script>
    </body>
    </html>`;
}

bot.onText(/\/post/, (msg) => {
    const chatId = msg.chat.id;
    userState[chatId] = { step: 1, links: [] };
    bot.sendMessage(chatId, "🎬 মুভির নাম (Title) লিখুন:");
});

bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (!userState[chatId] || !text || text.startsWith('/')) return;

    let state = userState[chatId];

    if (state.step === 1) {
        state.title = text; state.step = 2;
        bot.sendMessage(chatId, "🖼 পোস্টার লিঙ্ক (URL) দিন:");
    } else if (state.step === 2) {
        state.image = text; state.step = 3;
        bot.sendMessage(chatId, "📊 ১ম কোয়ালিটি লিখুন (যেমন: 480p) অথবা 'skip':");
    } else if (state.step === 3) {
        if (text.toLowerCase() !== 'skip') {
            state.tempQ = text; state.step = 4;
            bot.sendMessage(chatId, `🔗 ${text}-এর ভিডিও লিঙ্ক দিন:`);
        } else {
            state.step = 5;
            bot.sendMessage(chatId, "📊 ২য় কোয়ালিটি লিখুন (যেমন: 720p) অথবা 'skip':");
        }
    } else if (state.step === 4) {
        state.links.push({ quality: state.tempQ, link: text }); state.step = 5;
        bot.sendMessage(chatId, "📊 ২য় কোয়ালিটি লিখুন (যেমন: 720p) অথবা 'skip':");
    } else if (state.step === 5) {
        if (text.toLowerCase() !== 'skip') {
            state.tempQ = text; state.step = 6;
            bot.sendMessage(chatId, `🔗 ${text}-এর ভিডিও লিঙ্ক দিন:`);
        } else {
            state.step = 7;
            bot.sendMessage(chatId, "📊 ৩য় কোয়ালিটি লিখুন (যেমন: 1080p) অথবা 'skip':");
        }
    } else if (state.step === 6) {
        state.links.push({ quality: state.tempQ, link: text }); state.step = 7;
        bot.sendMessage(chatId, "📊 ৩য় কোয়ালিটি লিখুন (যেমন: 1080p) অথবা 'skip':");
    } else if (state.step === 7) {
        if (text.toLowerCase() !== 'skip') {
            state.tempQ = text; state.step = 8;
            bot.sendMessage(chatId, `🔗 ${text}-এর ভিডিও লিঙ্ক দিন:`);
        } else {
            completePost(chatId);
        }
    } else if (state.step === 8) {
        state.links.push({ quality: state.tempQ, link: text });
        completePost(chatId);
    }
});

function completePost(chatId) {
    const state = userState[chatId];
    if (state.links.length === 0) {
        bot.sendMessage(chatId, "❌ কোনো লিঙ্ক দেওয়া হয়নি। আবার /post করুন।");
        delete userState[chatId];
        return;
    }
    const opts = { reply_markup: { inline_keyboard: [[{ text: "✅ ফাইনাল করুন", callback_data: 'confirm_post' }]] } };
    bot.sendMessage(chatId, `সব তথ্য ঠিক আছে?\n\nনাম: ${state.title}\nলিঙ্ক সংখ্যা: ${state.links.length}`, opts);
}

bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    if (query.data === 'confirm_post' && userState[chatId]) {
        const state = userState[chatId];
        const postId = Date.now().toString().slice(-6);
        posts[postId] = { title: state.title, image: state.image, links: state.links };

        const finalUrl = `${myAppUrl}/post/${postId}`;
        bot.sendMessage(chatId, `🎉 পোস্ট তৈরি হয়েছে।\n🔗 লিঙ্ক: ${finalUrl}`);
        delete userState[chatId];
    }
});

// অন্যান্য কমান্ড
bot.onText(/\/setclicks (\d+)/, (msg, match) => { requiredClicks = parseInt(match[1]); bot.sendMessage(msg.chat.id, `✅ অ্যাড সংখ্যা: ${requiredClicks}`); });
bot.onText(/\/setzone (.+)/, (msg, match) => { currentZoneId = match[1].trim(); bot.sendMessage(msg.chat.id, `✅ জোন আইডি: ${currentZoneId}`); });

app.listen(process.env.PORT || 3000);
