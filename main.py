import os
import requests
from flask import Flask, request, redirect, url_for, session, render_template_string
from pymongo import MongoClient
from bson.objectid import ObjectId

app = Flask(__name__)

# --- সিকিউরিটি কনফিগারেশন ---
app.secret_key = os.environ.get("SECRET_KEY", "super_secret_dev_key_99")
TMDB_API_KEY = os.environ.get("TMDB_API_KEY", "c03534d021c33709b19e24021200155b") # ডিফল্ট কী (কাজ না করলে নিজেরটা দিবেন)

# ডাটাবেজ কানেকশন (রেন্ডার এনভায়রনমেন্ট থেকে নিবে)
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
client = MongoClient(MONGO_URI)
db = client['media_final_db']
settings_col = db['settings']
movies_col = db['movies']
tv_shows_col = db['tv_shows']

# ডিফল্ট সাইট সেটিংস
if not settings_col.find_one():
    settings_col.insert_one({"logo": "MOVIE-PRO", "notice": "আমাদের মুভি পোর্টালে স্বাগতম! ইচ্ছামতো মুভি ডাউনলোড করুন।"})

# --- ফ্রন্টএন্ড ডিজাইন (HTML/CSS) ---
HTML_TEMPLATE = """
<!DOCTYPE html>
<html lang="bn">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{{ settings.logo }} - Admin Panel</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css">
    <style>
        body { background: #080a0c; color: #e1e1e1; font-family: 'Segoe UI', sans-serif; }
        .navbar { background: #12161b; border-bottom: 3px solid #db0000; }
        .notice-bar { background: #db0000; color: white; text-align: center; padding: 7px; font-weight: bold; font-size: 14px; }
        .card-movie { background: #151a1f; border-radius: 10px; border: 1px solid #2d343a; overflow: hidden; height: 100%; transition: 0.3s; }
        .card-movie:hover { border-color: #db0000; transform: translateY(-5px); }
        .poster-img { width: 100%; height: auto; border-bottom: 1px solid #2d343a; }
        .rating-tag { position: absolute; top: 10px; right: 10px; background: rgba(0,0,0,0.8); color: #ffc107; padding: 2px 7px; border-radius: 5px; font-size: 12px; font-weight: bold; }
        .download-btn { background: #232a31; color: #4dabff; border: 1px solid #3a444d; font-size: 12px; padding: 6px; border-radius: 6px; display: block; margin-top: 5px; text-decoration: none; text-align: center; font-weight: 500; }
        .download-btn:hover { background: #db0000; color: white; border-color: #db0000; }
        .admin-box { background: #0f1318; border: 1px dashed #db0000; padding: 20px; border-radius: 12px; margin-top: 20px; }
        .section-head { border-left: 5px solid #db0000; padding-left: 15px; margin: 40px 0 20px 0; font-weight: bold; color: #fff; }
        .btn-add { background: #198754; color: white; border: none; font-size: 11px; padding: 3px 8px; border-radius: 4px; }
    </style>
</head>
<body>

<div class="notice-bar">{{ settings.notice }}</div>

<nav class="navbar navbar-dark px-4 py-3">
    <h3 class="text-danger fw-bold mb-0">{{ settings.logo }}</h3>
    <div>
        {% if not admin %}
            <form action="/admin_action" method="POST" class="d-flex gap-2">
                <input type="password" name="pass" class="form-control form-control-sm bg-dark text-white border-secondary" placeholder="Admin Pass">
                <button name="action" value="login" class="btn btn-sm btn-danger">Login</button>
            </form>
        {% else %}
            <span class="badge bg-success me-2">Admin Active</span>
            <form action="/admin_action" method="POST" class="d-inline">
                <button name="action" value="logout" class="btn btn-sm btn-outline-light">Logout</button>
            </form>
        {% endif %}
    </div>
</nav>

<div class="container mt-4">
    
    {% if admin %}
    <!-- অ্যাডমিন প্যানেল: মুভি সার্চ এবং অ্যাড -->
    <div class="admin-box mb-5">
        <h5 class="text-danger mb-3">🛠 অ্যাডমিন কন্ট্রোল প্যানেল</h5>
        
        <div class="row g-3 mb-4">
            <div class="col-md-6">
                <h6>১. মুভি/টিভি শো অ্যাড করুন (TMDB সার্চ)</h6>
                <form action="/search" method="POST" class="d-flex">
                    <input type="text" name="query" class="form-control form-control-sm bg-dark text-white" placeholder="যেমন: Spider-Man" required>
                    <button class="btn btn-sm btn-danger ms-2">সার্চ</button>
                </form>
            </div>
            <div class="col-md-6 border-start border-secondary">
                <h6>২. সাইট সেটিংস পরিবর্তন</h6>
                <form action="/admin_action" method="POST" class="row g-2">
                    <div class="col-6"><input type="text" name="logo" class="form-control form-control-sm" value="{{ settings.logo }}"></div>
                    <div class="col-6"><input type="text" name="notice" class="form-control form-control-sm" value="{{ settings.notice }}"></div>
                    <div class="col-12"><button name="action" value="update_settings" class="btn btn-xs btn-primary w-100 py-1">আপডেট করুন</button></div>
                </form>
            </div>
        </div>

        {% if search_results %}
        <div class="bg-dark p-3 rounded">
            <h6 class="text-warning">সার্চ রেজাল্ট:</h6>
            <div class="row row-cols-3 row-cols-md-6 g-2">
                {% for s in search_results %}
                <div class="col">
                    <div class="card bg-secondary text-center p-1">
                        <img src="https://image.tmdb.org/t/p/w200{{ s.poster_path }}" class="img-fluid rounded mb-1">
                        <p class="small text-white mb-1 text-truncate" style="font-size: 10px;">{{ s.title or s.name }}</p>
                        {% if s.title %}
                        <a href="/save/movie/{{ s.id }}" class="btn-add text-decoration-none">Add Movie</a>
                        {% else %}
                        <a href="/save/tv/{{ s.id }}" class="btn-add bg-primary text-decoration-none">Add TV</a>
                        {% endif %}
                    </div>
                </div>
                {% endfor %}
            </div>
        </div>
        {% endif %}
    </div>
    {% endif %}

    <!-- মেইন ডিসপ্লে -->
    {% for sec in [('লেটেস্ট মুভি কালেকশন', movies, 'movie'), ('টিভি সিরিজ / নাটক', tv_shows, 'tv')] %}
    <h4 class="section-head">{{ sec[0] }}</h4>
    <div class="row row-cols-2 row-cols-md-4 row-cols-lg-6 g-4">
        {% for item in sec[1] %}
        <div class="col">
            <div class="card-movie position-relative">
                <span class="rating-tag">★ {{ item.rating }}</span>
                <img src="https://image.tmdb.org/t/p/w500{{ item.poster }}" class="poster-img">
                <div class="p-2 text-center">
                    <h6 class="small text-truncate mb-2 fw-bold text-white">{{ item.title }}</h6>
                    
                    <!-- ডাউনলোড লিঙ্কসমূহ -->
                    <div class="links-area">
                        {% for l in item.links %}
                        <div class="position-relative">
                            <a href="{{ l.url }}" target="_blank" class="download-btn">
                                {{ l.quality }} - {{ l.btn_name }}
                            </a>
                            {% if admin %}
                            <a href="/delete_link/{{ sec[2] }}/{{ item._id }}/{{ loop.index0 }}" class="text-danger position-absolute top-0 end-0 px-1" style="font-size: 10px; text-decoration: none;">✖</a>
                            {% endif %}
                        </div>
                        {% endfor %}
                    </div>

                    {% if admin %}
                    <div class="admin-form mt-2 p-1 border-top border-secondary pt-2">
                        <form action="/add_link/{{ sec[2] }}/{{ item._id }}" method="POST">
                            <input type="text" name="q" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="720p/1080p" required>
                            <input type="text" name="btn" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Server Name" required>
                            <input type="text" name="url" class="form-control form-control-sm mb-1 bg-dark text-white border-secondary" placeholder="Link" required>
                            <button class="btn btn-sm btn-success w-100 py-0" style="font-size: 10px;">+ Add Link</button>
                        </form>
                        <form action="/admin_action" method="POST" class="mt-2">
                            <input type="hidden" name="type" value="{{ sec[2] }}">
                            <input type="hidden" name="id" value="{{ item._id }}">
                            <button name="action" value="delete_item" class="btn btn-link text-danger p-0" style="font-size: 10px; text-decoration:none;">Delete Movie</button>
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

<footer class="text-center py-5 mt-5 border-top border-secondary text-muted small">
    <p>&copy; 2025 {{ settings.logo }} - Developed with Python & MongoDB</p>
</footer>

<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>
"""

# --- রাউটস ও লজিক ---

@app.route('/')
def home():
    settings = settings_col.find_one()
    m = list(movies_col.find().sort('_id', -1))
    t = list(tv_shows_col.find().sort('_id', -1))
    return render_template_string(HTML_TEMPLATE, settings=settings, movies=m, tv_shows=t, admin=session.get('admin'))

@app.route('/search', methods=['POST'])
def search():
    if not session.get('admin'): return redirect('/')
    query = request.form.get('query')
    # TMDB থেকে মুভি এবং টিভি শো উভয়ই সার্চ করবে
    m_url = f"https://api.themoviedb.org/3/search/movie?api_key={TMDB_API_KEY}&query={query}"
    t_url = f"https://api.themoviedb.org/3/search/tv?api_key={TMDB_API_KEY}&query={query}"
    res = requests.get(m_url).json().get('results', []) + requests.get(t_url).json().get('results', [])
    return render_template_string(HTML_TEMPLATE, settings=settings_col.find_one(), 
                                  movies=list(movies_col.find().sort('_id', -1)), 
                                  tv_shows=list(tv_shows_col.find().sort('_id', -1)), 
                                  search_results=res, admin=session.get('admin'))

@app.route('/save/<type>/<tmdb_id>')
def save_item(type, tmdb_id):
    if not session.get('admin'): return redirect('/')
    col = movies_col if type == 'movie' else tv_shows_col
    url = f"https://api.themoviedb.org/3/{type}/{tmdb_id}?api_key={TMDB_API_KEY}"
    d = requests.get(url).json()
    name = d.get('title') if type == 'movie' else d.get('name')
    if not col.find_one({"tmdb_id": d['id']}):
        col.insert_one({"tmdb_id": d['id'], "title": name, "poster": d.get('poster_path'), "rating": d.get('vote_average'), "links": []})
    return redirect(url_for('home'))

@app.route('/add_link/<type>/<id>', methods=['POST'])
def add_link(type, id):
    if session.get('admin'):
        col = movies_col if type == 'movie' else tv_shows_col
        new_link = {"quality": request.form.get('q'), "btn_name": request.form.get('btn'), "url": request.form.get('url')}
        col.update_one({"_id": ObjectId(id)}, {"$push": {"links": new_link}})
    return redirect(url_for('home'))

@app.route('/delete_link/<type>/<id>/<int:index>')
def delete_link(type, id, index):
    if session.get('admin'):
        col = movies_col if type == 'movie' else tv_shows_col
        links = col.find_one({"_id": ObjectId(id)}).get('links', [])
        links.pop(index)
        col.update_one({"_id": ObjectId(id)}, {"$set": {"links": links}})
    return redirect(url_for('home'))

@app.route('/admin_action', methods=['POST'])
def admin_action():
    action = request.form.get('action')
    if action == "login" and request.form.get('pass') == "admin123":
        session['admin'] = True
    elif action == "logout":
        session.pop('admin', None)
    elif action == "update_settings" and session.get('admin'):
        settings_col.update_one({}, {"$set": {"logo": request.form.get('logo'), "notice": request.form.get('notice')}})
    elif action == "delete_item" and session.get('admin'):
        col = movies_col if request.form.get('type') == 'movie' else tv_shows_col
        col.delete_one({"_id": ObjectId(request.form.get('id'))})
    return redirect(url_for('home'))

if __name__ == '__main__':
    # রেন্ডার পোর্টের জন্য ফিক্স
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
