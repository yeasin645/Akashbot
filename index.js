const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();

const token = process.env.BOT_TOKEN; 
const myAppUrl = process.env.APP_URL; 

const bot = new TelegramBot(token, {polling: true});

// ডিফল্ট ভেরিয়েবলসমূহ
let currentZoneId = process.env.ZONE_ID || '10341337';
let defaultPoster = process.env.DEFAULT_POSTER || 'https://via.placeholder.com/400x200.png';
let posts = {}; // সব পোস্ট এখানে সেভ থাকবে

app.get('/post/:id', (req, res) => {
    const post = posts[req.params.id];
    if (!post) return res.send("পোস্টটি খুঁজে পাওয়া যায়নি!");

    const displayImage = post.image || defaultPoster;

    const html = `
    <!DOCTYPE html>
    <html lang="bn">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${post.title}</title>
        <script src='//libtl.com/sdk.js' data-zone='${currentZoneId}' data-sdk='show_${currentZoneId}'></script>
        <style>
            body { font-family: Arial; background: #f4f7f9; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .card { width: 90%; max-width: 400px; background: white; border-radius: 15px; box-shadow: 0 5px 20px rgba(0,0,0,0.1); overflow: hidden; text-align: center; }
            img { width: 100%; display: block; }
            .p-20 { padding: 20px; }
            .btn { background: #0088cc; color: white; border: none; padding: 15px; width: 100%; border-radius: 8px; font-weight: bold; cursor: pointer; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${displayImage}">
            <div class="p-20">
                <h2>${post.title}</h2>
                <button class="btn" onclick="startAd()">ভিডিওটি আনলক করুন</button>
            </div>
        </div>
        <script>
            let clicks = 0;
            function startAd() {
                const zoneFunc = "show_" + "${currentZoneId}";
                if (clicks < 3) {
                    if (typeof window[zoneFunc] === 'function') {
                        window[zoneFunc]().then(() => { clicks++; alert("ধাপ " + clicks + "/৩ সম্পন্ন!"); })
                        .catch(() => { clicks++; });
                    } else { clicks++; }
                } else { window.location.href = "${post.video}"; }
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

// কমান্ড: নির্দিষ্ট পোস্টের ভিডিও লিঙ্ক পরিবর্তন করা
bot.onText(/\/setvideo (\d+) (.+)/, (msg, match) => {
    const postId = match[1];
    const newVideoUrl = match[2].trim();
    if (posts[postId]) {
        posts[postId].video = newVideoUrl;
        bot.sendMessage(msg.chat.id, `✅ পোস্ট ${postId}-এর ভিডিও লিঙ্ক আপডেট হয়েছে!`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ এই আইডি দিয়ে কোনো পোস্ট পাওয়া যায়নি।`);
    }
});

// কমান্ড: জোন আইডি এবং পোস্টার পরিবর্তন
bot.onText(/\/setzone (.+)/, (msg, match) => { currentZoneId = match[1].trim(); bot.sendMessage(msg.chat.id, `✅ জোন আইডি আপডেট হয়েছে!`); });
bot.onText(/\/setposter (.+)/, (msg, match) => { defaultPoster = match[1].trim(); bot.sendMessage(msg.chat.id, `✅ ডিফল্ট পোস্টার আপডেট হয়েছে!`); });

bot.on('message', (msg) => {
    if (msg.text && msg.text.includes('|')) {
        const [title, img, vid] = msg.text.split('|').map(s => s.trim());
        const postId = Date.now().toString().slice(-6); // ছোট ৬ ডিজিটের আইডি
        posts[postId] = { title, image: img, video: vid };
        
        bot.sendMessage(msg.chat.id, `✅ পোস্ট তৈরি হয়েছে!\n\nID: ${postId}\nURL: ${myAppUrl}/post/${postId}`);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running...`));
