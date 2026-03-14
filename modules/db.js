const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'news_intelligence',
    password: 'openclaw',
    port: 5432,
});

async function getActiveStories() {
    const res = await pool.query(`
        SELECT story_id, label, category_id 
        FROM story 
        ORDER BY last_updated DESC 
        LIMIT 100
    `);
    return res.rows.map(row => ({
        story_id: row.story_id,
        label: row.label,
        category: row.category_id
    }));
}

async function insertNewStories(analysisResults) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        for (const story of analysisResults) {
            const storyId = 'story_' + Math.random().toString(36).substr(2, 8);
            const label = story.story_title || story.situation_label;
            await client.query(
                `INSERT INTO story (story_id, label, category_id, is_hot) 
                 VALUES ($1, $2, $3, $4)`,
                [storyId, label, story.category, !!story.is_hot]
            );
            console.log(`   [DB New Story] ${label} (${story.category})`);
        }
        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { getActiveStories, insertNewStories };
