import os
import logging
import threading
import time
import requests
import datetime
import html
import random
import string
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

# --- রেন্ডার ও ফ্লস্ক সেটিংস ---
app = Flask('')
@app.route('/')
def home(): return "বট সচল আছে! (Premium Movie Bot - Ultimate Edition)"

def keep_alive():
    url = os.environ.get('APP_URL') 
    if not url: return
    while True:
        try: requests.get(url)
        except: pass
        time.sleep(300)

def run_flask():
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

# --- ডাটাবেজ কানেকশন ---
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_bot_final_v4']
channels_col = db['channels']
settings_col = db['settings']
premium_col = db['premium_users']
codes_col = db['redeem_codes']
offers_col = db['premium_offers']

# ওনার ডিটেইলস
OWNER_ID = int(os.environ.get('OWNER_ID', 0))
OWNER_USERNAME = os.environ.get('OWNER_USERNAME', 'Admin')

logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# স্টেটসমূহ
NAME, POSTER, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(6)
CH_NAME, CH_LINK, SET_ZONE, SET_CLICK = range(6, 10)

# --- সময় ক্যালকুলেশন হেল্পার ---
def get_remaining_time(expiry_date):
    now = datetime.datetime.now()
    delta = expiry_date - now
    
    if delta.total_seconds() <= 0:
        return "মেয়াদ শেষ"
    
    years = delta.days // 365
    months = (delta.days % 365) // 30
    days = (delta.days % 365) % 30
    hours, remainder = divmod(delta.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    
    parts = []
    if years > 0: parts.append(f"{years} বছর")
    if months > 0: parts.append(f"{months} মাস")
    if days > 0: parts.append(f"{days} দিন")
    if hours > 0: parts.append(f"{hours} ঘণ্টা")
    if minutes > 0: parts.append(f"{minutes} মিনিট")
    if seconds > 0: parts.append(f"{seconds} সেকেন্ড")
    
    return ", ".join(parts)

# --- পারমিশন চেক ---
async def is_authorized(user_id):
    if user_id == OWNER_ID: return True
    user = premium_col.find_one({"user_id": user_id})
    if user:
        if datetime.datetime.now() < user['expiry_date']: return True
        else: premium_col.delete_one({"user_id": user_id})
    return False

# --- ওনার কমান্ডসমূহ ---

async def add_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        user_id, days = int(context.args[0]), int(context.args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": user_id}, {"$set": {"expiry_date": expiry}}, upsert=True)
        
        time_text = get_remaining_time(expiry)
        await update.message.reply_text(f"✅ ইউজার `{user_id}` কে প্রিমিয়াম করা হয়েছে।\n⏳ মেয়াদ: {time_text}")
        
        # ইউজারকে নোটিফিকেশন পাঠানো (যদি সম্ভব হয়)
        try:
            await context.bot.send_message(chat_id=user_id, text=f"🎉 অভিনন্দন! এডমিন আপনাকে প্রিমিয়াম এক্সেস দিয়েছেন।\n⏳ আপনার মেয়াদের সময়: {time_text}")
        except: pass
    except: await update.message.reply_text("❌ ফরম্যাট: `/addpremium <ID> <Days>`")

async def gen_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        days, amount = int(context.args[0]), int(context.args[1])
        codes = []
        for _ in range(amount):
            c = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
            codes_col.insert_one({"code": c, "days": days})
            codes.append(f"`{c}`")
        await update.message.reply_text(f"✅ {days} দিনের {amount}টি কোড তৈরি:\n\n" + "\n".join(codes), parse_mode=ParseMode.MARKDOWN)
    except: await update.message.reply_text("❌ ফরম্যাট: `/gencode <Days> <Amount>`")

async def set_offer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        data = " ".join(context.args).split("|")
        offers_col.insert_one({"title": data[0].strip(), "price": data[1].strip(), "days": data[2].strip()})
        await update.message.reply_text("✅ প্রিমিয়াম অফার যুক্ত হয়েছে।")
    except: await update.message.reply_text("❌ ফরম্যাট: `/setoffer টাইটেল | দাম | দিন`")

async def del_offer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    offers = list(offers_col.find())
    if not offers: return
    keyboard = [[InlineKeyboardButton(f"🗑 {o['title']}", callback_data=f"doff_{o['_id']}")] for o in offers]
    await update.message.reply_text("অফার ডিলিট করুন:", reply_markup=InlineKeyboardMarkup(keyboard))

# --- ইউজার কমান্ডসমূহ ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (
        "👋 **মুভি পোস্ট জেনারেটর বটে স্বাগতম!**\n\n"
        "🎬 /post - মুভি পোস্ট তৈরি (Premium)\n"
        "💎 /offers - প্রিমিয়াম অফার দেখুন\n"
        "🔑 /redeem - কোড ব্যবহার করুন\n"
        "📊 /status - আপনার সাবস্ক্রিপশন সময় দেখুন\n"
        "❌ /cancel - বাতিল করুন"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)

async def show_offers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    offers = list(offers_col.find())
    msg = "💎 **আমাদের প্রিমিয়াম অফারসমূহ:**\n\n"
    if not offers: msg += "বর্তমানে কোনো অফার নেই।"
    else:
        for o in offers: msg += f"📌 **{o['title']}**\n💰 দাম: {o['price']}\n⏳ মেয়াদ: {o['days']} দিন\n\n"
    
    kb = [[InlineKeyboardButton("💬 এডমিনের সাথে যোগাযোগ", url=f"https://t.me/{OWNER_USERNAME}")]]
    await update.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)

async def redeem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        code = context.args[0]
        data = codes_col.find_one({"code": code})
        if data:
            uid, days = update.effective_user.id, int(data['days'])
            current = premium_col.find_one({"user_id": uid})
            
            start_date = current['expiry_date'] if current and current['expiry_date'] > datetime.datetime.now() else datetime.datetime.now()
            new_expiry = start_date + datetime.timedelta(days=days)
            
            premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": new_expiry}}, upsert=True)
            codes_col.delete_one({"code": code})
            
            time_left = get_remaining_time(new_expiry)
            await update.message.reply_text(f"🎉 **অভিনন্দন! রিডিম সফল হয়েছে।**\n\n📅 আপনার প্রিমিয়াম এক্টিভেট হয়েছে।\n⏳ **মোট মেয়াদের সময়:** {time_left}", parse_mode=ParseMode.MARKDOWN)
        else: await update.message.reply_text("❌ কোডটি ভুল বা ইতিমধ্যে ব্যবহৃত।")
    except: await update.message.reply_text("❌ ফরম্যাট: `/redeem <code>`")

async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    uid = update.effective_user.id
    if uid == OWNER_ID:
        await update.message.reply_text("👑 আপনি বটের ওনার। আপনার কোনো মেয়াদের সীমাবদ্ধতা নেই।")
        return
    u = premium_col.find_one({"user_id": uid})
    if u:
        time_left = get_remaining_time(u['expiry_date'])
        await update.message.reply_text(f"💎 **আপনার প্রিমিয়াম স্ট্যাটাস:**\n\n⏳ বাকি সময়: {time_left}\n📅 শেষ হবে: {u['expiry_date'].strftime('%Y-%m-%d %H:%M:%S')}")
    else: await update.message.reply_text("❌ আপনি প্রিমিয়াম মেম্বার নন।")

# --- মুভি পোস্ট সিস্টেম ---

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id):
        await update.message.reply_text("🚫 প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন। /offers দেখুন।")
        return ConversationHandler.END
    context.user_data['movie_items'] = []
    await update.message.reply_text("🎬 মুভির নাম লিখুন:")
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_name'] = update.message.text
    await update.message.reply_text("🖼️ পোস্টার ইমেজ ডিরেক্ট লিংক দিন:")
    return POSTER

async def get_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_poster'] = update.message.text
    await update.message.reply_text("🌐 মুভির ভাষা কী?:")
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['m_lang'] = update.message.text
    await update.message.reply_text("💿 কোয়ালিটি লিখুন (যেমন: 720p):")
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['current_q'] = update.message.text
    await update.message.reply_text(f"🔗 {update.message.text} এর মেইন লিংক দিন:")
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['movie_items'].append({"quality": context.user_data['current_q'], "link": update.message.text})
    kb = [[InlineKeyboardButton("➕ আরও কোয়ালিটি", callback_data="add_more")], [InlineKeyboardButton("✅ প্রিভিউ ও কোড", callback_data="done_post")]]
    await update.message.reply_text("যুক্ত হয়েছে। আরও কোয়ালিটি দেবেন?", reply_markup=InlineKeyboardMarkup(kb))
    return CONFIRM_MORE

async def handle_confirm(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "add_more":
        await query.message.reply_text("💿 পরবর্তী কোয়ালিটি লিখুন:")
        return QUALITY
    else:
        uid, data = update.effective_user.id, context.user_data
        setts = settings_col.find_one({"user_id": uid}) or {"monetag_link": "#", "click_limit": 1}
        
        # প্রিভিউ
        q_text = "\n".join([f"• {i['quality']}" for i in data['movie_items']])
        preview = f"🎬 **প্রিভিউ:**\n📌 {data['m_name']}\n🌐 {data['m_lang']}\n💿 কোয়ালিটি:\n{q_text}"
        try: await query.message.reply_photo(photo=data['m_poster'], caption=preview)
        except: await query.message.reply_text(preview)

        # HTML
        ch_list = list(channels_col.find({"user_id": uid}))
        ch_html = "".join([f'<a href="{c["url"]}" style="background:#333;color:#fff;padding:5px 10px;margin:2px;text-decoration:none;border-radius:3px;font-size:12px;display:inline-block;">{c["name"]}</a>' for c in ch_list])
        btns_html = "".join([f'<div style="margin-bottom:10px;"><button class="dl-btn" onclick="processClick(\'{i["link"]}\')" style="background:#d9534f;color:#fff;padding:12px 20px;border:none;border-radius:5px;font-weight:bold;width:100%;cursor:pointer;">📥 Download {i["quality"]}</button></div>' for i in data['movie_items']])

        raw_html = f"""
<div style="text-align:center;border:2px solid #eee;padding:20px;border-radius:15px;font-family:sans-serif;max-width:450px;margin:auto;background:#fff;box-shadow:0 5px 15px rgba(0,0,0,0.1);">
    <img src="{data['m_poster']}" style="width:100%;border-radius:10px;margin-bottom:15px;" />
    <h2 style="color:#222;margin:5px 0;">{data['m_name']}</h2>
    <p style="color:#555;margin-bottom:15px;"><b>Language:</b> {data['m_lang']}</p>
    <div style="background:#f9f9f9;padding:15px;border-radius:10px;border:1px dashed #ccc;margin-bottom:15px;">
        <p id="counter-text" style="font-weight:bold;color:#d9534f;margin-bottom:10px;">Steps: 0 / {setts['click_limit']}</p>
        <div style="width:100%;background:#ddd;height:8px;border-radius:5px;margin-bottom:15px;overflow:hidden;">
            <div id="progress-bar" style="width:0%;background:#d9534f;height:100%;transition:0.3s;"></div>
        </div>
        {btns_html}
    </div>
    <div>{ch_html}</div>
</div>
<script>
let clicks = 0; const limit = {setts['click_limit']}; const adUrl = "{setts['monetag_link']}";
function processClick(finalUrl) {{
    if (clicks < limit) {{ window.open(adUrl, "_blank"); clicks++;
        document.getElementById('progress-bar').style.width = (clicks/limit)*100 + "%";
        document.getElementById('counter-text').innerText = "Steps: " + clicks + " / " + limit;
        if (clicks >= limit) {{
            document.querySelectorAll('.dl-btn').forEach(b => {{ b.style.background = "#28a745"; b.innerText = b.innerText.replace("Download", "Get Link"); }});
            document.getElementById('counter-text').style.color = "#28a745"; document.getElementById('counter-text').innerText = "Link Unlocked!";
        }}
    }} else {{ window.location.href = finalUrl; }}
}}
</script>"""
        await query.message.reply_text(f"<pre><code>{html.escape(raw_html)}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

# --- চ্যানেল ও কলব্যাক ---

async def list_channels(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return
    chans = list(channels_col.find({"user_id": update.effective_user.id}))
    if not chans: await update.message.reply_text("নেই।"); return
    kb = [[InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"del_{c['_id']}")] for c in chans]
    await update.message.reply_text("চ্যানেল ডিলিট করুন:", reply_markup=InlineKeyboardMarkup(kb))

async def callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data.startswith("del_"):
        channels_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ ডিলিট হয়েছে।")
    elif query.data.startswith("doff_"):
        offers_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ অফার ডিলিট হয়েছে।")

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("বাতিল হয়েছে।")
    return ConversationHandler.END

# --- সেটিংস কনভারসেশনস (Click, Zone, Channel) ---

async def set_click_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("🔢 কতটি ক্লিক করাবে? (সংখ্যা দিন):")
    return SET_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"click_limit": int(update.message.text)}}, upsert=True)
        await update.message.reply_text("✅ ক্লিক লিমিট সেট হয়েছে।")
    except: await update.message.reply_text("❌ সংখ্যা দিন।")
    return ConversationHandler.END

async def add_zone_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("🔗 Monetag Link দিন:")
    return SET_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"monetag_link": update.message.text}}, upsert=True)
    await update.message.reply_text("✅ মনিটেগ জোন সেট হয়েছে।")
    return ConversationHandler.END

async def add_channel_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📢 চ্যানেলের নাম:")
    return CH_NAME

async def save_ch_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['temp_cn'] = update.message.text
    await update.message.reply_text("🔗 লিংক:")
    return CH_LINK

async def save_ch_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels_col.insert_one({"user_id": update.effective_user.id, "name": context.user_data['temp_cn'], "url": update.message.text})
    await update.message.reply_text("✅ সেভ হয়েছে।")
    return ConversationHandler.END

# --- রানার ---
if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CommandHandler('offers', show_offers))
    bot_app.add_handler(CommandHandler('redeem', redeem))
    bot_app.add_handler(CommandHandler('status', status))
    bot_app.add_handler(CommandHandler('addpremium', add_premium))
    bot_app.add_handler(CommandHandler('gencode', gen_code))
    bot_app.add_handler(CommandHandler('setoffer', set_offer))
    bot_app.add_handler(CommandHandler('deloffer', del_offer))
    bot_app.add_handler(CommandHandler('channels', list_channels))
    bot_app.add_handler(CallbackQueryHandler(callback_handler, pattern="^(del_|doff_)"))

    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('post', start_post)], states={NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)], POSTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)], LANGUAGE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)], QUALITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)], LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)], CONFIRM_MORE: [CallbackQueryHandler(handle_confirm, pattern="^(add_more|done_post)$")]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('setclick', set_click_start)], states={SET_CLICK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_click)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('addzone', add_zone_start)], states={SET_ZONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_zone)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('addchannel', add_channel_start)], states={CH_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_name)], CH_LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_link)]}, fallbacks=[CommandHandler('cancel', cancel)]))

    print("বট চলছে...")
    bot_app.run_polling()
