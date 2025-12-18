import os
import requests
from flask import Flask, request, redirect, url_for, session, render_template_string
from pymongo import MongoClient
from bson.objectid import ObjectId

app = Flask(__name__)

# --- কনফিগারেশন (আমি এখানে সেট করে দিয়েছি) ---
app.secret_key = "my_secret_movie_key_99" # এটি সেশনের জন্য
TMDB_API_KEY = "89736868843940498305903902" # এখানে আমি একটি উদাহরণ দিয়েছি, তবে আপনার নিজের কী থাকলে সেটি এখানে বসাবেন।

# শুধুমাত্র MONGO_URI টি রেন্ডার থেকে নিবে
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")

# ডাটাবেজ কানেকশন
client = MongoClient(MONGO_URI)
db = client['media_db']
settings_col = db['settings']
movies_col = db['movies']
tv_shows_col = db['tv_shows']

# ডিফল্ট সেটিংস
if not settings_col.find_one():
    settings_col.insert_one({"logo": "FLIX-PORTAL", "notice": "সব মুভি এবং টিভি সিরিজের আনলিমিটেড কালেকশন!"})

# --- HTML ডিজাইন (CSS সহ) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ settings.logo }}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
    <style>
        body { background: #0c1117; color: #e6edf3; font-family: 'Segoe UI', sans-serif; }
        .navbar { background: #161b22; border-bottom: 3px solid #f81f2d; }
        .notice-bar { background: #f81f2d; color: white; text-align: center; padding: 6px; font-weight: bold; }
        .movie-card { background: #161b22; border-radius: 12px; border: 1px solid #30363d; transition: 0.3s; height: 100%; overflow: hidden; }
        .movie-card:hover { border-color: #f81f2d; transform: scale(1.02); }
        .poster-img { width: 100%; border-bottom: 1px solid #30363d; }
        .rating-badge { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); color: #ffc107; padding: 2px 8px; border-radius: 6px; font-size: 13px; font-weight: bold; }
        .link-item { background: #21262d; border: 1px solid #30363d; color: #58a6ff; font-size: 12px; padding: 6px; border-radius: 6px; display: block; margin-top: 5px; text-decoration: none; text-align: center; }
        .link-item:hover { background: #f81f2d; color: white; border-color: #f81f2d; }
        .admin-form { background: #0d1117; padding: 10px; border-radius: 8px; border: 1px dashed #444; margin-top: 10px; font-size: 11px; }
        .section-title { border-left: 5px solid #f81f2d; padding-left: 15px; margin: 40px 0 20px 0; font-weight: bold; }
    </style>
</head>
<body>

<div class="notice-bar">{{ settings.notice }}</div>

<nav class="navbar navbar-dark px-4 py-3">
    <h3 class="text-danger fw-bold mb-0">{{ settings.logo }}</h3>
    <div>
        {% if not admin %}
            <form action="/admin_action" method="POST" class="d-flex gap-2">
                <input type="password" name="pass" class="form-control form-control-sm bg-dark text-white border-secondary" placeholder="Admin Password">
                <button name="action" value="login" class="btn btn-sm btn-danger">Login</button>
            </form>
        {% else %}
            <span class="text-success small me-3">Admin Login Active</span>
            <form action="/admin_action" method="POST" class="d-inline">
                <button name="action" value="logout" class="btn btn-sm btn-outline-light">Logout</button>
            </form>
        {% endif %}
    </div>
</nav>

<div class="container mt-4">
    <!-- Admin Settings Update -->
    {% if admin %}
    <div class="admin-form mb-5">
        <h6>🛠 সাইট সেটিংস</h6>
        <form action="/admin_action" method="POST" class="row g-2">
            <div class="col-md-4"><input type="text" name="logo" class="form-control form-control-sm" value="{{ settings.logo }}"></div>
            <div class="col-md-6"><input type="text" name="notice" class="form-control form-control-sm" value="{{ settings.notice }}"></div>
            <div class="col-md-2"><button name="action" value="update_settings" class="btn btn-sm btn-primary w-100">Update</button></div>
        </form>
    </div>
    {% endif %}

    <!-- Search Section -->
    <div class="text-center mb-5">
        <form action="/search" method="POST" class="d-flex justify-content-center">
            <input type="text" name="query" class="form-control w-50 bg-dark text-white border-secondary" placeholder="মুভি বা টিভি শো সার্চ করুন..." required>
            <button class="btn btn-danger ms-2 px-4">Search</button>
        </form>
    </div>

    <!-- Search Results -->
    {% if movie_search or tv_search %}
    <h4 class="text-warning mb-4">সার্চ রেজাল্ট:</h4>
    <div class="row row-cols-2 row-cols-md-6 g-3 mb-5">
        {% for s in movie_search[:6] %}
        <div class="col">
            <div class="movie-card p-2 text-center">
                <img src="https://image.tmdb.org/t/p/w200{{ s.poster_path }}" class="img-fluid rounded">
                <p class="small text-truncate mt-2">{{ s.title }}</p>
                <a href="/save/movie/{{ s.id }}" class="btn btn-sm btn-success w-100 py-0" style="font-size: 11px;">+ Add Movie</a>
            </div>
        </div>
        {% endfor %}
        {% for s in tv_search[:6] %}
        <div class="col">
            <div class="movie-card p-2 text-center">
                <img src="https://image.tmdb.org/t/p/w200{{ s.poster_path }}" class="img-fluid rounded">
                <p class="small text-truncate mt-2">{{ s.name }}</p>
                <a href="/save/tv/{{ s.id }}" class="btn btn-sm btn-primary w-100 py-0" style="font-size: 11px;">+ Add TV Show</a>
            </div>
        </div>
        {% endfor %}
    </div>
    <hr>
    {% endif %}

    <!-- Displays -->
    {% for section in [('পপুলার মুভি', movies, 'movie'), ('টিভি সিরিজ', tv_shows, 'tv')] %}
    <h3 class="section-title">{{ section[0] }}</h3>
    <div class="row row-cols-2 row-cols-md-4 row-cols-lg-6 g-4">
        {% for item in section[1] %}
        <div class="col">
            <div class="movie-card position-relative">
                <span class="rating-badge">★ {{ item.rating }}</span>
                <img src="https://image.tmdb.org/t/p/w500{{ item.poster }}" class="poster-img">
                <div class="p-2 text-center">
                    <h6 class="small text-truncate mb-2">{{ item.title }}</h6>
                    
                    <!-- Unlimited Links -->
                    <div class="mt-2">
                        {% for link in item.links %}
                        <div class="position-relative">
                            <a href="{{ link.url }}" target="_blank" class="link-item">
                                <b>{{ link.quality }}</b> - {{ link.btn_name }}
                            </a>
                            {% if admin %}
                            <a href="/delete_link/{{ section[2] }}/{{ item._id }}/{{ loop.index0 }}" class="text-danger position-absolute top-0 end-0 px-1" style="font-size: 10px; text-decoration: none;">✖</a>
                            {% endif %}
                        </div>
                        {% endfor %}
                    </div>

                    {% if admin %}
                    <div class="admin-form mt-2 p-1">
                        <form action="/add_link/{{ section[2] }}/{{ item._id }}" method="POST">
                            <input type="text" name="quality" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Quality" required>
                            <input type="text" name="btn_name" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Server/Btn Name" required>
                            <input type="text" name="url" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Link" required>
                            <button class="btn btn-sm btn-success w-100 py-0" style="font-size: 10px;">Add Link</button>
                        </form>
                        <form action="/admin_action" method="POST" class="mt-2">
                            <input type="hidden" name="type" value="{{ section[2] }}">
                            <input type="hidden" name="id" value="{{ item._id }}">
                            <button name="action" value="delete_item" class="btn btn-link text-danger p-0" style="font-size: 9px; text-decoration:none;">Delete Item</button>
                        </form>
                    </div>
                    {% endif %}
                </div>
            </div>
        </div>
        {% endfor %}
    </div>
    {% endfor %}
</div>

<footer class="text-center py-5 mt-5 border-top border-secondary text-muted">
    <p>&copy; 2024 {{ settings.logo }} - Unlimited Movie Script</p>
</footer>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""

# --- Routes (Logic) ---

@app.route('/')
def home():
    settings = settings_col.find_one()
    return render_template_string(HTML_TEMPLATE, 
                                  settings=settings, 
                                  movies=list(movies_col.find().sort('_id', -1)), 
                                  tv_shows=list(tv_shows_col.find().sort('_id', -1)), 
                                  admin=session.get('admin'))

@app.route('/search', methods=['POST'])
def search():
    query = request.form.get('query')
    m_url = f"https://api.themoviedb.org/3/search/movie?api_key={TMDB_API_KEY}&query={query}"
    t_url = f"https://api.themoviedb.org/3/search/tv?api_key={TMDB_API_KEY}&query={query}"
    m_res = requests.get(m_url).json().get('results', [])
    t_res = requests.get(t_url).json().get('results', [])
    return render_template_string(HTML_TEMPLATE, settings=settings_col.find_one(), 
                                  movies=list(movies_col.find().sort('_id', -1)), 
                                  tv_shows=list(tv_shows_col.find().sort('_id', -1)), 
                                  movie_search=m_res, tv_search=t_res, admin=session.get('admin'))

@app.route('/save/<type>/<tmdb_id>')
def save_item(type, tmdb_id):
    col = movies_col if type == 'movie' else tv_shows_col
    url = f"https://api.themoviedb.org/3/{type}/{tmdb_id}?api_key={TMDB_API_KEY}"
    data = requests.get(url).json()
    name = data.get('title') if type == 'movie' else data.get('name')
    if not col.find_one({"tmdb_id": data['id']}):
        col.insert_one({"tmdb_id": data['id'], "title": name, "poster": data.get('poster_path'), "rating": data.get('vote_average'), "links": []})
    return redirect(url_for('home'))

@app.route('/add_link/<type>/<id>', methods=['POST'])
def add_link(type, id):
    if session.get('admin'):
        col = movies_col if type == 'movie' else tv_shows_col
        new_link = {"quality": request.form.get('quality'), "btn_name": request.form.get('btn_name'), "url": request.form.get('url')}
        col.update_one({"_id": ObjectId(id)}, {"$push": {"links": new_link}})
    return redirect(url_for('home'))

@app.route('/delete_link/<type>/<id>/<int:index>')
def delete_link(type, id, index):
    if session.get('admin'):
        col = movies_col if type == 'movie' else tv_shows_col
        item = col.find_one({"_id": ObjectId(id)})
        links = item.get('links', [])
        if 0 <= index < len(links):
            links.pop(index)
            col.update_one({"_id": ObjectId(id)}, {"$set": {"links": links}})
    return redirect(url_for('home'))

@app.route('/admin_action', methods=['POST'])
def admin_action():
    action = request.form.get('action')
    if action == "login" and request.form.get('pass') == "admin123": session['admin'] = True
    elif action == "logout": session.pop('admin', None)
    elif action == "update_settings" and session.get('admin'):
        settings_col.update_one({}, {"$set": {"logo": request.form.get('logo'), "notice": request.form.get('notice')}})
    elif action == "delete_item" and session.get('admin'):
        col = movies_col if request.form.get('type') == 'movie' else tv_shows_col
        col.delete_one({"_id": ObjectId(request.form.get('id'))})
    return redirect(url_for('home'))

if __name__ == '__main__':
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
