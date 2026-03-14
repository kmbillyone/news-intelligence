const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'news_intelligence',
    password: 'openclaw',
    port: 5432,
});

async function clearTranslations() {
    await pool.query('UPDATE story SET label_zh = NULL WHERE story_id IN (SELECT story_id FROM story LIMIT 5)');
    await pool.query('UPDATE story_timeline SET title_zh = NULL, sub_title_zh = NULL, summary_zh = NULL WHERE story_id IN (SELECT story_id FROM story LIMIT 5)');
    console.log('Cleared 5 translations for testing.');
    await pool.end();
}

clearTranslations();
