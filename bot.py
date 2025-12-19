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

# --- ১. সার্ভার ও ডাটাবেজ সেটিংস ---
app = Flask(__name__)

# ডাটাবেজ কানেকশন
MONGO_URI = os.environ.get('MONGO_URI')
client = MongoClient(MONGO_URI)
db = client['movie_bot_final_v100_command']
channels_col = db['channels']
settings_col = db['settings']
premium_col = db['premium_users']
codes_col = db['redeem_codes']
offers_col = db['premium_offers']
previews_col = db['previews']
users_col = db['all_users'] # ব্রডকাস্টের জন্য সব ইউজার সেভ করার জন্য

# কনফিগ (Environment Variables)
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
def home(): return "বট সচল আছে! (Master Command Bot Online)", 200

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

# লগিং সেটিংস
logging.basicConfig(format='%(asctime)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, YEAR, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(7)
CH_NAME, CH_LINK, S_CLICK, S_ZONE, S_REDEEM = range(7, 12)

# --- ২. হেল্পার ফাংশনসমূহ ---

def get_detailed_time_string(expiry_date):
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
    if user_id == OWNER_ID: return True # ওনার সবসময় অনুমোদিত
    user = premium_col.find_one({"user_id": user_id})
    if user:
        if datetime.datetime.now() < user['expiry_date']: return True
        else: premium_col.delete_one({"user_id": user_id})
    return False

# --- ৩. ওনার কমান্ডস (Admin Commands) ---

async def broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """ওনার সকল ইউজারকে মেসেজ পাঠাতে পারবে"""
    if update.effective_user.id != OWNER_ID: return
    
    if not context.args:
        await update.message.reply_text("❌ ব্যবহার: `/broadcast আপনার মেসেজ`")
        return

    msg_to_send = " ".join(context.args)
    users = list(users_col.find())
    count = 0
    
    await update.message.reply_text(f"📢 ব্রডকাস্ট শুরু হয়েছে ({len(users)} ইউজার)...")
    
    for user in users:
        try:
            await context.bot.send_message(chat_id=user['user_id'], text=f"🔔 **বট নোটিফিকেশন:**\n\n{msg_to_send}", parse_mode=ParseMode.MARKDOWN)
            count += 1
            time.sleep(0.1) # টেলিগ্রামের রেট লিমিট এড়াতে
        except: pass
    
    await update.message.reply_text(f"✅ সফলভাবে {count} জন ইউজারকে মেসেজ পাঠানো হয়েছে।")

async def add_premium_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        uid, days = int(context.args[0]), int(context.args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": expiry}}, upsert=True)
        time_text = get_detailed_time_string(expiry)
        await update.message.reply_text(f"✅ ইউজার {uid} এখন প্রিমিয়াম। মেয়াদ: {time_text}")
        try:
            await context.bot.send_message(chat_id=uid, text=f"🎉 **অভিনন্দন! এডমিন আপনাকে প্রিমিয়াম মেম্বারশিপ দিয়েছেন।**\n⏳ মেয়াদ: {time_text}", parse_mode=ParseMode.MARKDOWN)
        except: pass
    except: await update.message.reply_text("❌ ব্যবহার: `/addpremium <ID> <Days>`")

async def gen_code_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        days, count = int(context.args[0]), int(context.args[1])
        codes = []
        for _ in range(count):
            c = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
            codes_col.insert_one({"code": c, "days": days})
            codes.append(f"`{c}`")
        await update.message.reply_text(f"✅ {days} দিনের {count}টি কোড তৈরি:\n\n" + "\n".join(codes), parse_mode=ParseMode.MARKDOWN)
    except: await update.message.reply_text("❌ ব্যবহার: `/gencode <Days> <Amount>`")

async def set_offer_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    try:
        data = " ".join(context.args).split("|")
        offers_col.insert_one({"title": data[0].strip(), "price": data[1].strip(), "days": data[2].strip()})
        await update.message.reply_text("✅ নতুন অফার যুক্ত হয়েছে।")
    except: await update.message.reply_text("❌ ব্যবহার: `/setoffer টাইটেল | দাম | দিন`")

async def del_offer_cmd(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return
    offers = list(offers_col.find())
    if not offers: await update.message.reply_text("কোনো অফার নেই।"); return
    kb = [[InlineKeyboardButton(f"🗑 {o['title']}", callback_data=f"doff_{o['_id']}")] for o in offers]
    await update.message.reply_text("ডিলিট করতে অফার সিলেক্ট করুন:", reply_markup=InlineKeyboardMarkup(kb))

# --- ৫. সাধারণ কমান্ড হ্যান্ডলারস ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    # ইউজারকে ডাটাবেজে সেভ করা (ব্রডকাস্টের জন্য)
    users_col.update_one({"user_id": user.id}, {"$set": {"name": user.full_name, "last_start": datetime.datetime.now()}}, upsert=True)
    
    text = (
        f"👋 **হ্যালো {user.first_name}! মুভি বটে স্বাগতম।**\n\n"
        "📜 **বটের সকল কমান্ডসমূহ:**\n"
        "🎬 /post - নতুন পোস্ট তৈরি করুন (Premium)\n"
        "📊 /status - আপনার প্রোফাইল ও মেয়াদ দেখুন\n"
        "💎 /offers - প্রিমিয়াম অফারগুলো দেখুন\n"
        "🔑 /redeem - রিডিম কোড ব্যবহার করুন\n"
        "🔢 /setclick - ক্লিক লিমিট সেট করুন (Premium)\n"
        "🔗 /addzone - মনিটেগ জোন সেট করুন (Premium)\n"
        "📢 /addchannel - চ্যানেল অ্যাড করুন (Premium)\n"
        "📋 /channels - চ্যানেল লিস্ট ও ডিলিট (Premium)\n"
        "❌ /cancel - যেকোনো প্রসেস বাতিল করুন\n\n"
        "💡 **পরামর্শ:** ওনার প্রিমিয়াম ছাড়াই সব কমান্ড ব্যবহার করতে পারবেন।"
    )
    await update.message.reply_text(text, parse_mode=ParseMode.MARKDOWN)

async def status(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    u = premium_col.find_one({"user_id": user.id})
    membership = "👑 ওনার" if user.id == OWNER_ID else ("💎 প্রিমিয়াম" if u else "👤 সাধারণ")
    expiry = "♾️ অনন্তকাল" if user.id == OWNER_ID else (get_detailed_time_string(u['expiry_date']) if u else "মেয়াদ নেই")
    msg = f"📊 **আপনার প্রোফাইল ডিটেইলস:**\n━━━━━━━━━━━━━━━━━━━━\n👤 **নাম:** {user.full_name}\n🆔 **আইডি:** `{user.id}`\n🌟 **মেম্বারশিপ:** {membership}\n⏳ **বাকি সময়:** {expiry}\n━━━━━━━━━━━━━━━━━━━━"
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)

async def show_offers(update: Update, context: ContextTypes.DEFAULT_TYPE):
    offers = list(offers_col.find())
    msg = "💎 **আমাদের প্রিমিয়াম অফারসমূহ:**\n\n"
    if not offers: msg += "বর্তমানে কোনো অফার নেই।"
    else:
        for o in offers: msg += f"📌 **{o['title']}**\n💰 দাম: {o['price']} | ⏳ মেয়াদ: {o['days']} দিন\n"
    msg += f"\n💳 প্রিমিয়াম নিতে এডমিনকে মেসেজ দিন: @{OWNER_USERNAME}"
    await update.message.reply_text(msg, parse_mode=ParseMode.MARKDOWN)

# --- ৬. কনভারসেশনাল প্রসেস (Post, Settings, Redeem) ---

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await is_authorized(update.effective_user.id):
        await update.message.reply_text("🚫 প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন। /offers দেখুন।")
        return ConversationHandler.END
    context.user_data['items'] = []
    await update.message.reply_text("🎬 মুভির নাম লিখুন:"); return NAME

async def get_name(u, c): c.user_data['name'] = u.message.text; await u.message.reply_text("🖼️ পোস্টার লিংক দিন:"); return POSTER
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
        await query.message.reply_text("💿 পরবর্তী কোয়ালিটি লিখুন:"); return QUALITY
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
        kb = [[InlineKeyboardButton("👁️ Live Preview Link", url=f"{os.environ.get('APP_URL')}/preview/{p_id}")]]
        await query.message.reply_text("✅ পোস্ট তৈরি হয়েছে!\nনিচের লিংকে প্রিভিউ দেখুন এবং কোড কপি করুন।", reply_markup=InlineKeyboardMarkup(kb))
        await query.message.reply_text(f"<pre><code>{html.escape(raw_html)}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

# সেটিংস ও রিডিম হ্যান্ডলারস
async def s_click_start(u, c):
    if not await is_authorized(u.effective_user.id): return ConversationHandler.END
    await u.message.reply_text("🔢 ক্লিকের সংখ্যা দিন:"); return S_CLICK

async def s_zone_start(u, c):
    if not await is_authorized(u.effective_user.id): return ConversationHandler.END
    await u.message.reply_text("🔗 Monetag Direct Link দিন:"); return S_ZONE

async def s_addch_start(u, c):
    if not await is_authorized(u.effective_user.id): return ConversationHandler.END
    await u.message.reply_text("📢 চ্যানেলের নাম দিন:"); return CH_NAME

async def s_redeem_start(u, c):
    await u.message.reply_text("🔑 আপনার রিডিম কোডটি দিন:"); return S_REDEEM

async def save_redeem(update, context):
    code = update.message.text
    data = codes_col.find_one({"code": code})
    if data:
        uid, days = update.effective_user.id, int(data['days'])
        cur = premium_col.find_one({"user_id": uid})
        base = cur['expiry_date'] if cur and cur['expiry_date'] > datetime.datetime.now() else datetime.datetime.now()
        new_exp = base + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": new_exp}}, upsert=True)
        codes_col.delete_one({"code": code})
        await update.message.reply_text(f"🎉 সফল! নতুন মেয়াদ: {get_detailed_time_string(new_exp)}")
    else: await update.message.reply_text("❌ ভুল বা ব্যবহৃত কোড।")
    return ConversationHandler.END

async def cancel(update, context):
    await update.message.reply_text("❌ কাজ বাতিল করা হয়েছে। নতুন কমান্ড দিন।")
    return ConversationHandler.END

async def list_channels(update, context):
    if not await is_authorized(update.effective_user.id): return
    chans = list(channels_col.find({"user_id": update.effective_user.id}))
    if not chans: await update.message.reply_text("কোনো চ্যানেল নেই।"); return
    kb = [[InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"delch_{c['_id']}")] for c in chans]
    await update.message.reply_text("📋 আপনার চ্যানেল লিস্ট (ডিলিট করতে ক্লিক করুন):", reply_markup=InlineKeyboardMarkup(kb))

async def callback_handler(update, context):
    query = update.callback_query
    await query.answer()
    if query.data.startswith("delch_"):
        channels_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ ডিলিট হয়েছে।")
    elif query.data.startswith("doff_"):
        offers_col.delete_one({"_id": ObjectId(query.data.split("_")[1])})
        await query.edit_message_text("✅ অফার ডিলিট হয়েছে।")

# --- ৭. মেইন রানার (Handlers Setup) ---

if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    # সাধারণ কমান্ডস
    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CommandHandler('status', status))
    bot_app.add_handler(CommandHandler('offers', show_offers))
    bot_app.add_handler(CommandHandler('cancel', cancel))
    
    # ওনার কমান্ডস
    bot_app.add_handler(CommandHandler('broadcast', broadcast))
    bot_app.add_handler(CommandHandler('addpremium', add_premium_cmd))
    bot_app.add_handler(CommandHandler('gencode', gen_code_cmd))
    bot_app.add_handler(CommandHandler('setoffer', set_offer_cmd))
    bot_app.add_handler(CommandHandler('deloffer', del_offer_cmd))
    bot_app.add_handler(CommandHandler('channels', list_channels))
    bot_app.add_handler(CallbackQueryHandler(callback_handler, pattern="^(delch_|doff_)"))

    # কনভারসেশনস (Conversations)
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('post', start_post)], states={NAME:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_name)], POSTER:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_poster)], YEAR:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_year)], LANGUAGE:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_language)], QUALITY:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_quality)], LINK:[MessageHandler(filters.TEXT & ~filters.COMMAND, get_link)], CONFIRM_MORE:[CallbackQueryHandler(post_callback, pattern="^(add_q_c|done_q_c)$")]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('setclick', s_click_start)], states={S_CLICK:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (settings_col.update_one({"user_id":u.effective_user.id},{"$set":{"click_limit":int(u.message.text)}},upsert=True), u.message.reply_text("✅ সেভ।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('addzone', s_zone_start)], states={S_ZONE:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (settings_col.update_one({"user_id":u.effective_user.id},{"$set":{"monetag_link":u.message.text}},upsert=True), u.message.reply_text("✅ সেভ।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('addchannel', s_addch_start)], states={CH_NAME:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (c.user_data.update({"cn":u.message.text}), u.message.reply_text("🔗 লিংক:"), CH_LINK)[2])], CH_LINK:[MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u,c: (channels_col.insert_one({"user_id":u.effective_user.id,"name":c.user_data["cn"],"url":u.message.text}), u.message.reply_text("✅ সেভ।"), ConversationHandler.END)[2])]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CommandHandler('redeem', s_redeem_start)], states={S_REDEEM:[MessageHandler(filters.TEXT & ~filters.COMMAND, save_redeem)]}, fallbacks=[CommandHandler('cancel', cancel)]))

    print("বট চলছে...")
    bot_app.run_polling()
