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
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup, ReplyKeyboardMarkup, ReplyKeyboardRemove
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

# --- কনফিগ ---
OWNER_ID = int(os.environ.get('OWNER_ID', 0))
OWNER_USERNAME = os.environ.get('OWNER_USERNAME', 'Admin')
logging.basicConfig(format='%(asctime)s - %(name)s - %(levelname)s - %(message)s', level=logging.INFO)

# কনভারসেশন স্টেটসমূহ
NAME, POSTER, YEAR, LANGUAGE, QUALITY, LINK, CONFIRM_MORE = range(7)
CH_NAME, CH_LINK, S_CLICK, S_ZONE, S_REDEEM, S_UNPREMIUM, S_ADD_PREM_VAL, S_GEN_CODE_VAL, S_SET_OFFER_VAL = range(7, 16)

# ক্যানসেল বাটন (রিপ্লাই কিবোর্ড)
CANCEL_MARKUP = ReplyKeyboardMarkup([['❌ Cancel Operation']], resize_keyboard=True, one_time_keyboard=True)

# --- হেল্পার ফাংশন ---

async def is_authorized(user_id):
    if user_id == OWNER_ID: return True
    user = premium_col.find_one({"user_id": user_id})
    if user:
        if datetime.datetime.now() < user['expiry_date']: return True
        else: premium_col.delete_one({"user_id": user_id})
    return False

def get_detailed_time_string(expiry_date):
    delta = expiry_date - datetime.datetime.now()
    if delta.total_seconds() <= 0: return "মেয়াদ শেষ"
    days, seconds = delta.days, delta.seconds
    hours, remainder = divmod(seconds, 3600)
    minutes, seconds = divmod(remainder, 60)
    return f"{days} দিন, {hours} ঘণ্টা, {minutes} মিনিট"

async def get_main_menu_keyboard(user_id):
    is_prem = await is_authorized(user_id)
    tick = "✅" if is_prem else "🔒"
    
    kb = [
        [InlineKeyboardButton(f"🎬 Create Post {tick}", callback_data="start_post_btn"), 
         InlineKeyboardButton("📊 My Status", callback_data="btn_status")],
        [InlineKeyboardButton("💎 Premium Offers", callback_data="btn_offers"), 
         InlineKeyboardButton("🔑 Redeem Code", callback_data="start_redeem_btn")],
        [InlineKeyboardButton(f"⚙️ Click Limit {tick}", callback_data="start_click_btn"), 
         InlineKeyboardButton(f"🔗 Monetag Zone {tick}", callback_data="start_zone_btn")],
        [InlineKeyboardButton(f"📢 Channels {tick}", callback_data="btn_channels_list")]
    ]
    if user_id == OWNER_ID: 
        kb.append([InlineKeyboardButton("🛠 Admin Panel", callback_data="btn_admin_panel")])
    return InlineKeyboardMarkup(kb)

async def check_prem_and_notify(update: Update, user_id: int):
    if not await is_authorized(user_id):
        msg = "🚫 **অ্যাক্সেস ডিনাইড!**\n\nএই ফিচারটি ব্যবহার করতে প্রিমিয়াম সাবস্ক্রিপশন প্রয়োজন।\nনিচের বাটন থেকে অফার দেখুন।"
        kb = [[InlineKeyboardButton("💎 View Premium Offers", callback_data="btn_offers")]]
        if update.callback_query:
            await update.callback_query.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)
        else:
            await update.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)
        return False
    return True

# --- কমান্ড ও বাটন হ্যান্ডলারস ---

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user = update.effective_user
    await update.message.reply_text(
        f"👋 হ্যালো {user.first_name}!\nআপনার বটের মেনু নিচে দেওয়া হলো। প্রিমিয়াম ফিচারে { '✅' if await is_authorized(user.id) else '🔒' } চিহ্ন দেখে স্ট্যাটাস বুঝুন।", 
        reply_markup=await get_main_menu_keyboard(user.id)
    )

async def cancel(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "❌ বর্তমান অপারেশন বাতিল করা হয়েছে।", 
        reply_markup=ReplyKeyboardRemove()
    )
    await update.message.reply_text("মেনু ওপেন করা হচ্ছে...", reply_markup=await get_main_menu_keyboard(update.effective_user.id))
    return ConversationHandler.END

async def menu_callback_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    user_id = update.effective_user.id
    await query.answer()

    if query.data == "btn_status":
        premium_user = premium_col.find_one({"user_id": user_id})
        if user_id == OWNER_ID: membership, expiry = "👑 ওনার (Owner)", "♾️ আনলিমিটেড"
        elif premium_user: membership, expiry = "💎 প্রিমিয়াম", get_detailed_time_string(premium_user['expiry_date'])
        else: membership, expiry = "👤 সাধারণ", "মেয়াদ নেই"
        
        status_msg = f"📊 **প্রোফাইল স্ট্যাটাস:**\n━━━━━━━━━━━━━━━━━━━━\n👤 নাম: {update.effective_user.full_name}\n🆔 আইডি: `{user_id}`\n🌟 মেম্বারশিপ: {membership}\n⏳ মেয়াদ: {expiry}\n━━━━━━━━━━━━━━━━━━━━"
        await query.message.reply_text(status_msg, parse_mode=ParseMode.MARKDOWN)

    elif query.data == "btn_offers":
        offers = list(offers_col.find())
        msg = "💎 **প্রিমিয়াম অফারসমূহ:**\n\n"
        if not offers: msg += "বর্তমানে কোনো অফার নেই।"
        else:
            for o in offers: msg += f"📌 **{o['title']}**\n💰 দাম: {o['price']} | ⏳ মেয়াদ: {o['days']} দিন\n\n"
        kb = [[InlineKeyboardButton("💬 এডমিনের সাথে যোগাযোগ", url=f"https://t.me/{OWNER_USERNAME}")]]
        await query.message.reply_text(msg, reply_markup=InlineKeyboardMarkup(kb), parse_mode=ParseMode.MARKDOWN)

    elif query.data == "btn_channels_list":
        if not await check_prem_and_notify(update, user_id): return
        chans = list(channels_col.find({"user_id": user_id}))
        kb = [[InlineKeyboardButton(f"❌ {c['name']}", callback_data=f"delch_{c['_id']}")] for c in chans]
        kb.append([InlineKeyboardButton("➕ Add New Channel", callback_data="start_addch_btn")])
        await query.message.reply_text("📢 আপনার চ্যানেলসমূহ (ডিলিট করতে নামের ওপর ক্লিক করুন):", reply_markup=InlineKeyboardMarkup(kb))

# --- মুভি পোস্ট প্রসেস (With Enhanced Cancel) ---

async def start_post(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = update.effective_user.id
    if not await check_prem_and_notify(update, user_id): return ConversationHandler.END
    
    context.user_data['items'] = []
    text = "🎬 **মুভির নাম লিখুন:**\n(বাতিল করতে নিচের ক্যানসেল বাটনে চাপ দিন)"
    
    if update.callback_query:
        await update.callback_query.message.reply_text(text, reply_markup=CANCEL_MARKUP, parse_mode=ParseMode.MARKDOWN)
    else:
        await update.message.reply_text(text, reply_markup=CANCEL_MARKUP, parse_mode=ParseMode.MARKDOWN)
    return NAME

async def get_name(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['name'] = update.message.text
    await update.message.reply_text("🖼️ মুভির পোস্টার ইমেজ লিংক (URL) দিন:", reply_markup=CANCEL_MARKUP)
    return POSTER

async def get_poster(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['poster'] = update.message.text
    await update.message.reply_text("📅 মুভির বছর (Year) লিখুন:", reply_markup=CANCEL_MARKUP)
    return YEAR

async def get_year(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['year'] = update.message.text
    await update.message.reply_text("🌐 মুভির ভাষা (Language) লিখুন:", reply_markup=CANCEL_MARKUP)
    return LANGUAGE

async def get_language(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['lang'] = update.message.text
    await update.message.reply_text("💿 ভিডিও কোয়ালিটি লিখুন (যেমন: 720p):", reply_markup=CANCEL_MARKUP)
    return QUALITY

async def get_quality(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['cq'] = update.message.text
    await update.message.reply_text(f"🔗 {update.message.text} এর জন্য ডাউনলোড লিংক দিন:", reply_markup=CANCEL_MARKUP)
    return LINK

async def get_link(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data['items'].append({"q": context.user_data['cq'], "l": update.message.text})
    kb = [[InlineKeyboardButton("➕ আরও কোয়ালিটি যুক্ত করুন", callback_data="add_q_c")], 
          [InlineKeyboardButton("✅ পোস্ট তৈরি করুন", callback_data="done_q_c")]]
    await update.message.reply_text("লিংক যুক্ত হয়েছে। আপনি কি আরও কোয়ালিটি যোগ করতে চান?", reply_markup=InlineKeyboardMarkup(kb))
    return CONFIRM_MORE

# --- অন্যান্য সেটিংস হ্যান্ডলার (সংক্ষিপ্ত ও ক্যানসেল যুক্ত) ---

async def start_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_prem_and_notify(update, update.effective_user.id): return ConversationHandler.END
    await update.callback_query.message.reply_text("🔢 কতটি ক্লিক পর লিংক ওপেন হবে? (সংখ্যা দিন):", reply_markup=CANCEL_MARKUP)
    return S_CLICK

async def save_click(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        val = int(update.message.text)
        settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"click_limit": val}}, upsert=True)
        await update.message.reply_text(f"✅ সফল! {val}টি ক্লিক সেট হয়েছে।", reply_markup=ReplyKeyboardRemove())
        await start(update, context)
    except: await update.message.reply_text("❌ ভুল ইনপুট! শুধু সংখ্যা দিন।")
    return ConversationHandler.END

async def start_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await check_prem_and_notify(update, update.effective_user.id): return ConversationHandler.END
    await update.callback_query.message.reply_text("🔗 আপনার Monetag Direct Link দিন:", reply_markup=CANCEL_MARKUP)
    return S_ZONE

async def save_zone(update: Update, context: ContextTypes.DEFAULT_TYPE):
    settings_col.update_one({"user_id": update.effective_user.id}, {"$set": {"monetag_link": update.message.text}}, upsert=True)
    await update.message.reply_text("✅ মনিটেগ লিংক সেভ হয়েছে।", reply_markup=ReplyKeyboardRemove())
    await start(update, context)
    return ConversationHandler.END

# --- এডমিন ফাংশনাল প্রোসেস (Add Premium, Gen Code etc) ---
# (এখানেও ক্যানসেল বাটন যোগ করা হয়েছে)

async def start_add_prem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.callback_query.message.reply_text("👤 ইউজার আইডি এবং দিন দিন (Ex: `123456 30`):", reply_markup=CANCEL_MARKUP)
    return S_ADD_PREM_VAL

async def save_add_prem(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        args = update.message.text.split()
        uid, days = int(args[0]), int(args[1])
        expiry = datetime.datetime.now() + datetime.timedelta(days=days)
        premium_col.update_one({"user_id": uid}, {"$set": {"expiry_date": expiry}}, upsert=True)
        await update.message.reply_text(f"✅ ইউজার {uid} এখন প্রিমিয়াম।", reply_markup=ReplyKeyboardRemove())
    except: await update.message.reply_text("❌ ভুল ফরম্যাট!")
    return ConversationHandler.END

# --- ফ্লস্ক ও রানার ---
@app.route('/')
def home(): return "Master Bot is Live!", 200

@app.route('/preview/<p_id>')
def preview_page(p_id):
    try:
        preview_data = previews_col.find_one({"_id": ObjectId(p_id)})
        return render_template_string(preview_data['html']) if preview_data else ("Not Found", 404)
    except: return "Invalid ID", 400

def run_flask():
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 8080)))

if __name__ == '__main__':
    TOKEN = os.environ.get('BOT_TOKEN')
    threading.Thread(target=run_flask, daemon=True).start()
    bot_app = ApplicationBuilder().token(TOKEN).build()

    # মেইন হ্যান্ডলার
    bot_app.add_handler(CommandHandler('start', start))
    bot_app.add_handler(CallbackQueryHandler(menu_callback_handler, pattern="^(btn_|delch_|doff_)"))

    # ক্যানসেল করার জন্য ফিল্টার
    cancel_filter = filters.Regex("^❌ Cancel Operation$") | filters.CommandHandler("cancel")

    # সব কনভারসেশন হ্যান্ডলার
    conv_handlers = [
        # মুভি পোস্ট
        ConversationHandler(
            entry_points=[CallbackQueryHandler(start_post, pattern="^start_post_btn$")],
            states={
                NAME:[MessageHandler(filters.TEXT & ~cancel_filter, get_name)],
                POSTER:[MessageHandler(filters.TEXT & ~cancel_filter, get_poster)],
                YEAR:[MessageHandler(filters.TEXT & ~cancel_filter, get_year)],
                LANGUAGE:[MessageHandler(filters.TEXT & ~cancel_filter, get_language)],
                QUALITY:[MessageHandler(filters.TEXT & ~cancel_filter, get_quality)],
                LINK:[MessageHandler(filters.TEXT & ~cancel_filter, get_link)],
                CONFIRM_MORE:[CallbackQueryHandler(post_callback if 'post_callback' in globals() else cancel, pattern="^(add_q_c|done_q_c)$")]
            },
            fallbacks=[MessageHandler(cancel_filter, cancel)]
        ),
        # ক্লিক লিমিট
        ConversationHandler(
            entry_points=[CallbackQueryHandler(start_click, pattern="^start_click_btn$")],
            states={S_CLICK:[MessageHandler(filters.TEXT & ~cancel_filter, save_click)]},
            fallbacks=[MessageHandler(cancel_filter, cancel)]
        ),
        # জোন সেটিংস
        ConversationHandler(
            entry_points=[CallbackQueryHandler(start_zone, pattern="^start_zone_btn$")],
            states={S_ZONE:[MessageHandler(filters.TEXT & ~cancel_filter, save_zone)]},
            fallbacks=[MessageHandler(cancel_filter, cancel)]
        ),
        # প্রিমিয়াম অ্যাড (Admin)
        ConversationHandler(
            entry_points=[CallbackQueryHandler(start_add_prem, pattern="^start_add_prem_btn$")],
            states={S_ADD_PREM_VAL:[MessageHandler(filters.TEXT & ~cancel_filter, save_add_prem)]},
            fallbacks=[MessageHandler(cancel_filter, cancel)]
        )
    ]

    for handler in conv_handlers: bot_app.add_handler(handler)

    # জেনারিক রিডিম ও অন্যান্য হ্যান্ডলার যুক্ত করুন (আপনার আগের কোডের লজিক অনুযায়ী)
    # ...

    print("বটটি সফলভাবে চালু হয়েছে...")
    bot_app.run_polling()
