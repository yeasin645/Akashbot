import os
import logging
import threading
import time
import requests
import datetime
import html
from flask import Flask
from pymongo import MongoClient
from bson.objectid import ObjectId
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

# --- রেন্ডার ও ফ্লস্ক সেটআপ ---
app = Flask('')

@app.route('/')
def home():
    return "বট সচল আছে! প্রিভিউ এবং আনলিমিটেড কোয়ালিটি সক্রিয়।"

def keep_alive():
    url = os.environ.get('APP_URL') 
    if not url: return
    while True:
        try: requests.get(url); print("Self-ping success.")
        except: print("Self-ping failed.")
        time.sleep(300)

def run_flask():
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

# --- ডাটাবেজ কানেকশন ---
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_bot_db']
channels_col = db['channels']
settings_col = db['settings']

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(6)
CH_NAME, CH_LINK, SET_ZONE, SET_CLICK = range(6, 10)

# --- হেল্পার ফাংশন ---
def get_user_settings(user_id):
    settings = settings_col.find_one({"user_id": user_id})
    return settings if settings else {"monetag_link": "#", "click_limit": 1}

# --- কমান্ড হ্যান্ডলারস ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "👋 **মুভি পোস্ট জেনারেটর বটে স্বাগতম!**\n\n"
        "📜 **বটের সকল কমান্ডসমূহ:**\n"
        "🎬 /post - আনলিমিটেড কোয়ালিটিসহ পোস্ট তৈরি করুন।\n"
        "📢 /addchannel - নতুন চ্যানেল অ্যাড করুন।\n"
        "📋 /channels - অ্যাড করা চ্যানেল দেখুন ও ডিলিট করুন।\n"
        "🔢 /setclick - অ্যাড লিমিট বা ক্লিক সেট করুন।\n"
        "🔗 /addzone - Monetag Direct Link সেট করুন।\n"
        "❌ /cancel - যেকোনো কাজ বাতিল করুন।"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)

# --- চ্যানেল লিস্ট ও ডিলিট ---
async def list_channels(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    channels = list(channels_col.find({"user_id": user_id}))
    if not channels:
        await update.message.reply_text("আপনার কোনো চ্যানেল অ্যাড করা নেই।")
        return
    keyboard = [[InlineKeyboardButton(f"❌ {chan['name']}", callback_data=f"del_{chan['_id']}")] for chan in channels]
    await update.message.reply_text("📋 আপনার চ্যানেলসমূহ (ডিলিট করতে ক্লিক করুন):", reply_markup=InlineKeyboardMarkup(keyboard))

async def delete_channel_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    channels_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
    await query.edit_message_text("✅ সফলভাবে ডিলিট করা হয়েছে।")

# --- সেটিংস ---
async def set_click_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔢 কতটি অ্যাড দেখার পর মেইন লিংক আসবে? (যেমন: 5)")
    return SET_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        limit = int(update.message.text)
        settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"click_limit": limit}}, upsert=True)
        await update.message.reply_text(f"✅ সফল! প্রতি পোস্টে {limit}টি ক্লিক সেট হয়েছে।")
    except: await update.message.reply_text("❌ শুধু সংখ্যা দিন।")
    return ConversationHandler.END

async def add_zone_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("🔗 আপনার **Monetag Direct Link** দিন:")
    return SET_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"monetag_link": update.message.text}}, upsert=True)
    await update.message.reply_text("✅ মনিটেগ লিংক সেভ হয়েছে।")
    return ConversationHandler.END

# --- মুভি পোস্ট (প্রিভিউ সিস্টেমসহ) ---
async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['movie_items'] = []
    await update.message.reply_text("🎬 মুভির নাম লিখুন:")
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_name'] = update.message.text
    await update.message.reply_text("🖼️ পোস্টার ইমেজ লিংক দিন:")
    return POSTER

async def get_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_poster'] = update.message.text
    await update.message.reply_text("🌐 মুভির ভাষা কী?:")
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_lang'] = update.message.text
    await update.message.reply_text("💿 মুভির **কোয়ালিটি** লিখুন (যেমন: 720p):")
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['current_q'] = update.message.text
    await update.message.reply_text(f"🔗 **{update.message.text}** এর জন্য মেইন মুভি লিংক দিন:")
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['movie_items'].append({"quality": context.user_data['current_q'], "link": update.message.text})
    keyboard = [[InlineKeyboardButton("➕ আরও কোয়ালিটি যোগ করুন", callback_data="add_more")],
                [InlineKeyboardButton("✅ প্রিভিউ ও কোড তৈরি করুন", callback_data="done_post")]]
    await update.message.reply_text(f"✅ {context.user_data['current_q']} যুক্ত হয়েছে।", reply_markup=InlineKeyboardMarkup(keyboard))
    return CONFIRM_MORE

async def handle_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "add_more":
        await query.message.reply_text("💿 পরবর্তী **কোয়ালিটি** লিখুন:")
        return QUALITY
    else:
        user_id = update.effective_user.id
        data = context.user_data
        setts = get_user_settings(user_id)
        
        # প্রিভিউ টেক্সট তৈরি
        quality_list = "\n".join([f"  • {item['quality']}" for item in data['movie_items']])
        preview_msg = (
            f"🎬 **মুভির প্রিভিউ:**\n\n"
            f"📌 **নাম:** {data['m_name']}\n"
            f"🌐 **ভাষা:** {data['m_lang']}\n"
            f"💿 **কোয়ালিটিসমূহ:**\n{quality_list}\n"
            f"🔢 **অ্যাড লিমিট:** {setts['click_limit']} টি ক্লিক"
        )
        
        # ১. প্রিভিউ পাঠানো
        try:
            await query.message.reply_photo(photo=data['m_poster'], caption=preview_msg, parse_mode=ParseMode.MARKDOWN)
        except:
            await query.message.reply_text(preview_msg, parse_mode=ParseMode.MARKDOWN)

        # ২. HTML কোড জেনারেট
        user_channels = list(channels_col.find({"user_id": user_id}))
        ch_html = "".join([f'<a href="{c["url"]}" style="background:#333;color:#fff;padding:5px 10px;margin:2px;text-decoration:none;border-radius:3px;font-size:12px;display:inline-block;">{c["name"]}</a>' for c in user_channels])
        btns_html = "".join([f'<div style="margin-bottom: 10px;"><button class="dl-btn" onclick="processClick(\'{item["link"]}\')" style="background: #d9534f; color: white; padding: 12px 20px; border: none; border-radius: 5px; font-weight: bold; width: 100%; cursor: pointer;">📥 Download {item["quality"]}</button></div>' for item in data['movie_items']])

        raw_html = f"""
<div style="text-align: center; border: 2px solid #eee; padding: 20px; border-radius: 15px; font-family: sans-serif; max-width: 450px; margin: auto; background: #fff; box-shadow: 0 5px 15px rgba(0,0,0,0.1);">
    <img src="{data['m_poster']}" style="width: 100%; border-radius: 10px; margin-bottom: 15px;" />
    <h2 style="color: #222; margin: 5px 0;">{data['m_name']}</h2>
    <p style="color: #555; margin-bottom: 15px;"><b>Language:</b> {data['m_lang']}</p>
    <div style="background: #f9f9f9; padding: 15px; border-radius: 10px; border: 1px dashed #ccc; margin-bottom: 15px;">
        <p id="counter-text" style="font-weight: bold; color: #d9534f; margin-bottom: 10px;">Steps: 0 / {setts['click_limit']}</p>
        <div style="width: 100%; background: #ddd; height: 8px; border-radius: 5px; margin-bottom: 15px; overflow: hidden;">
            <div id="progress-bar" style="width: 0%; background: #d9534f; height: 100%; transition: 0.3s;"></div>
        </div>
        {btns_html}
    </div>
    <div style="margin-top:10px;">{ch_html}</div>
</div>
<script>
let clicks = 0; const limit = {setts['click_limit']}; const adUrl = "{setts['monetag_link']}";
function processClick(finalUrl) {{
    if (clicks < limit) {{ window.open(adUrl, "_blank"); clicks++;
        const percent = (clicks / limit) * 100;
        document.getElementById('progress-bar').style.width = percent + "%";
        document.getElementById('counter-text').innerText = "Steps: " + clicks + " / " + limit;
        if (clicks >= limit) {{
            document.querySelectorAll('.dl-btn').forEach(b => {{ b.style.background = "#28a745"; b.innerText = b.innerText.replace("Download", "Get Link"); }});
            document.getElementById('counter-text').style.color = "#28a745"; document.getElementById('counter-text').innerText = "Link Unlocked!";
        }}
    }} else {{ window.location.href = finalUrl; }}
}}
</script>
"""
        final_code = html.escape(raw_html)
        await query.message.reply_text("✅ প্রিভিউ উপরে দেখুন। ব্লগারে ব্যবহারের জন্য নিচের কোডটি কপি করুন:")
        await query.message.reply_text(f"<pre><code>{final_code}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

# --- চ্যানেল ও অন্যান্য ---
async def add_channel_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("📢 চ্যানেলের নাম দিন:")
    return CH_NAME

async def save_ch_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['temp_ch_name'] = update.message.text
    await update.message.reply_text("🔗 চ্যানেলের লিংক দিন:")
    return CH_LINK

async def save_ch_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels_col.insert_one({"user_id": update.effective_user.id, "name": context.user_data['temp_ch_name'], "url": update.message.text})
    await update.message.reply_text("✅ চ্যানেল সেভ হয়েছে।")
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("বাতিল করা হয়েছে।")
    return ConversationHandler.END

# --- মেইন রানার ---
if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    app_bot = ApplicationBuilder().token(TOKEN).build()

    app_bot.add_handler(CommandHandler('start', start))
    app_bot.add_handler(CommandHandler('channels', list_channels))
    app_bot.add_handler(CallbackQueryHandler(delete_channel_callback, pattern="^del_"))

    app_bot.add_handler(ConversationHandler(entry_points=[CommandHandler('post', start_post)], states={NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)], POSTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)], LANGUAGE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)], QUALITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)], LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)], CONFIRM_MORE: [CallbackQueryHandler(handle_confirm)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    app_bot.add_handler(ConversationHandler(entry_points=[CommandHandler('setclick', set_click_start)], states={SET_CLICK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_click)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    app_bot.add_handler(ConversationHandler(entry_points=[CommandHandler('addzone', add_zone_start)], states={SET_ZONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_zone)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    app_bot.add_handler(ConversationHandler(entry_points=[CommandHandler('addchannel', add_channel_start)], states={CH_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_name)], CH_LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_link)]}, fallbacks=[CommandHandler('cancel', cancel)]))

    app_bot.run_polling()
