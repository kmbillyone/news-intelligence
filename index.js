const fs = require('fs');
const path = require('path');
const dailyRadar = require('./modules/dailyRadar');
const db = require('./modules/db');

const RAW_DIR = path.join(__dirname, 'data/raw_articles');

async function main() {
    console.log('🕵️‍♀️ Little Miss AI: Starting Improved Intelligence Cycle (DB-Driven)...');

    if (!fs.existsSync(RAW_DIR)) {
        fs.mkdirSync(RAW_DIR, { recursive: true });
    }

    // 1. Run Radar Sweep (Grounding - Prompt 1)
    const reports = await dailyRadar.runRadar();
    if (!reports || reports.length === 0) {
        console.log('⚠️ No reports found in radar sweep.');
        return;
    }

    // Save Raw Reports to local JSON for backup
    const dateStr = new Date().toISOString().split('T')[0];
    const rawFile = path.join(RAW_DIR, `${dateStr}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(reports, null, 2));
    console.log(`✅ Raw reports saved to ${rawFile}`);

    // 2. Load Existing Stories from Postgres
    console.log('🐘 Fetching existing stories from DB...');
    const existingStories = await db.getActiveStories();
    
    // 3. Run Identification (Prompt 2)
    const newStoriesFound = await dailyRadar.runClustering(reports, existingStories);
    if (!newStoriesFound || !Array.isArray(newStoriesFound)) {
        console.log('⚠️ Identification failed or returned no new stories.');
        return;
    }

    // 4. Update Story Table in Postgres
    if (newStoriesFound.length > 0) {
        console.log(`💾 Inserting ${newStoriesFound.length} new stories into DB...`);
        await db.insertNewStories(newStoriesFound);
        console.log('🎉 DB Update Complete.');
    } else {
        console.log('ℹ️ No new stories identified to insert.');
    }

    console.log('🎉 Improved Intelligence Cycle Complete.');
    process.exit(0);
}

main().catch(err => {
    console.error('❌ Cycle Failed:', err);
    process.exit(1);
});
