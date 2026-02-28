const { Pool } = require('pg');
const { execSync } = require('child_process');

const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'news_intelligence', password: 'openclaw', port: 5432,
});

async function updateThumbnails() {
    console.log('🖼️ Fetching thumbnails for stories...');
    const res = await pool.query(`
        SELECT story_id, date 
        FROM story_timeline 
        WHERE thumbnails IS NULL AND summary != 'NO_NEW_DEVELOPMENTS'
        ORDER BY date DESC LIMIT 10
    `);

    for (const row of res.rows) {
        const sources = await pool.query(`SELECT url FROM story_timeline_source WHERE story_id = $1 AND date = $2 LIMIT 3`, [row.story_id, row.date]);
        const urls = sources.rows.map(s => s.url);
        
        let found = [];
        for (const url of urls) {
            try {
                // Use existing thumbnail extraction logic pattern: fetch meta tags
                const cmd = `curl -sL "${url}" | grep -oE '<meta [^>]*property="og:image"[^>]*content="([^"]+)"' | head -1 | sed -E 's/.*content="([^"]+)".*/\\1/'`;
                const imgUrl = execSync(cmd, { timeout: 5000 }).toString().trim();
                if (imgUrl && imgUrl.startsWith('http')) found.push(imgUrl);
            } catch (e) {}
        }
        
        await pool.query('UPDATE story_timeline SET thumbnails = $1 WHERE story_id = $2 AND date = $3', [JSON.stringify(found), row.story_id, row.date]);
        console.log(`✅ Updated thumbnails for ${row.story_id}`);
    }
}

updateThumbnails().then(() => pool.end());
