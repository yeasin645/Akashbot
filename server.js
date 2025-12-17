const express = require('express');
const TelegramBot = require('node-telegram-bot-api');
const app = express();

const token = 'আপনার_বট_টোকেন'; // BotFather থেকে নিন
const bot = new TelegramBot(token, {polling: true});

// ডাটাবেস হিসেবে একটি অবজেক্ট (সাময়িকভাবে)
let posts = {}; 

app.get('/post/:id', (req, res) => {
    const post = posts[req.params.id];
    if (!post) return res.send("Post Not Found!");

    // আপনার দেওয়া মনিটেগ সিস্টেম এবং ডিজাইন
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${post.title}</title>
        <script src='//libtl.com/sdk.js' data-zone='10341337' data-sdk='show_10341337'></script>
        <style>
            body { font-family: Arial; text-align: center; background: #f0f2f5; margin: 0; padding: 20px; }
            .card { max-width: 400px; margin: auto; background: white; border-radius: 15px; overflow: hidden; box-shadow: 0 4px 10px rgba(0,0,0,0.1); }
            img { width: 100%; height: auto; }
            .btn { background: #0088cc; color: white; padding: 15px; border: none; width: 90%; border-radius: 8px; font-weight: bold; cursor: pointer; margin: 20px 0; }
        </style>
    </head>
    <body>
        <div class="card">
            <img src="${post.image}">
            <h2>${post.title}</h2>
            <button class="btn" onclick="startAd()">Watch Ad to Unlock</button>
        </div>

        <script>
            let clicks = 0;
            function startAd() {
                if (clicks < 3) {
                    show_10341337().then(() => {
                        clicks++;
                        alert("Step " + clicks + "/3 Done");
                    }).catch(() => { 
                        clicks++; // অ্যাড না আসলেও পরের স্টেপে যাবে
                    });
                } else {
                    window.location.href = "${post.video}";
                }
            }
        </script>
    </body>
    </html>`;
    res.send(html);
});

bot.onText(/\/post/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(chatId, "পোস্ট তৈরি করতে এভাবে পাঠান:\n\nTitle | Image_URL | Video_URL");
});

bot.on('message', (msg) => {
    if (msg.text && msg.text.includes('|')) {
        const [title, img, vid] = msg.text.split('|').map(s => s.trim());
        const postId = Date.now(); // ইউনিক আইডি
        posts[postId] = { title: title, image: img, video: vid };
        
        const siteUrl = "https://আপনার-রেন্ডার-লিঙ্ক.onrender.com/post/" + postId;
        bot.sendMessage(msg.chat.id, "✅ আপনার পোস্ট তৈরি হয়েছে!\n\nলিঙ্ক: " + siteUrl);
    }
});

app.listen(process.env.PORT || 3000);
