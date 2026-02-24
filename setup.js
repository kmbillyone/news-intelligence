const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'user_feedback', 'interactions.db');
const SOURCES_PATH = path.join(DATA_DIR, 'sources', 'sources.json');

// 1. Initialize SQLite Database
console.log('Initializing User Feedback Database...');
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS interactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic_id TEXT NOT NULL,
      article_url TEXT,
      interaction_type TEXT NOT NULL, -- 'click', 'dwell', 'impression'
      dwell_time INTEGER, -- in seconds
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `, (err) => {
    if (err) {
      console.error('❌ Database initialization failed:', err.message);
    } else {
      console.log('✅ Database initialized at:', DB_PATH);
    }
    db.close();
  });
});

// 2. Initialize Sources Registry
if (!fs.existsSync(SOURCES_PATH)) {
    const initialSources = {
        "local": ["https://news.rthk.hk", "https://news.mingpao.com", "https://www.scmp.com"],
        "international": ["https://www.bbc.com/news", "https://www.reuters.com", "https://apnews.com"],
        "tech": ["https://techcrunch.com", "https://www.theverge.com", "https://venturebeat.com"],
        "discovery": [] // Populated by Source Explorer
    };
    fs.writeFileSync(SOURCES_PATH, JSON.stringify(initialSources, null, 2));
    console.log('✅ Sources registry initialized.');
} else {
    console.log('ℹ️ Sources registry already exists.');
}

console.log('🚀 Infrastructure setup logic loaded.');
