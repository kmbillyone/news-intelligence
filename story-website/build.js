const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const pool = new Pool({
    user: 'postgres', host: 'localhost', database: 'news_intelligence', password: 'openclaw', port: 5432,
});

async function build() {
    console.log('🏗️ Building AIIA Story Website with Interest Scores...');
    
    // 1. Get stories
    const storyRes = await pool.query(`
        SELECT s.story_id, s.label, s.label_zh, s.category_id, s.last_updated, s.interest_score, s.is_hot
        FROM story s
        ORDER BY s.interest_score DESC, s.last_updated DESC LIMIT 150
    `);

    const stories = [];
    for (const story of storyRes.rows) {
        const timelineRes = await pool.query(`
            SELECT title, title_zh, sub_title, sub_title_zh, summary, summary_zh, date, story_status_id as status, thumbnails, grounding_supports, updated_at
            FROM story_timeline
            WHERE story_id = $1
            ORDER BY date DESC
        `, [story.story_id]);

        const timeline = [];
        for (const entry of timelineRes.rows) {
            const sourceRes = await pool.query(`
                SELECT source_id as id, publisher, url 
                FROM story_timeline_source 
                WHERE story_id = $1 AND date = $2
            `, [story.story_id, entry.date]);
            
            timeline.push({
                ...entry,
                date: entry.date.toISOString().split('T')[0],
                sources: sourceRes.rows
            });
        }

        if (timeline.length > 0) {
            const latest = timeline[0];
            const titleZh = latest.title_zh || '';
            const titleEn = latest.title || '';
            
            if (titleZh.includes('內容摘要') || titleEn.toLowerCase().includes('summary')) {
                continue;
            }

            stories.push({
                ...story,
                timeline: timeline,
                isNew: timeline.length === 1,
                ...latest,
                date: latest.date
            });
        }
        
        if (stories.length >= 100) break;
    }

    const topTheme = stories.find(s => s.is_hot) || (stories.length > 0 ? stories[0] : null);

    const pub = path.join(__dirname, 'public');
    if (!fs.existsSync(pub)) fs.mkdirSync(pub, { recursive: true });
    
    // 3. Fetch Weather
    console.log('🌤️ Fetching weather data...');
    let weather = null;
    try {
        console.log('   -> Fetching HKO Current...');
        const currRes = await fetch('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc');
        const curr = await currRes.json();
        
        console.log('   -> Fetching HKO Forecast...');
        const fcastRes = await fetch('https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=fnd&lang=tc');
        const fcast = await fcastRes.json();
        
        console.log('   -> Fetching Open-Meteo Hourly...');
        const hourlyRes = await fetch('https://api.open-meteo.com/v1/forecast?latitude=22.3&longitude=114.17&hourly=temperature_2m,precipitation_probability,weather_code&timezone=Asia%2FHong_Kong&forecast_days=2');
        const hourly = await hourlyRes.json();
        
        weather = { current: curr, forecast: fcast, hourly: hourly };
        console.log('   ✅ Weather data fetched successfully.');
    } catch (e) {
        console.error('   ⚠️ Weather fetch failed:', e.message);
    }

    fs.writeFileSync(path.join(pub, 'data.json'), JSON.stringify({
        stories: stories,
        topTheme: topTheme,
        generatedAt: new Date().toISOString(),
        weather: weather
    }, null, 2));

    fs.copyFileSync(path.join(__dirname, 'templates/index.html'), path.join(pub, 'index.html'));
    console.log('✨ Build Complete.');
}

build().then(() => pool.end());
