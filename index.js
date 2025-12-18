const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();

const token = process.env.BOT_TOKEN; 
const myAppUrl = process.env.APP_URL; 
const ADMIN_ID = process.env.ADMIN_ID; // আপনার টেলিগ্রাম আইডি এখানে দিন

const bot = new TelegramBot(token, {polling: true});

// ডিফল্ট ভেরিয়েবলসমূহ
let currentZoneId = process.env.ZONE_ID || '10341337';
let defaultPoster = process.env.DEFAULT_POSTER || 'https://via.placeholder.com/400x200.png';
let posts = {}; 

// অ্যাডমিন চেক ফাংশন
const isAdmin = (msg) => {
    return msg.from.id.toString() === ADMIN_ID;
};

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
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; margin: 0; display: flex; justify-content: center; align-items: center; min-height: 100vh; }
            .card { width: 90%; max-width: 400px; background: white; border-radius: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); overflow: hidden; text-align: center; }
            img { width: 100%; height: 200px; object-fit: cover; }
            .p-20 { padding: 25px; }
            .btn { background: #0088cc; color: white; border: none; padding: 15px; width: 100%; border-radius: 10px; font-size: 16px; font-weight: bold; cursor: pointer; transition: 0.3s; }
            .btn:hover { background: #0077b5; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${displayImage}">
            <div class="p-20">
                <h2 style="margin-top:0;">${post.title}</h2>
                <p style="color:#666; font-size:14px;">ভিডিওটি দেখতে নিচের বাটনে ক্লিক করুন এবং বিজ্ঞাপনগুলো সম্পন্ন করুন।</p>
                <button class="btn" onclick="startAd()">ভিডিওটি আনলক করুন</button>
            </div>
        </div>
        <script>
            let clicks = 0;
            function startAd() {
                const zoneFunc = "show_" + "${currentZoneId}";
                if (clicks < 3) {
                    if (typeof window[zoneFunc] === 'function') {
                        window[zoneFunc]().then(() => { 
                            clicks++; 
                            alert("ধাপ " + clicks + "/৩ সম্পন্ন হয়েছে!"); 
                        }).catch(() => { 
                            clicks++; 
                            alert("পরের ধাপে যাওয়ার জন্য আবার ক্লিক করুন।");
                        });
                    } else { 
                        clicks++; 
                        alert("বিজ্ঞাপন লোড হচ্ছে, আবার চেষ্টা করুন।");
                    }
                } else { 
                    window.location.href = "${post.video}"; 
                }
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

// কমান্ড লকিং এবং লজিক
bot.onText(/\/setvideo (\d+) (.+)/, (msg, match) => {
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "❌ আপনি এই বটের অ্যাডমিন নন!");
    
    const postId = match[1];
    const newVideoUrl = match[2].trim();
    if (posts[postId]) {
        posts[postId].video = newVideoUrl;
        bot.sendMessage(msg.chat.id, `✅ পোস্ট ${postId}-এর ভিডিও লিঙ্ক আপডেট হয়েছে!`);
    } else {
        bot.sendMessage(msg.chat.id, `❌ এই আইডি দিয়ে কোনো পোস্ট পাওয়া যায়নি।`);
    }
});

bot.onText(/\/setzone (.+)/, (msg, match) => { 
    if(!isAdmin(msg)) return;
    currentZoneId = match[1].trim(); 
    bot.sendMessage(msg.chat.id, `✅ জোন আইডি আপডেট হয়েছে: ${currentZoneId}`); 
});

bot.onText(/\/setposter (.+)/, (msg, match) => { 
    if(!isAdmin(msg)) return;
    defaultPoster = match[1].trim(); 
    bot.sendMessage(msg.chat.id, `✅ ডিফল্ট পোস্টার আপডেট হয়েছে!`); 
});

bot.on('message', (msg) => {
    // যদি টেক্সট থাকে এবং সেটা কমান্ড না হয় এবং মেসেজে '|' থাকে
    if (msg.text && !msg.text.startsWith('/') && msg.text.includes('|')) {
        if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "❌ দুঃখিত, আপনি পোস্ট তৈরি করতে পারবেন না।");

        const parts = msg.text.split('|').map(s => s.trim());
        if(parts.length < 3) return bot.sendMessage(msg.chat.id, "❌ ফরম্যাট ভুল! সঠিক ফরম্যাট: Title | ImageURL | VideoURL");

        const [title, img, vid] = parts;
        const postId = Date.now().toString().slice(-6); 
        posts[postId] = { title, image: img, video: vid };
        
        bot.sendMessage(msg.chat.id, `✅ পোস্ট তৈরি হয়েছে!\n\n🆔 ID: ${postId}\n🔗 URL: ${myAppUrl}/post/${postId}`);
    }
});

// হেল্প কমান্ড
bot.onText(/\/start/, (msg) => {
    if(!isAdmin(msg)) return bot.sendMessage(msg.chat.id, "ভুল জায়গায় চলে এসেছেন! এটি একটি প্রাইভেট বট।");
    bot.sendMessage(msg.chat.id, "স্বাগতম অ্যাডমিন! পোস্ট তৈরি করতে এভাবে মেসেজ দিন:\n\n`Title | ImageURL | VideoURL`", {parse_mode: "Markdown"});
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
