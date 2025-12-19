import os
import logging
import threading
import time
import requests
import datetime
import html
import random
import string
from flask import Flask, render_template_string
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
app = Flask(__name__)

# ডাটাবেজ কানেকশন
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_bot_final_v13']
channels_col = db['channels']
settings_col = db['settings']
premium_col = db['premium_users']
codes_col = db['redeem_codes']
offers_col = db['premium_offers']
previews_col = db['previews']

# লাইভ প্রিভিউ ওয়েব রুট
@app.route('/preview/<p_id>')
def preview_page(p_id):
    try:
        preview_data = previews_col.find_one({"_id": ObjectId(p_id)})
        if preview_data:
            return render_template_string(preview_data['html'])
        return "<h1>Preview Not Found!</h1>", 404
    except:
        return "<h1>Invalid Preview ID!</h1>", 400

@app.route('/')
def home(): return "বট সচল আছে! (Master Bot Online)", 200

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

# --- কনফিগারেশন ---
OWNER_ID = int(os.environ.get('OWNER_ID', 0))
OWNER_USERNAME = os.environ.get('OWNER_USERNAME', 'Admin')
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, YEAR, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(7)
CH_NAME, CH_LINK = range(7, 9)
S_CLICK = 10
S_ZONE = 11

# --- হেল্পার ফাংশন ---

def get_time_string(expiry_date):
    delta = expiry_date - datetime.datetime.now()
    if delta.total_seconds() <= 0: return "মেয়াদ শেষ"
    days = delta.days
    years, days = divmod(days, 365)
    months, days = divmod(days, 30)
    hours, remainder = divmod(delta.seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    parts = []
    if years > 0: parts.append(f"{years} বছর")
    if months > 0: parts.append(f"{months} মাস")
    if days > 0: parts.append(f"{days} দিন")
    if hours > 0: parts.append(f"{hours} ঘণ্টা")
    if minutes > 0: parts.append(f"{minutes} মিনিট")
    parts.append(f"{seconds} সেকেন্ড")
    return ", ".join(parts)

async def is_authorized(user_id):
    if user_id == OWNER_ID: return True
    user = premium_col.find_one({"user_id": user_id})
    if user:
        if datetime.datetime.now() < user['expiry_date']: return True
        else: premium_col.delete_one({"user_id": user_id})
    return False

def get_main_menu(user_id):
    kb = [
        [InlineKeyboardButton("🎬 Create Post", callback_data="m_post"), InlineKeyboardButton("📊 My Status", callback_data="m_status")],
        [InlineKeyboardButton("💎 Offers", callback_data="m_offers"), InlineKeyboardButton("🔑 Redeem Code", callback_data="m_redeem")],
        [InlineKeyboardButton("⚙️ Click Limit", callback_data="m_set_click"), InlineKeyboardButton("🔗 Monetag Zone", callback_data="m_set_zone")],
        [InlineKeyboardButton("📢 Channels", callback_data="m_channels")]
    ]
    if user_id == OWNER_ID: kb.append([InlineKeyboardButton("🛠 Admin Panel", callback_data="m_admin")])
    return InlineKeyboardMarkup(kb)

# --- কমান্ড ও বাটন হ্যান্ডলার ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await update.message.reply_text(f"👋 হ্যালো {user.first_name}!\nনিচের বাটন ব্যবহার করুন:", reply_markup=get_main_menu(user.id))

async def menu_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user = update.effective_user
    await query.answer()

    if query.data == "m_post": await query.message.reply_text("🎬 পোস্ট তৈরি করতে /post লিখুন।")
    elif query.data == "m_status":
        premium_user = premium_col.find_one({"user_id": user.id})
        membership = "👑 ওনার" if user.id == OWNER_ID else ("💎 প্রিমিয়াম" if premium_user else "👤 সাধারণ")
        expiry = "♾️ অনন্তকাল" if user.id == OWNER_ID else (get_time_string(premium_user['expiry_date']) if premium_user else "মেয়াদ নেই")
        msg = f"📊 **প্রোফাইল:**\n👤 নাম: {user.full_name}\n🆔 আইডি: `{user.id}`\n🌟 টাইপ: {membership}\n⏳ মেয়াদ: {expiry}"
        await query.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)
    elif query.data == "m_offers":
        offers = list(offers_col.find())
        msg = "💎 **প্রিমিয়াম অফার:**\n\n" + ("নেই।" if not offers else "\n".join([f"📌 {o['title']} | {o['price']} | {o['days']} দিন" for o in offers]))
        kb = [[InlineKeyboardButton("💬 কন্টাক্ট এডমিন", url=f"https://t.me/{OWNER_USERNAME}")]]
        await query.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)
    elif query.data == "m_redeem": await query.message.reply_text("🔑 কোড রিডিম করতে লিখুন: `/redeem YOUR_CODE`")
    elif query.data == "m_set_click": await query.message.reply_text("🔢 ক্লিক সংখ্যা সেট করতে /setclick লিখুন।")
    elif query.data == "m_set_zone": await query.message.reply_text("🔗 মনিটেগ জোন সেট করতে /addzone লিখুন।")
    elif query.data == "m_channels":
        if not await is_authorized(user.id): return
        chans = list(channels_col.find({"user_id": user.id}))
        if not chans:
            kb = [[InlineKeyboardButton("➕ Add New Channel", callback_data="m_add_ch")]]
            await query.message.reply_text("কোনো চ্যানেল নেই।", reply_markup=InlineKeyboardMarkup(kb))
        else:
            kb = [[InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"delch_{c['_id']}")] for c in chans]
            kb.append([InlineKeyboardButton("➕ Add More", callback_data="m_add_ch")])
            await query.message.reply_text("📢 আপনার চ্যানেলসমূহ:", reply_markup=InlineKeyboardMarkup(kb))
    elif query.data == "m_add_ch": await query.message.reply_text("চ্যানেল অ্যাড করতে /addchannel লিখুন।")
    elif query.data == "m_admin":
        if user.id == OWNER_ID: await query.message.reply_text("🛠 **এডমিন কমান্ড:**\n/gencode <Days> <Amount>\n/addpremium <ID> <Days>\n/setoffer Title|Price|Days\n/deloffer")
    elif query.data.startswith("delch_"):
        channels_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ চ্যানেল ডিলিট হয়েছে।")
    elif query.data.startswith("deloff_"):
        offers_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ অফার ডিলিট হয়েছে।")

# --- এডমিন ও রিডিম লজিক ---

async def add_premium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        uid, days = int(context.args[0]), int(context.args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": expiry}}, upsert=True)
        await update.message.reply_text(f"✅ ইউজার {uid} প্রিমিয়াম হয়েছে। মেয়াদ: {get_time_string(expiry)}")
    except: await update.message.reply_text("❌ /addpremium <ID> <Days>")

async def gen_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        days, count = int(context.args[0]), int(context.args[1])
        codes = []
        for _ in range(count):
            c = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
            codes_col.insert_one({"code": c, "days": days})
            codes.append(f"`{c}`")
        await update.message.reply_text("✅ কোডসমূহ:\n" + "\n".join(codes), parse_mode=ParseMode.MARKDOWN)
    except: await update.message.reply_text("❌ /gencode <Days> <Amount>")

async def set_offer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        data = " ".join(context.args).split("|")
        offers_col.insert_one({"title": data[0].strip(), "price": data[1].strip(), "days": data[2].strip()})
        await update.message.reply_text("✅ অফার সেট হয়েছে।")
    except: await update.message.reply_text("❌ /setoffer Title|Price|Days")

async def redeem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        code = context.args[0]
        data = codes_col.find_one({"code": code})
        if data:
            uid = update.effective_user.id
            cur = premium_col.find_one({"user_id": uid})
            base = cur['expiry_date'] if cur and cur['expiry_date'] > datetime.datetime.now() else datetime.datetime.now()
            new_exp = base + datetime.timedelta(days=int(data['days']))
            premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": new_exp}}, upsert=True)
            codes_col.delete_one({"code": code})
            await update.message.reply_text(f"🎉 সফল! মেয়াদ: {get_time_string(new_exp)}")
        else: await update.message.reply_text("❌ ভুল কোড।")
    except: await update.message.reply_text("❌ /redeem YOURCODE")

# --- মুভি পোস্ট কনভারসেশন (Unlimited Quality + Year + Preview) ---

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id):
        await update.message.reply_text("🚫 প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন।")
        return ConversationHandler.END
    context.user_data['items'] = []
    await update.message.reply_text("🎬 মুভির নাম লিখুন:")
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['name'] = update.message.text
    await update.message.reply_text("🖼️ পোস্টার ইমেজ লিংক দিন:")
    return POSTER

async def get_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['poster'] = update.message.text
    await update.message.reply_text("📅 মুভির সাল (Year) লিখুন:")
    return YEAR

async def get_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['year'] = update.message.text
    await update.message.reply_text("🌐 ভাষা কী?:")
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['lang'] = update.message.text
    await update.message.reply_text("💿 কোয়ালিটি লিখুন (যেমন: 720p):")
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['cq'] = update.message.text
    await update.message.reply_text(f"🔗 {update.message.text} এর ডাউনলোড লিংক দিন:")
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['items'].append({"q": context.user_data['cq'], "l": update.message.text})
    kb = [[InlineKeyboardButton("➕ Add More", callback_data="add_q")], [InlineKeyboardButton("✅ Done", callback_data="done_q")]]
    await update.message.reply_text("যুক্ত হয়েছে। আরও কোয়ালিটি দিবেন?", reply_markup=InlineKeyboardMarkup(kb))
    return CONFIRM_MORE

async def post_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "add_q":
        await query.message.reply_text("💿 পরবর্তী কোয়ালিটি লিখুন:")
        return QUALITY
    elif query.data == "done_q":
        uid, data = update.effective_user.id, context.user_data
        setts = settings_col.find_one({"user_id": uid}) or {"monetag_link": "#", "click_limit": 1}
        chans = list(channels_col.find({"user_id": uid}))
        
        ch_html = "".join([f'<a href="{c["url"]}" style="background:#333;color:#fff;padding:5px 10px;margin:2px;text-decoration:none;border-radius:3px;font-size:12px;display:inline-block;">{c["name"]}</a>' for c in chans])
        btns_html = "".join([f'<div style="margin-bottom:10px;"><button class="dl-btn" onclick="processClick(\'{i["l"]}\')" style="background:#d9534f;color:#fff;padding:12px 20px;border:none;border-radius:5px;font-weight:bold;width:100%;cursor:pointer;">📥 Download {i["q"]}</button></div>' for i in data['items']])

        raw_html = f"""
<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="background:#f4f4f4; display:flex; justify-content:center; padding:20px;">
<div style="text-align:center;border:2px solid #eee;padding:20px;border-radius:15px;font-family:sans-serif;max-width:450px;width:100%;background:#fff;box-shadow:0 5px 15px rgba(0,0,0,0.1);">
    <img src="{data['poster']}" style="width:100%;border-radius:10px;margin-bottom:15px;" />
    <h2 style="color:#222;margin:5px 0;">{data['name']} ({data['year']})</h2>
    <p style="color:#555;margin-bottom:15px;"><b>Language:</b> {data['lang']}</p>
    <div style="background:#f9f9f9;padding:15px;border-radius:10px;border:1px dashed #ccc;margin-bottom:15px;">
        <p id="counter-text" style="font-weight:bold;color:#d9534f;margin-bottom:10px;">Steps: 0 / {setts['click_limit']}</p>
        <div style="width:100%;background:#ddd;height:8px;border-radius:5px;margin-bottom:15px;overflow:hidden;">
            <div id="progress-bar" style="width:0%;background:#d9534f;height:100%;transition:0.3s;"></div>
        </div>
        {btns_html}
    </div>
    <div style="margin-top:10px;">{ch_html}</div>
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
</script></body></html>"""
        
        p_id = previews_col.insert_one({"html": raw_html}).inserted_id
        p_url = f"{os.environ.get('APP_URL')}/preview/{p_id}"
        kb = [[InlineKeyboardButton("👁️ Live Preview", url=p_url)]]
        await query.message.reply_text("✅ পোস্ট তৈরি হয়েছে!\nনিচের লিংকে ক্লিক করে প্রিভিউ দেখুন।", reply_markup=InlineKeyboardMarkup(kb))
        await query.message.reply_text(f"<pre><code>{html.escape(raw_html)}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

# --- সেটিংস সেভিং লজিক (Fixing the Save Issues) ---

async def set_click_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("🔢 কতটি ক্লিক বা অ্যাড দেখাবে? (সংখ্যা দিন):")
    return S_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = int(update.message.text)
        settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"click_limit": val}}, upsert=True)
        await update.message.reply_text(f"✅ সফলভাবে {val}টি ক্লিক সেট করা হয়েছে।")
    except: await update.message.reply_text("❌ শুধুমাত্র সংখ্যা দিন।")
    return ConversationHandler.END

async def set_zone_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("🔗 আপনার Monetag Direct Link দিন:")
    return S_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"monetag_link": update.message.text}}, upsert=True)
    await update.message.reply_text("✅ মনিটেগ জোন সফলভাবে সেভ হয়েছে।")
    return ConversationHandler.END

async def add_ch_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id): return ConversationHandler.END
    await update.message.reply_text("📢 চ্যানেলের নাম দিন:")
    return CH_NAME

async def save_ch_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['cn'] = update.message.text
    await update.message.reply_text("🔗 চ্যানেলের লিংক দিন:")
    return CH_LINK

async def save_ch_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels_col.insert_one({"user_id": update.effective_user.id, "name": context.user_data['cn'], "url": update.message.text})
    await update.message.reply_text("✅ চ্যানেল সফলভাবে অ্যাড হয়েছে।")
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("বাতিল হয়েছে।", reply_markup=get_main_menu(update.effective_user.id))
    return ConversationHandler.END

# --- মেইন রানার ---
if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CommandHandler('redeem', redeem))
    bot_app.add_handler(CommandHandler('addpremium', add_premium))
    bot_app.add_handler(CommandHandler('gencode', gen_code))
    bot_app.add_handler(CommandHandler('setoffer', set_offer))
    bot_app.add_handler(CommandHandler('deloffer', lambda u,c: query.message.reply_text("বট মেনু থেকে ডিলিট করুন।")))
    
    # Callback Handlers
    bot_app.add_handler(CallbackQueryHandler(menu_callback, pattern="^(m_|delch_|deloff_|done_q|add_q)"))

    # মুভি পোস্ট কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('post', start_post)],
        states={
            NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
            POSTER: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)],
            YEAR: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_year)],
            LANGUAGE: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)],
            QUALITY: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)],
            LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)],
            CONFIRM_MORE: [CallbackQueryHandler(post_callback, pattern="^(add_q|done_q)$")]
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # ক্লিক সেটিংস কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('setclick', set_click_handler)],
        states={S_CLICK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_click)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # জোন সেটিংস কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addzone', set_zone_handler)],
        states={S_ZONE: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_zone)]},
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # চ্যানেল অ্যাড কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addchannel', add_ch_handler)],
        states={
            CH_NAME: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_name)],
            CH_LINK: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_ch_link)]
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    print("বট চলছে...")
    bot_app.run_polling()
