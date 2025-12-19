import os
import logging
import threading
import time
import requests
import datetime
from flask import Flask
from pymongo import MongoClient
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.constants import ParseMode
from telegram.ext import (
    ApplicationBuilder,
    CommandHandler,
    MessageHandler,
    filters,
    ContextTypes,
    ConversationHandler,
    CallbackQueryHandler
)

# রেন্ডারের জন্য Flask অ্যাপ
app = Flask('')

@app.route('/')
def home():
    return "বট সচল আছে! ক্লিক কাউন্টার এবং মনিটেগ সক্রিয়।"

def keep_alive():
    url = os.environ.get('APP_URL') 
    if not url: return
    while True:
        try: requests.get(url)
        except: pass
        time.sleep(600)

def run_flask():
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

# --- MongoDB সেটআপ ---
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_database']
channels_collection = db['user_channels']
settings_collection = db['user_settings']

# লগিং
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# স্টেটসমূহ
NAME, POSTER, LANGUAGE, QUALITY, LINK, DONE = range(6)
CHAN_NAME, CHAN_LINK = range(6, 8)
SET_ZONE = 8
SET_CLICK = 9

# --- কমান্ড হ্যান্ডলারস ---

async def set_click_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔢 কতটি এড দেখার পর মেইন লিংক আসবে? (সংখ্যা লিখুন, যেমন: 3)")
    return SET_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        click_count = int(update.message.text)
        settings_collection.update_one(
            {"user_id": update.effective_user.id},
            {"$set": {"click_limit": click_count}},
            upsert=True
        )
        await update.message.reply_text(f"✅ সেট করা হয়েছে: {click_count}টি ক্লিক।")
    except:
        await update.message.reply_text("❌ শুধু সংখ্যা দিন।")
    return ConversationHandler.END

async def add_zone_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔗 আপনার **Monetag Direct Link** দিন:")
    return SET_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_collection.update_one(
        {"user_id": update.effective_user.id},
        {"$set": {"monetag_link": update.message.text}},
        upsert=True
    )
    await update.message.reply_text("✅ মনিটেগ লিংক সেভ হয়েছে।")
    return ConversationHandler.END

# --- মুভি পোস্ট তৈরি ---
async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🎬 মুভির নাম লিখুন:")
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['movie_name'] = update.message.text
    await update.message.reply_text("🖼️ পোস্টার লিংক দিন:")
    return POSTER

async def get_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['poster_link'] = update.message.text
    await update.message.reply_text("🌐 ভাষা কী?:")
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['language'] = update.message.text
    await update.message.reply_text("💿 কোয়ালিটি কী?:")
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['quality'] = update.message.text
    await update.message.reply_text("🔗 মুভির মেইন লিংক দিন:")
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['movie_link'] = update.message.text
    await update.message.reply_text("সব ঠিক থাকলে **Done** লিখুন।")
    return DONE

async def generate_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.message.text.lower() == "done":
        data = context.user_data
        user_id = update.effective_user.id
        
        settings = settings_collection.find_one({"user_id": user_id}) or {}
        monetag_link = settings.get("monetag_link", "#")
        click_limit = settings.get("click_limit", 1)

        user_channels = list(channels_collection.find({"user_id": user_id}))
        channel_html = ""
        if user_channels:
            channel_html = '<div style="margin-top:15px;">'
            for chan in user_channels:
                channel_html += f'<a href="{chan["url"]}" style="background:#333;color:#fff;padding:5px 10px;margin:2px;text-decoration:none;border-radius:3px;font-size:12px;display:inline-block;">{chan["name"]}</a>'
            channel_html += '</div>'

        # --- উন্নত HTML ও ক্লিক কাউন্টার সিস্টেম ---
        html_code = f"""
<div id="movie-box" style="text-align: center; border: 2px solid #eee; padding: 20px; border-radius: 15px; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 450px; margin: auto; background: #fff; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
    <img src="{data['poster_link']}" style="width: 100%; border-radius: 10px; margin-bottom: 15px;" />
    <h2 style="color: #222; margin: 10px 0;">{data['movie_name']}</h2>
    <p style="color: #555;"><b>Language:</b> {data['language']} | <b>Quality:</b> {data['quality']}</p>
    
    <div style="margin: 20px 0; background: #f9f9f9; padding: 15px; border-radius: 10px; border: 1px dashed #ccc;">
        <p id="counter-text" style="font-weight: bold; color: #d9534f; margin-bottom: 10px;">Steps Completed: 0 / {click_limit}</p>
        <div style="width: 100%; background: #ddd; height: 10px; border-radius: 5px; margin-bottom: 15px; overflow: hidden;">
            <div id="progress-bar" style="width: 0%; background: #d9534f; height: 100%; transition: 0.3s;"></div>
        </div>
        
        <button id="action-btn" onclick="processClick()" style="background: #d9534f; color: white; padding: 12px 25px; border: none; border-radius: 5px; font-weight: bold; font-size: 16px; cursor: pointer; width: 100%;">Click to Unlock</button>
    </div>

    {channel_html}
</div>

<script>
let currentClicks = 0;
const targetLimit = {click_limit};
const adUrl = "{monetag_link}";
const finalUrl = "{data['movie_link']}";

function processClick() {{
    if (currentClicks < targetLimit) {{
        window.open(adUrl, '_blank');
        currentClicks++;
        updateUI();
    }} else {{
        window.location.href = finalUrl;
    }}
}}

function updateUI() {{
    const percent = (currentClicks / targetLimit) * 100;
    document.getElementById('progress-bar').style.width = percent + "%";
    document.getElementById('counter-text').innerText = "Steps Completed: " + currentClicks + " / " + targetLimit;
    
    if (currentClicks >= targetLimit) {{
        document.getElementById('action-btn').innerText = "Download Now!";
        document.getElementById('action-btn').style.background = "#28a745";
        document.getElementById('progress-bar').style.background = "#28a745";
        document.getElementById('counter-text').style.color = "#28a745";
        document.getElementById('counter-text').innerText = "Link Unlocked! Click Download.";
    }} else {{
        document.getElementById('action-btn').innerText = "Next Step (" + (currentClicks + 1) + "/" + targetLimit + ")";
    }}
}}
</script>
"""
        await update.message.reply_text(f"✅ পোস্ট তৈরি হয়েছে! (ক্লিক লিমিট: {click_limit})")
        await update.message.reply_text(f"<code>{html_code}</code>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END
    return DONE

# --- অন্যান্য ফাংশন (চ্যানেল ম্যানেজমেন্ট) ---

async def add_channel_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📢 চ্যানেলের নাম দিন:")
    return CHAN_NAME

async def get_chan_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['c_name'] = update.message.text
    await update.message.reply_text("🔗 লিংক দিন:")
    return CHAN_LINK

async def get_chan_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels_collection.insert_one({"user_id": update.effective_user.id, "name": context.user_data['c_name'], "url": update.message.text})
    await update.message.reply_text("✅ এড হয়েছে।")
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("বাতিল হয়েছে।")
    return ConversationHandler.END

if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN') 
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    application = ApplicationBuilder().token(TOKEN).build()

    application.add_handler(ConversationHandler(
        entry_points=[CommandHandler('setclick', set_click_start)],
        states={SET_CLICK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_click)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))
    application.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addzone', add_zone_start)],
        states={SET_ZONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_zone)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))
    application.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addchannel', add_channel_start)],
        states={CHAN_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_chan_name)], CHAN_LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_chan_link)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))
    application.add_handler(ConversationHandler(
        entry_points=[CommandHandler('post', start_post)],
        states={NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)], POSTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)], LANGUAGE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)], QUALITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)], LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)], DONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, generate_post)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    application.run_polling()
