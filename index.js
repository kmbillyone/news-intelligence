const fs = require('fs');
const path = require('path');
const dailyRadar = require('./modules/dailyRadar');
const TopicManager = require('./modules/topicManager');

const SOURCES_PATH = path.join(__dirname, 'data/sources/sources.json');
const RAW_DIR = path.join(__dirname, 'data/raw_articles');

async function main() {
    console.log('🕵️‍♀️ Little Miss AI: Starting Daily Intelligence Cycle...');

    // 1. Load Scope
    const sources = JSON.parse(fs.readFileSync(SOURCES_PATH, 'utf8'));
    // Generate queries based on categories
    const queries = [
        "latest technology news", 
        "artificial intelligence news", 
        "Hong Kong news today",
        "global world news today"
    ];

    // 2. Run Radar
    const { topics, rawArticles } = await dailyRadar.runRadar(queries);
    console.log(`✅ Radar finished. Found ${rawArticles.length} articles, clustered into ${topics.length} topics.`);

    // 3. Save Raw Articles (Log)
    const dateStr = new Date().toISOString().split('T')[0];
    const rawFile = path.join(RAW_DIR, `${dateStr}.jsonl`);
    const rawStream = fs.createWriteStream(rawFile, { flags: 'a' });
    rawArticles.forEach(a => rawStream.write(JSON.stringify(a) + '\n'));
    rawStream.end();

    // 4. Topic Management (Integration)
    const topicMgr = new TopicManager();
    const existingTopics = topicMgr.getAllTopics(); // TODO: Implement smarter fuzzy matching later

    console.log('💾 Updating Topic Memory...');
    for (const t of topics) {
        // Simple "New Topic" creation for now. 
        // Real system would check if topic exists via fuzzy matching title.
        const created = topicMgr.createTopic(
            t.label, 
            t.category, 
            t.initial_summary, 
            { url: t.related_links[0] }
        );
        console.log(`   + New Topic: [${created.label}]`);
    }

    console.log('🎉 Intelligence Cycle Complete. Data ready for briefing.');
}

main().catch(console.error);
