from flask import Flask, request, redirect, url_for, session, render_template_string
from pymongo import MongoClient
from bson.objectid import ObjectId
import requests

app = Flask(__name__)
app.secret_key = "ultimate_all_in_one_key"

# --- কনফিগারেশন (আপনার ডাটা দিন) ---
TMDB_API_KEY = "YOUR_TMDB_API_KEY_HERE"  # এখানে TMDB API Key বসান
MONGO_URI = "mongodb://localhost:27017/"  # লোকাল মঙ্গোডিবি ইউআরআই

# --- ডাটাবেজ কানেকশন ---
client = MongoClient(MONGO_URI)
db = client['all_in_one_portal']
settings_col = db['settings']
movies_col = db['movies']
tv_shows_col = db['tv_shows']

# ডিফল্ট সেটিংস চেক
if not settings_col.find_one():
    settings_col.insert_one({"logo": "MEDIA-HUB", "notice": "স্বাগতম! মুভি ও টিভি সিরিজ ডাউনলোড করুন।"})

# --- HTML টেমপ্লেট (এক ফাইলের জন্য এখানে রাখা হয়েছে) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ settings.logo }} - Admin Panel & Portal</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
    <style>
        body { background: #0b0e11; color: #e1e1e1; font-family: 'Segoe UI', Tahoma, sans-serif; }
        .navbar { background: #15191d; border-bottom: 3px solid #e50914; }
        .notice-bar { background: #e50914; color: white; text-align: center; padding: 5px; font-size: 14px; font-weight: bold; }
        .movie-card { background: #1c2126; border-radius: 12px; border: 1px solid #2d333b; transition: 0.3s; height: 100%; position: relative; }
        .movie-card:hover { border-color: #e50914; transform: translateY(-5px); }
        .poster-img { border-radius: 8px; width: 100%; height: auto; }
        .btn-link-custom { background: #2d333b; color: #58a6ff; border: 1px solid #444; margin-top: 5px; font-size: 12px; display: block; text-decoration: none; padding: 5px; border-radius: 5px; }
        .btn-link-custom:hover { background: #e50914; color: white; }
        .admin-edit-panel { background: #15191d; border: 1px dashed #e50914; padding: 15px; border-radius: 10px; margin-top: 15px; }
        .section-title { border-left: 5px solid #e50914; padding-left: 15px; margin: 40px 0 20px 0; font-weight: bold; }
        .badge-rating { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.7); color: #ffc107; padding: 2px 8px; border-radius: 5px; font-size: 12px; }
    </style>
</head>
<body>

<div class="notice-bar">{{ settings.notice }}</div>

<nav class="navbar navbar-dark px-4 py-2">
    <h3 class="text-danger fw-bold mb-0">{{ settings.logo }}</h3>
    <div>
        {% if not admin %}
            <form action="/admin_action" method="POST" class="d-flex gap-2">
                <input type="password" name="pass" class="form-control form-control-sm bg-dark text-white border-secondary" placeholder="Admin Password">
                <button name="action" value="login" class="btn btn-sm btn-danger">Login</button>
            </form>
        {% else %}
            <span class="text-success me-2">● Admin Active</span>
            <form action="/admin_action" method="POST" class="d-inline">
                <button name="action" value="logout" class="btn btn-sm btn-outline-light">Logout</button>
            </form>
        {% endif %}
    </div>
</nav>

<div class="container mt-4">
    <!-- এডমিন সেটিংস ইডিট -->
    {% if admin %}
    <div class="admin-edit-panel mb-5">
        <h5>🛠 সাইট সেটিংস আপডেট</h5>
        <form action="/admin_action" method="POST" class="row g-2">
            <div class="col-md-4"><input type="text" name="logo" class="form-control form-control-sm" value="{{ settings.logo }}"></div>
            <div class="col-md-6"><input type="text" name="notice" class="form-control form-control-sm" value="{{ settings.notice }}"></div>
            <div class="col-md-2"><button name="action" value="update_settings" class="btn btn-sm btn-primary w-100">Update</button></div>
        </form>
    </div>
    {% endif %}

    <!-- সার্চ বক্স -->
    <div class="text-center mb-5">
        <h2 class="mb-3">মুভি ও টিভি শো খুঁজুন</h2>
        <form action="/search" method="POST" class="d-flex justify-content-center">
            <input type="text" name="query" class="form-control w-50 bg-dark text-white border-secondary" placeholder="মুভির নাম লিখুন..." required>
            <button class="btn btn-danger ms-2 px-4">Search</button>
        </form>
    </div>

    <!-- সার্চ রেজাল্ট -->
    {% if movie_search or tv_search %}
    <h4 class="text-warning">সার্চ রেজাল্ট (ডাটাবেজে যোগ করুন):</h4>
    <div class="row row-cols-2 row-cols-md-6 g-3 mb-5">
        {% for s in movie_search[:6] %}
        <div class="col text-center">
            <div class="movie-card p-2">
                <img src="https://image.tmdb.org/t/p/w200{{ s.poster_path }}" class="poster-img">
                <p class="small text-truncate mt-1">{{ s.title }}</p>
                <a href="/save/movie/{{ s.id }}" class="btn btn-xs btn-outline-success w-100 py-0" style="font-size: 11px;">+ Movie</a>
            </div>
        </div>
        {% endfor %}
        {% for s in tv_search[:6] %}
        <div class="col text-center">
            <div class="movie-card p-2">
                <img src="https://image.tmdb.org/t/p/w200{{ s.poster_path }}" class="poster-img">
                <p class="small text-truncate mt-1">{{ s.name }}</p>
                <a href="/save/tv/{{ s.id }}" class="btn btn-xs btn-outline-primary w-100 py-0" style="font-size: 11px;">+ TV Show</a>
            </div>
        </div>
        {% endfor %}
    </div>
    <hr>
    {% endif %}

    <!-- মেইন ডিসপ্লে (মুভি ও টিভি শো) -->
    {% for type_data in [('পপুলার মুভি', movies, 'movie'), ('টিভি সিরিজ', tv_shows, 'tv')] %}
    <h3 class="section-title">{{ type_data[0] }}</h3>
    <div class="row row-cols-2 row-cols-md-4 row-cols-lg-6 g-4">
        {% for item in type_data[1] %}
        <div class="col">
            <div class="movie-card p-2">
                <span class="badge-rating">★ {{ item.rating }}</span>
                <img src="https://image.tmdb.org/t/p/w500{{ item.poster }}" class="poster-img">
                <div class="mt-2 text-center">
                    <h6 class="small text-truncate mb-2">{{ item.title }}</h6>
                    
                    <!-- আনলিমিটেড ম্যানুয়াল লিঙ্ক -->
                    <div class="mt-2">
                        {% for link in item.links %}
                        <div class="position-relative">
                            <a href="{{ link.url }}" target="_blank" class="btn-link-custom">
                                <strong>{{ link.quality }}</strong>: {{ link.btn_name }}
                            </a>
                            {% if admin %}
                            <a href="/delete_link/{{ type_data[2] }}/{{ item._id }}/{{ loop.index0 }}" class="text-danger position-absolute top-0 end-0 px-1" style="font-size: 10px; text-decoration: none;">✖</a>
                            {% endif %}
                        </div>
                        {% endfor %}
                    </div>

                    {% if admin %}
                    <div class="admin-edit-panel small mt-2 p-1">
                        <form action="/add_link/{{ type_data[2] }}/{{ item._id }}" method="POST">
                            <input type="text" name="quality" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Quality (e.g. 1080p)" required>
                            <input type="text" name="btn_name" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Server/Btn Name" required>
                            <input type="text" name="url" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Download Link" required>
                            <button class="btn btn-sm btn-success w-100 py-0" style="font-size: 10px;">Add Link</button>
                        </form>
                        <form action="/admin_action" method="POST" class="mt-1">
                            <input type="hidden" name="type" value="{{ type_data[2] }}">
                            <input type="hidden" name="id" value="{{ item._id }}">
                            <button name="action" value="delete_item" class="btn btn-link text-danger p-0" style="font-size: 9px; text-decoration:none;">Remove Item</button>
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
    <p>&copy; 2024 {{ settings.logo }} - Python & MongoDB Movie Script</p>
</footer>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""

# --- রাউটস (Routes) ---

@app.route('/')
def home():
    settings = settings_col.find_one()
    movies = list(movies_col.find().sort('_id', -1))
    tv_shows = list(tv_shows_col.find().sort('_id', -1))
    return render_template_string(HTML_TEMPLATE, settings=settings, movies=movies, tv_shows=tv_shows, admin=session.get('admin'))

@app.route('/search', methods=['POST'])
def search():
    query = request.form.get('query')
    m_url = f"https://api.themoviedb.org/3/search/movie?api_key={TMDB_API_KEY}&query={query}"
    t_url = f"https://api.themoviedb.org/3/search/tv?api_key={TMDB_API_KEY}&query={query}"
    
    m_results = requests.get(m_url).json().get('results', [])
    t_results = requests.get(t_url).json().get('results', [])
    
    settings = settings_col.find_one()
    movies = list(movies_col.find().sort('_id', -1))
    tv_shows = list(tv_shows_col.find().sort('_id', -1))
    
    return render_template_string(HTML_TEMPLATE, settings=settings, movies=movies, tv_shows=tv_shows, 
                                  movie_search=m_results, tv_search=t_results, admin=session.get('admin'))

@app.route('/save/<type>/<tmdb_id>')
def save_item(type, tmdb_id):
    col = movies_col if type == 'movie' else tv_shows_col
    url = f"https://api.themoviedb.org/3/{type}/{tmdb_id}?api_key={TMDB_API_KEY}"
    data = requests.get(url).json()
    name = data.get('title') if type == 'movie' else data.get('name')
    
    if not col.find_one({"tmdb_id": data['id']}):
        col.insert_one({
            "tmdb_id": data['id'], "title": name, "poster": data.get('poster_path'),
            "desc": data.get('overview'), "rating": data.get('vote_average'), "links": []
        })
    return redirect(url_for('home'))

@app.route('/add_link/<type>/<id>', methods=['POST'])
def add_link(type, id):
    if session.get('admin'):
        col = movies_col if type == 'movie' else tv_shows_col
        new_link = {
            "quality": request.form.get('quality'),
            "btn_name": request.form.get('btn_name'),
            "url": request.form.get('url')
        }
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
    if action == "login":
        if request.form.get('pass') == "admin123": # আপনার পাসওয়ার্ড
            session['admin'] = True
    elif action == "logout":
        session.pop('admin', None)
    elif action == "update_settings":
        if session.get('admin'):
            settings_col.update_one({}, {"$set": {
                "logo": request.form.get('logo'),
                "notice": request.form.get('notice')
            }})
    elif action == "delete_item":
        if session.get('admin'):
            col = movies_col if request.form.get('type') == 'movie' else tv_shows_col
            col.delete_one({"_id": ObjectId(request.form.get('id'))})
    return redirect(url_for('home'))

if __name__ == '__main__':
    app.run(debug=True, port=5000)
