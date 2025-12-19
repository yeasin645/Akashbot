import os
import logging
import threading
import time
import requests
import datetime
import html
import random
import string
import asyncio
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
db = client['movie_bot_final_v15_fixed']
channels_col = db['channels']
settings_col = db['settings']
premium_col = db['premium_users']
codes_col = db['redeem_codes']
offers_col = db['premium_offers']
previews_col = db['previews']
users_col = db['all_users']

# লাইভ প্রিভিউ ওয়েব রুট
@app.route('/preview/<p_id>')
def preview_page(p_id):
    try:
        preview_data = previews_col.find_one({"_id": ObjectId(p_id)})
        if preview_data: return render_template_string(preview_data['html'])
        return "<h1>Preview Not Found!</h1>", 404
    except: return "<h1>Invalid Preview ID!</h1>", 400

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

# --- কনফিগ ---
OWNER_ID = int(os.environ.get('OWNER_ID', 0))
OWNER_USERNAME = os.environ.get('OWNER_USERNAME', 'Admin')
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, YEAR, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(7)
CH_NAME, CH_LINK, S_CLICK, S_ZONE, S_REDEEM, S_UNPREMIUM, S_ADD_PREM_VAL, S_GEN_CODE_VAL, S_SET_OFFER_VAL, S_BROADCAST_MSG = range(7, 17)

# --- হেল্পার ফাংশন ---

def get_detailed_time_string(expiry_date):
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

# নতুন আপডেট: প্রিমিয়াম ও সাধারণ ইউজারের জন্য আলাদা আইকন মেনু
async def get_main_menu_keyboard(user_id):
    auth = await is_authorized(user_id)
    p_icon = "✅" if auth else "🔒" # প্রিমিয়াম হলে সবুজ টিক, না হলে তালা

    kb = [
        [InlineKeyboardButton(f"{p_icon} Create Movie Post", callback_data="start_post_btn"), InlineKeyboardButton("📊 My Status", callback_data="btn_status")],
        [InlineKeyboardButton("💎 Premium Offers", callback_data="btn_offers"), InlineKeyboardButton("🔑 Redeem Code", callback_data="start_redeem_btn")],
        [InlineKeyboardButton(f"{p_icon} Click Limit", callback_data="start_click_btn"), InlineKeyboardButton(f"{p_icon} Monetag Zone", callback_data="start_zone_btn")],
        [InlineKeyboardButton(f"{p_icon} Channels", callback_data="btn_channels_list")]
    ]
    if user_id == OWNER_ID: kb.append([InlineKeyboardButton("🛠 Admin Panel", callback_data="btn_admin_panel")])
    return InlineKeyboardMarkup(kb)

# --- কমান্ড ও বাটন হ্যান্ডলারস ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    users_col.update_one({"user_id": user.id}, {"$set": {"user_id": user.id, "name": user.full_name}}, upsert=True)
    await update.message.reply_text(f"👋 হ্যালো {user.first_name}!\nআপনার বটের মেনু নিচে দেওয়া হলো:", reply_markup=await get_main_menu_keyboard(user.id))

async def menu_callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = update.effective_user.id
    data = query.data
    
    # নতুন আপডেট: প্রিমিয়াম ফিচারে ক্লিক করলে চেক এবং নোটিফিকেশন সিস্টেম
    premium_actions = ["start_post_btn", "start_click_btn", "start_zone_btn", "btn_channels_list", "start_addch_btn"]
    
    if data in premium_actions:
        if not await is_authorized(user_id):
            await query.answer("🚫 এটি শুধুমাত্র প্রিমিয়াম মেম্বারদের জন্য! অফার দেখতে 'Premium Offers' বাটনে ক্লিক করুন।", show_alert=True)
            return

    await query.answer()

    if data == "btn_status":
        premium_user = premium_col.find_one({"user_id": user_id})
        if user_id == OWNER_ID: membership, expiry = "👑 ওনার (Owner)", "অনন্তকাল (♾️)"
        elif premium_user: membership, expiry = "💎 প্রিমিয়াম", get_detailed_time_string(premium_user['expiry_date'])
        else: membership, expiry = "👤 সাধারণ", "মেয়াদ নেই"
        status_msg = f"📊 **আপনার প্রোফাইল ডিটেইলস:**\n━━━━━━━━━━━━━━━━━━━━\n👤 **নাম:** {update.effective_user.full_name}\n🆔 **আইডি:** `{user_id}`\n🌟 **মেম্বারশিপ:** {membership}\n⏳ **বাকি সময়:** {expiry}\n━━━━━━━━━━━━━━━━━━━━"
        await query.message.reply_text(status_msg, parse_mode=ParseMode.MARKDOWN)

    elif data == "btn_offers":
        offers = list(offers_col.find())
        msg = "💎 **আমাদের প্রিমিয়াম অফারসমূহ:**\n\n"
        if not offers: msg += "বর্তমানে কোনো অফার নেই।"
        else:
            for o in offers: msg += f"📌 **{o['title']}**\n💰 দাম: {o['price']} | ⏳ মেয়াদ: {o['days']} দিন\n\n"
        kb = [[InlineKeyboardButton("💬 এডমিনের সাথে যোগাযোগ", url=f"https://t.me/{OWNER_USERNAME}")]]
        await query.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)

    elif data == "btn_channels_list":
        chans = list(channels_col.find({"user_id": user_id}))
        kb = [[InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"delch_{c['_id']}")] for c in chans]
        kb.append([InlineKeyboardButton("➕ Add New Channel", callback_data="start_addch_btn")])
        await query.message.reply_text("📢 আপনার চ্যানেলসমূহ:", reply_markup=InlineKeyboardMarkup(kb))

    elif data == "btn_admin_panel":
        if user_id == OWNER_ID:
            admin_kb = [
                [InlineKeyboardButton("➕ Add Premium", callback_data="start_add_prem_btn"), InlineKeyboardButton("🔑 Gen Code", callback_data="start_gen_code_btn")],
                [InlineKeyboardButton("🏷 Set Offer", callback_data="start_set_offer_btn"), InlineKeyboardButton("❌ Remove Premium", callback_data="start_unpremium_btn")],
                [InlineKeyboardButton("📢 Broadcast", callback_data="start_broadcast_btn"), InlineKeyboardButton("🗑 Delete Offer", callback_data="btn_del_offer_list")]
            ]
            admin_msg = f"🛠 **এডমিন প্যানেল:**\nমোট ইউজার: {users_col.count_documents({})}\nনিচের বাটনগুলো ব্যবহার করে বট নিয়ন্ত্রণ করুন।"
            await query.message.reply_text(admin_msg, reply_markup=InlineKeyboardMarkup(admin_kb), parse_mode=ParseMode.MARKDOWN)

    elif data == "btn_del_offer_list":
        if user_id != OWNER_ID: return
        offers = list(offers_col.find())
        if not offers: await query.message.reply_text("কোনো অফার নেই।"); return
        kb = [[InlineKeyboardButton(f"🗑 {o['title']}", callback_data=f"doff_{o['_id']}")] for o in offers]
        await query.message.reply_text("ডিলিট করতে অফার সিলেক্ট করুন:", reply_markup=InlineKeyboardMarkup(kb))

    elif data.startswith("delch_"):
        channels_col.delete_one({"_id": ObjectId(data.split("_")[1])})
        await query.edit_message_text("✅ চ্যানেল ডিলিট হয়েছে।")

    elif data.startswith("doff_"):
        offers_col.delete_one({"_id": ObjectId(data.split("_")[1])})
        await query.edit_message_text("✅ প্রিমিয়াম অফারটি ডিলিট হয়েছে।")

# --- ব্রডকাস্ট সিস্টেম ---

async def start_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if update.effective_user.id != OWNER_ID: return ConversationHandler.END
    await update.callback_query.answer()
    await update.callback_query.message.reply_text("📢 **ব্রডকাস্ট মেসেজটি লিখুন:**\n(টেক্সট, ফটো বা ভিডিও দিতে পারেন)")
    return S_BROADCAST_MSG

async def send_broadcast(update: Update, context: ContextTypes.DEFAULT_TYPE):
    all_users = list(users_col.find())
    sent, failed = 0, 0
    msg = await update.message.reply_text(f"🚀 ব্রডকাস্ট শুরু হয়েছে...\nলক্ষ্য: {len(all_users)} ইউজার")

    for user in all_users:
        try:
            await update.message.copy(chat_id=user['user_id'])
            sent += 1
            await asyncio.sleep(0.05)
        except: failed += 1
    
    await msg.edit_text(f"✅ **ব্রডকাস্ট সম্পন্ন!**\n\n📤 সফল: {sent}\n❌ ব্যর্থ: {failed}")
    return ConversationHandler.END

# --- এডমিন বাটন প্রসেস (Add/Remove Premium, Codes, Offers) ---

async def start_add_prem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    await update.callback_query.message.reply_text("👤 ইউজার আইডি এবং দিন সংখ্যা দিন (যেমন: `1234567 30`):")
    return S_ADD_PREM_VAL

async def save_add_prem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = update.message.text.split()
        uid, days = int(args[0]), int(args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": expiry}}, upsert=True)
        await update.message.reply_text(f"✅ ইউজার {uid} এখন প্রিমিয়াম।")
        try: await context.bot.send_message(uid, f"🎉 অভিনন্দন! এডমিন আপনাকে {days} দিনের প্রিমিয়াম দিয়েছেন।")
        except: pass
    except: await update.message.reply_text("❌ ভুল ফরম্যাট।")
    return ConversationHandler.END

async def start_gen_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    await update.callback_query.message.reply_text("🔑 দিন সংখ্যা এবং কোড সংখ্যা দিন (যেমন: `30 5`):")
    return S_GEN_CODE_VAL

async def save_gen_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = update.message.text.split()
        days, count = int(args[0]), int(args[1])
        codes = []
        for _ in range(count):
            c = ''.join(random.choices(string.ascii_uppercase + string.digits, k=10))
            codes_col.insert_one({"code": c, "days": days})
            codes.append(f"`{c}`")
        await update.message.reply_text(f"✅ {days} দিনের {count}টি কোড তৈরি:\n\n" + "\n".join(codes), parse_mode=ParseMode.MARKDOWN)
    except: await update.message.reply_text("❌ ভুল ফরম্যাট।")
    return ConversationHandler.END

async def start_set_offer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    await update.callback_query.message.reply_text("🏷 অফারের বিস্তারিত দিন (টাইটেল | দাম | দিন):")
    return S_SET_OFFER_VAL

async def save_set_offer(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        data = update.message.text.split("|")
        offers_col.insert_one({"title": data[0].strip(), "price": data[1].strip(), "days": data[2].strip()})
        await update.message.reply_text("✅ অফার যুক্ত হয়েছে।")
    except: await update.message.reply_text("❌ ভুল ফরম্যাট।")
    return ConversationHandler.END

async def start_unpremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.answer()
    await update.callback_query.message.reply_text("❌ যার প্রিমিয়াম বাতিল করবেন তার ID দিন:")
    return S_UNPREMIUM

async def save_unpremium(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        uid = int(update.message.text)
        premium_col.delete_one({"user_id": uid})
        await update.message.reply_text(f"✅ ইউজার `{uid}` এখন সাধারণ মেম্বার।")
    except: await update.message.reply_text("❌ সঠিক ID দিন।")
    return ConversationHandler.END

# --- মুভি পোস্ট, ক্লিক, জোন, চ্যানেল, রিডিম প্রসেস ---

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['items'] = []
    await update.callback_query.message.reply_text("🎬 মুভির নাম লিখুন:")
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
    await update.message.reply_text("🌐 মুভির ভাষা কী?:")
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['lang'] = update.message.text
    await update.message.reply_text("💿 কোয়ালিটি লিখুন (যেমন: 720p):")
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['cq'] = update.message.text
    await update.message.reply_text(f"🔗 মেইন ডাউনলোড লিংক দিন:")
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['items'].append({"q": context.user_data['cq'], "l": update.message.text})
    kb = [[InlineKeyboardButton("➕ আরও কোয়ালিটি", callback_data="add_q_c")], [InlineKeyboardButton("✅ Done", callback_data="done_q_c")]]
    await update.message.reply_text("যুক্ত হয়েছে। আরও কোয়ালিটি যোগ করবেন?", reply_markup=InlineKeyboardMarkup(kb))
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
        await query.message.reply_text(f"✅ পোস্ট কোড তৈরি হয়েছে!\n🔗 প্রিভিউ: {p_url}")
        await query.message.reply_text(f"<pre><code>{html.escape(raw_html)}</code></pre>", parse_mode=ParseMode.HTML)
        return ConversationHandler.END

async def start_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.message.reply_text("🔢 কতটি ক্লিক বা অ্যাড দেখাবে? (সংখ্যা দিন):")
    return S_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = int(update.message.text)
        settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"click_limit": val}}, upsert=True)
        await update.message.reply_text(f"✅ সফলভাবে {val}টি ক্লিক সেট হয়েছে।")
    except: await update.message.reply_text("❌ শুধু সংখ্যা দিন।")
    return ConversationHandler.END

async def start_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.message.reply_text("🔗 আপনার Monetag Direct Link দিন:")
    return S_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"monetag_link": update.message.text}}, upsert=True)
    await update.message.reply_text("✅ মনিটেগ জোন সেভ হয়েছে।")
    return ConversationHandler.END

async def start_addch(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.message.reply_text("📢 চ্যানেলের নাম দিন:")
    return CH_NAME

async def save_ch_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['temp_cn'] = update.message.text
    await update.message.reply_text("🔗 চ্যানেলের লিংক দিন:")
    return CH_LINK

async def save_ch_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    channels_col.insert_one({"user_id": update.effective_user.id, "name": context.user_data['temp_cn'], "url": update.message.text})
    await update.message.reply_text("✅ চ্যানেল সেভ হয়েছে।")
    return ConversationHandler.END

async def start_redeem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.message.reply_text("🔑 রিডিম কোড দিন:")
    return S_REDEEM

async def save_redeem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    code = update.message.text
    data = codes_col.find_one({"code": code})
    if data:
        uid = update.effective_user.id
        cur = premium_col.find_one({"user_id": uid})
        base = cur['expiry_date'] if cur and cur['expiry_date'] > datetime.datetime.now() else datetime.datetime.now()
        new_exp = base + datetime.timedelta(days=int(data['days']))
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": new_exp}}, upsert=True)
        codes_col.delete_one({"code": code})
        await update.message.reply_text(f"🎉 প্রিমিয়াম সফল! মেয়াদ: {get_detailed_time_string(new_exp)}")
    else: await update.message.reply_text("❌ ভুল বা ব্যবহৃত কোড।")
    return ConversationHandler.END

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text("বাতিল হয়েছে।")
    return ConversationHandler.END

# --- মেইন রানার ---
if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    threading.Thread(target=keep_alive, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CallbackQueryHandler(menu_callback_handler, pattern="^(btn_|delch_|doff_|start_post_btn|start_click_btn|start_zone_btn|btn_channels_list|start_add_prem_btn|start_gen_code_btn|start_set_offer_btn|start_unpremium_btn|start_broadcast_btn|start_redeem_btn|start_addch_btn)"))

    # ১. এডমিন ও ব্রডকাস্ট কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[
            CallbackQueryHandler(start_add_prem, pattern="^start_add_prem_btn$"),
            CallbackQueryHandler(start_gen_code, pattern="^start_gen_code_btn$"),
            CallbackQueryHandler(start_set_offer, pattern="^start_set_offer_btn$"),
            CallbackQueryHandler(start_unpremium, pattern="^start_unpremium_btn$"),
            CallbackQueryHandler(start_broadcast, pattern="^start_broadcast_btn$")
        ],
        states={
            S_ADD_PREM_VAL: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_add_prem)],
            S_GEN_CODE_VAL: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_gen_code)],
            S_SET_OFFER_VAL: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_set_offer)],
            S_UNPREMIUM: [MessageHandler(filters.TEXT & ~filters.COMMAND, save_unpremium)],
            S_BROADCAST_MSG: [MessageHandler(filters.ALL & ~filters.COMMAND, send_broadcast)]
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # ২. মুভি পোস্ট কনভারসেশন
    bot_app.add_handler(ConversationHandler(
        entry_points=[CallbackQueryHandler(start_post, pattern="^start_post_btn$")],
        states={
            NAME:[MessageHandler(filters.TEXT, get_name)], 
            POSTER:[MessageHandler(filters.TEXT, get_poster)], 
            YEAR:[MessageHandler(filters.TEXT, get_year)], 
            LANGUAGE:[MessageHandler(filters.TEXT, get_language)], 
            QUALITY:[MessageHandler(filters.TEXT, get_quality)], 
            LINK:[MessageHandler(filters.TEXT, get_link)], 
            CONFIRM_MORE:[CallbackQueryHandler(post_callback, pattern="^(add_q_c|done_q_c)$")]
        },
        fallbacks=[CommandHandler('cancel', cancel)]
    ))

    # ৩. সেটিংস ও অন্যান্য কনভারসেশন
    bot_app.add_handler(ConversationHandler(entry_points=[CallbackQueryHandler(start_click, pattern="^start_click_btn$")], states={S_CLICK:[MessageHandler(filters.TEXT, save_click)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CallbackQueryHandler(start_zone, pattern="^start_zone_btn$")], states={S_ZONE:[MessageHandler(filters.TEXT, save_zone)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CallbackQueryHandler(start_addch, pattern="^start_addch_btn$")], states={CH_NAME:[MessageHandler(filters.TEXT, save_ch_name)], CH_LINK:[MessageHandler(filters.TEXT, save_ch_link)]}, fallbacks=[CommandHandler('cancel', cancel)]))
    bot_app.add_handler(ConversationHandler(entry_points=[CallbackQueryHandler(start_redeem, pattern="^start_redeem_btn$")], states={S_REDEEM:[MessageHandler(filters.TEXT, save_redeem)]}, fallbacks=[CommandHandler('cancel', cancel)]))

    print("বট চলছে...")
    bot_app.run_polling()
