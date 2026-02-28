const { Pool } = require('pg');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'news_intelligence', password: 'openclaw', port: 5432,
});

async function calculateScores() {
    console.log('📊 Calculating daily interest scores...');
    
    // 1. Fetch clicks from AWS (Simplistic: ssh and cat the log)
    let clicks = [];
    try {
        console.log('   🖱️ Fetching click logs from AWS...');
        const rawLogs = execSync(`ssh -i ~/aws/LightsailDefaultKey-us-east-1.pem -o StrictHostKeyChecking=no ubuntu@18.207.108.44 "cat /home/ubuntu/backend/clicks.log"`, { encoding: 'utf8' });
        clicks = rawLogs.trim().split('\n').filter(l => l).map(l => JSON.parse(l));
    } catch (e) {
        console.warn('   ⚠️ Failed to fetch click logs:', e.message);
    }

    // Filter clicks for today (GMT+8)
    const today = new Date().toISOString().split('T')[0];
    const clickedStoryIds = new Set(clicks.filter(c => c.timestamp && c.timestamp.startsWith(today)).map(c => c.story_id));

    // 2. Get all active stories
    const res = await pool.query('SELECT story_id FROM story');
    const stories = res.rows;

    for (const story of stories) {
        let score = 0;
        const storyId = story.story_id;

        // Factor A: My Interest (Clicked Today) +50
        if (clickedStoryIds.has(storyId)) {
            score += 50;
        }

        // Factor B: New Timeline Entry Today +30
        const timelineRes = await pool.query('SELECT story_status_id, date FROM story_timeline WHERE story_id = $1 ORDER BY date DESC LIMIT 1', [storyId]);
        const latestEntry = timelineRes.rows[0];
        
        if (latestEntry && latestEntry.date.toISOString().split('T')[0] === today) {
            score += 30;
            
            // Factor C: Escalating Status +20
            if (latestEntry.story_status_id === 'escalating') {
                score += 20;
            }
        }

        // Factor D: New Story (Created Today/Only 1 entry) +10
        const countRes = await pool.query('SELECT COUNT(*) FROM story_timeline WHERE story_id = $1', [storyId]);
        if (parseInt(countRes.rows[0].count) === 1) {
            score += 10;
        }

        // Update DB
        await pool.query('UPDATE story SET interest_score = $1 WHERE story_id = $2', [score, storyId]);
    }

    console.log(`✅ Scores updated for ${stories.length} stories.`);
}

calculateScores().then(() => pool.end());
