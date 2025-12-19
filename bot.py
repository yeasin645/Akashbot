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

# --- ১. সার্ভার ও ডাটাবেজ সেটআপ ---
app = Flask(__name__)

# ডাটাবেজ কানেকশন
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_bot_final_v100_ultimate']
channels_col = db['channels']
settings_col = db['settings']
premium_col = db['premium_users']
codes_col = db['redeem_codes']
offers_col = db['premium_offers']
previews_col = db['previews']

# ওনার ডিটেইলস
OWNER_ID = int(os.environ.get('OWNER_ID', 0))
OWNER_USERNAME = os.environ.get('OWNER_USERNAME', 'Admin')

# লাইভ প্রিভিউ ওয়েব রুট
@app.route('/preview/<p_id>')
def preview_page(p_id):
    try:
        preview_data = previews_col.find_one({"_id": ObjectId(p_id)})
        if preview_data:
            return render_template_string(preview_data['html'])
        return "<h1>Preview Not Found!</h1>", 404
    except:
        return "<h1>Invalid ID!</h1>", 400

@app.route('/')
def home(): return "বট সচল আছে! (Master Bot Online)", 200

def keep_alive():
    """রেন্ডার স্লিপ মোড ঠেকাতে ৫ মিনিট পরপর নিজেকে পিং করবে"""
    url = os.environ.get('APP_URL') 
    if not url: return
    while True:
        try: requests.get(url)
        except: pass
        time.sleep(300)

def run_flask():
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port)

# লগিং সেটআপ
logging.basicConfig(format='%(asctime)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, YEAR, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(7)
CH_NAME, CH_LINK, S_CLICK, S_ZONE, S_REDEEM = range(7, 12)

# --- ২. হেল্পার ফাংশনসমূহ ---

def get_detailed_time_string(expiry_date):
    """মেয়াদের সময়কে বছর, মাস, দিন, ঘণ্টা ও সেকেন্ডে রূপান্তর করে"""
    delta = expiry_date - datetime.datetime.now()
    if delta.total_seconds() <= 0: return "মেয়াদ শেষ"
    y, d = divmod(delta.days, 365)
    m, d = divmod(d, 30)
    h, rem = divmod(delta.seconds, 3600)
    mi, s = divmod(rem, 60)
    parts = []
    if y > 0: parts.append(f"{y} বছর")
    if m > 0: parts.append(f"{m} মাস")
    if d > 0: parts.append(f"{d} দিন")
    if h > 0: parts.append(f"{h} ঘণ্টা")
    if mi > 0: parts.append(f"{mi} মিনিট")
    parts.append(f"{s} সেকেন্ড")
    return ", ".join(parts)

async def is_authorized(user_id):
    """চেক করবে ইউজার ওনার নাকি প্রিমিয়াম মেম্বার"""
    if user_id == OWNER_ID: return True
    user = premium_col.find_one({"user_id": user_id})
    if user:
        if datetime.datetime.now() < user['expiry_date']: return True
        else: premium_col.delete_one({"user_id": user_id})
    return False

def get_main_menu(user_id):
    """সব কমান্ড বাটন মেনু জেনারেটর"""
    kb = [
        [InlineKeyboardButton("🎬 Create Post", callback_data="btn_post_start"), InlineKeyboardButton("📊 My Status", callback_data="btn_status")],
        [InlineKeyboardButton("💎 Premium Offers", callback_data="btn_offers"), InlineKeyboardButton("🔑 Redeem Code", callback_data="btn_redeem_start")],
        [InlineKeyboardButton("⚙️ Click Limit", callback_data="btn_click_start"), InlineKeyboardButton("🔗 Monetag Zone", callback_data="btn_zone_start")],
        [InlineKeyboardButton("📢 Channels", callback_data="btn_channels_list")]
    ]
    if user_id == OWNER_ID:
        kb.append([InlineKeyboardButton("🛠 Admin Panel", callback_data="btn_admin_panel")])
    return InlineKeyboardMarkup(kb)

# --- ৩. মেইন কমান্ড ও বাটন হ্যান্ডলারস ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await update.message.reply_text(
        f"👋 হ্যালো **{user.first_name}**!\nবটের মেনু নিচে দেওয়া হলো। যেকোনো কাজ বাতিল করতে /cancel লিখুন।",
        reply_markup=get_main_menu(user.id),
        parse_mode=ParseMode.MARKDOWN
    )

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """চলমান সব কাজ বাতিল করবে"""
    user_id = update.effective_user.id
    await update.message.reply_text("❌ চলমান প্রসেস বাতিল করা হয়েছে।", reply_markup=get_main_menu(user_id))
    return ConversationHandler.END

async def menu_callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user = update.effective_user
    user_id = user.id
    await query.answer()

    if query.data == "btn_status":
        premium_user = premium_col.find_one({"user_id": user_id})
        membership = "👑 ওনার" if user_id == OWNER_ID else ("💎 প্রিমিয়াম" if premium_user else "👤 সাধারণ")
        expiry = "♾️ অনন্তকাল" if user_id == OWNER_ID else (get_detailed_time_string(premium_user['expiry_date']) if premium_user else "মেয়াদ নেই")
        msg = f"📊 **আপনার প্রোফাইল ডিটেইলস:**\n━━━━━━━━━━━━━━━━━━━━\n👤 **নাম:** {user.full_name}\n🆔 **আইডি:** `{user_id}`\n🌟 **মেম্বারশিপ:** {membership}\n⏳ **বাকি সময়:** {expiry}\n━━━━━━━━━━━━━━━━━━━━"
        await query.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)

    elif query.data == "btn_offers":
        offers = list(offers_col.find())
        msg = "💎 **আমাদের প্রিমিয়াম অফারসমূহ:**\n\n" + ("অফার নেই।" if not offers else "\n".join([f"📌 **{o['title']}**\n💰 দাম: {o['price']} | ⏳ মেয়াদ: {o['days']} দিন\n" for o in offers]))
        kb = [[InlineKeyboardButton("💬 এডমিনকে মেসেজ দিন", url=f"https://t.me/{OWNER_USERNAME}")]]
        await query.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)

    elif query.data == "btn_channels_list":
        if not await is_authorized(user_id):
            await query.message.reply_text("🚫 এটি প্রিমিয়াম ফিচার।")
            return
        chans = list(channels_col.find({"user_id": user_id}))
        kb = []
        if chans:
            for c in chans: kb.append([InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"delch_{c['_id']}")])
        kb.append([InlineKeyboardButton("➕ Add New Channel", callback_data="btn_addch_start")])
        await query.message.reply_text("📢 আপনার চ্যানেলসমূহ:", reply_markup=InlineKeyboardMarkup(kb))

    elif query.data == "btn_admin_panel":
        if user_id == OWNER_ID:
            msg = "🛠 **এডমিন কমান্ড লিস্ট:**\n\n`/gencode <Days> <Amount>`\n`/addpremium <ID> <Days>`\n`/setoffer Title|Price|Days`\n`/deloffer`"
            await query.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)

    elif query.data.startswith("delch_"):
        channels_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ চ্যানেল ডিলিট হয়েছে।")

    elif query.data.startswith("doff_"):
        offers_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ অফার ডিলিট হয়েছে।")

# --- ৪. ওনার কমান্ডস (Admin) ---

async def add_premium_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        uid, days = int(context.args[0]), int(context.args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": expiry}}, upsert=True)
        time_text = get_detailed_time_string(expiry)
        await update.message.reply_text(f"✅ ইউজার {uid} প্রিমিয়াম হয়েছে। মেয়াদ: {time_text}")
        try:
            await context.bot.send_message(chat_id=uid, text=f"🎉 **অভিনন্দন! এডমিন আপনাকে প্রিমিয়াম মেম্বারশিপ দিয়েছেন।**\n\n⏳ **আপনার মোট সময়:** {time_text}", parse_mode=ParseMode.MARKDOWN)
        except: pass
    except: await update.message.reply_text("❌ /addpremium <ID> <Days>")

async def gen_code_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        days, count = int(context.args[0]), int(context.args[1])
        codes = []
        for _ in range(count):
            c = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
            codes_col.insert_one({"code": c, "days": days})
            codes.append(f"`{c}`")
        await update.message.reply_text(f"✅ কোডসমূহ:\n\n" + "\n".join(codes), parse_mode=ParseMode.MARKDOWN)
    except: await update.message.reply_text("❌ /gencode <Days> <Amount>")

async def set_offer_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        data = " ".join(context.args).split("|")
        offers_col.insert_one({"title": data[0].strip(), "price": data[1].strip(), "days": data[2].strip()})
        await update.message.reply_text("✅ নতুন অফার যুক্ত হয়েছে।")
    except: await update.message.reply_text("❌ /setoffer টাইটেল | দাম | দিন")

# --- ৫. কনভারসেশনাল প্রসেস হ্যান্ডলারস (বাটন ক্লিক ফিক্স) ---

# মুভি পোস্ট কনভ
async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not await is_authorized(user_id):
        m = "🚫 প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন। /offers দেখুন।"
        if update.callback_query: await update.callback_query.message.reply_text(m)
        else: await update.message.reply_text(m)
        return ConversationHandler.END
    context.user_data['items'] = []
    text = "🎬 **মুভি পোস্ট তৈরি:**\n\nমুভির নাম লিখুন:"
    if update.callback_query: await update.callback_query.message.reply_text(text)
    else: await update.message.reply_text(text)
    return NAME

async def get_name(u, c): c.user_data['name'] = u.message.text; await u.message.reply_text("🖼️ পোস্টার ইমেজ লিংক দিন:"); return POSTER
async def get_poster(u, c): c.user_data['poster'] = u.message.text; await u.message.reply_text("📅 মুভির সাল (Year) লিখুন:"); return YEAR
async def get_year(u, c): c.user_data['year'] = u.message.text; await u.message.reply_text("🌐 ভাষা কী?:"); return LANGUAGE
async def get_language(u, c): c.user_data['lang'] = u.message.text; await u.message.reply_text("💿 কোয়ালিটি লিখুন (যেমন: 720p):"); return QUALITY
async def get_quality(u, c): c.user_data['cq'] = u.message.text; await u.message.reply_text(f"🔗 {u.message.text} এর লিংক দিন:"); return LINK
async def get_link(u, c):
    c.user_data['items'].append({"q": c.user_data['cq'], "l": u.message.text})
    kb = [[InlineKeyboardButton("➕ আরও কোয়ালিটি", callback_data="add_q_c")], [InlineKeyboardButton("✅ Done", callback_data="done_q_c")]]
    await u.message.reply_text("যুক্ত হয়েছে। আরও দিবেন?", reply_markup=InlineKeyboardMarkup(kb))
    return CONFIRM_MORE

async def post_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    if query.data == "add_q_c":
        await query.message.reply_text("💿 পরবর্তী কোয়ালিটি লিখুন:")
        return QUALITY
    elif query.data == "done_q_c":
        uid, data = update.effective_user.id, context.user_data
        setts = settings_col.find_one({"user_id": uid}) or {"monetag_link": "#", "click_limit": 1}
        chans = list(channels_col.find({"user_id": uid}))
        ch_html = "".join([f'<a href="{c["url"]}" style="background:#333;color:#fff;padding:5px 10px;margin:2px;text-decoration:none;border-radius:3px;font-size:12px;display:inline-block;">{c["name"]}</a>' for c in chans])
        btns_html = "".join([f'<div style="margin-bottom: 10px;"><button class="dl-btn" onclick="processClick(\'{i["l"]}\')" style="background:#d9534f;color:#fff;padding:12px 20px;border:none;border-radius:5px;font-weight:bold;width:100%;cursor:pointer;">📥 Download {i["q"]}</button></div>' for i in data['items']])

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
        kb = [[InlineKeyboardButton("👁️ Live Preview Link", url=p_url)]]
        await query.message.reply_text("✅ পোস্ট তৈরি হয়েছে! প্রিভিউ দেখুন এবং কোড কপি করুন।", reply_markup=InlineKeyboardMarkup(kb))
        await query.message.reply_text(f"<pre><code>{html.escape(raw_html)}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

# সেটিংস ও রিডিম হ্যান্ডলারস
async def start_click(u, c):
    if not await is_authorized(u.effective_user.id):
        m = "🚫 এটি একটি প্রিমিয়াম ফিচার।"
        if u.callback_query: await u.callback_query.message.reply_text(m)
        else: await u.message.reply_text(m)
        return ConversationHandler.END
    t = "🔢 কতটি ক্লিক বা অ্যাড দেখাবে? (সংখ্যা দিন):"
    if u.callback_query: await u.callback_query.message.reply_text(t)
    else: await u.message.reply_text(t)
    return S_CLICK

async def start_zone(u, c):
    if not await is_authorized(u.effective_user.id):
        m = "🚫 এটি একটি প্রিমিয়াম ফিচার।"
        if u.callback_query: await u.callback_query.message.reply_text(m)
        else: await u.message.reply_text(m)
        return ConversationHandler.END
    t = "🔗 আপনার Monetag Direct Link দিন:"
    if u.callback_query: await u.callback_query.message.reply_text(t)
    else: await u.message.reply_text(t)
    return S_ZONE

async def start_addch(u, c):
    if not await is_authorized(u.effective_user.id):
        m = "🚫 এটি একটি প্রিমিয়াম ফিচার।"
        if u.callback_query: await u.callback_query.message.reply_text(m)
        else: await u.message.reply_text(m)
        return ConversationHandler.END
    t = "📢 চ্যানেলের নাম দিন:"
    if u.callback_query: await u.callback_query.message.reply_text(t)
    else: await u.message.reply_text(t)
    return CH_NAME

async def start_redeem(u, c):
    t = "🔑 আপনার প্রিমিয়াম রিডিম কোডটি দিন:"
    if u.callback_query: await u.callback_query.message.reply_text(t)
    else: await u.message.reply_text(t)
    return S_REDEEM

async def save_redeem(u, c):
    code = u.message.text
    data = codes_col.find_one({"code": code})
    if data:
        uid = u.effective_user.id
        cur = premium_col.find_one({"user_id": uid})
        base = cur['expiry_date'] if cur and cur['expiry_date'] > datetime.datetime.now() else datetime.datetime.now()
        new_exp = base + datetime.timedelta(days=int(data['days']))
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": new_exp}}, upsert=True)
        codes_col.delete_one({"code": code})
        await u.message.reply_text(f"🎉 सफल! নতুন মেয়াদ: {get_detailed_time_string(new_exp)}")
    else: await u.message.reply_text("❌ ভুল বা ব্যবহৃত কোড।")
    return ConversationHandler.END

# --- ৬. মেইন রানার (Handlers Registration) ---

if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CommandHandler('cancel', cancel))
    bot_app.add_handler(CommandHandler('addpremium', add_premium_cmd))
    bot_app.add_handler(CommandHandler('gencode', gen_code_cmd))
    bot_app.add_handler(CommandHandler('setoffer', set_offer_cmd))
    bot_app.add_handler(CommandHandler('deloffer', del_offer_cmd))

    # ১. মুভি পোস্ট কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('post', start_post), CallbackQueryHandler(start_post, pattern="^btn_post_start$")],
        states={
            NAME:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)],
            POSTER:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)],
            YEAR:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_year)],
            LANGUAGE:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)],
            QUALITY:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)],
            LINK:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)],
            CONFIRM_MORE:[CallbackQueryHandler(post_callback, pattern="^(add_q_c|done_q_c)$")]
        }, fallbacks=[CommandHandler('cancel', cancel)]
    ))
    # ২. ক্লিক লিমিট কনভ
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('setclick', start_click), CallbackQueryHandler(start_click, pattern="^btn_click_start$")],
        states={S_CLICK:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (settings_col.update_one({"user_id":u.effective_user.id},{"$set":{"click_limit":int(u.message.text)}},upsert=True), u.message.reply_text("✅ ক্লিক লিমিট সেভ হয়েছে।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]
    ))
    # ৩. জোন সেট কনভ
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addzone', start_zone), CallbackQueryHandler(start_zone, pattern="^btn_zone_start$")],
        states={S_ZONE:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (settings_col.update_one({"user_id":u.effective_user.id},{"$set":{"monetag_link":u.message.text}},upsert=True), u.message.reply_text("✅ মনিটেগ জোন সেভ হয়েছে।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]
    ))
    # ৪. চ্যানেল অ্যাড কনভ
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('addchannel', start_addch), CallbackQueryHandler(start_addch, pattern="^btn_addch_start$")],
        states={CH_NAME:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (c.user_data.update({"cn":u.message.text}), u.message.reply_text("🔗 লিংক:"), CH_LINK)[2])], CH_LINK:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (channels_col.insert_one({"user_id":u.effective_user.id,"name":c.user_data["cn"],"url":u.message.text}), u.message.reply_text("✅ চ্যানেল সেভ।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]
    ))
    # ৫. রিডিম কনভ (সবার জন্য)
    bot_app.add_handler(ConversationHandler(
        entry_points=[CommandHandler('redeem', start_redeem), CallbackQueryHandler(start_redeem, pattern="^btn_redeem_start$")],
        states={S_REDEEM:[MessageHandler(filters.TEXT & ~filters.COMMAND, save_redeem)]}, fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # জেনারেল কলব্যাক (মেনু নেভিগেশন)
    bot_app.add_handler(CallbackQueryHandler(menu_callback_handler))

    bot_app.run_polling()
