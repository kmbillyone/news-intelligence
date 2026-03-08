const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'news_intelligence',
    password: 'openclaw',
    port: 5432,
});

async function clearOldStories() {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        console.log('🗑️ Clearing all timeline sources...');
        await client.query('DELETE FROM story_timeline_source');
        
        console.log('🗑️ Clearing all timeline entries...');
        await client.query('DELETE FROM story_timeline');
        
        console.log('🗑️ Clearing all stories...');
        await client.query('DELETE FROM story');
        
        await client.query('COMMIT');
        console.log('✅ All stories and timelines have been cleared.');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Error clearing stories:', e.message);
    } finally {
        client.release();
        process.exit();
    }
}

clearOldStories();
