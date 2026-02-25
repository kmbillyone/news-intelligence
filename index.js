const fs = require('fs');
const path = require('path');
const dailyRadar = require('./modules/dailyRadar');
const TopicManager = require('./modules/topicManager');

const RAW_DIR = path.join(__dirname, 'data/raw_articles');

async function main() {
    console.log('🕵️‍♀️ Little Miss AI: Starting Enhanced Intelligence Cycle...');

    if (!fs.existsSync(RAW_DIR)) {
        fs.mkdirSync(RAW_DIR, { recursive: true });
    }

    // 1. Run Radar Sweep (Grounding)
    const reports = await dailyRadar.runRadar();
    if (!reports || reports.length === 0) {
        console.log('⚠️ No reports found in radar sweep.');
        return;
    }

    // Save Raw Reports immediately to prevent data loss on clustering failure
    const dateStr = new Date().toISOString().split('T')[0];
    const rawFile = path.join(RAW_DIR, `${dateStr}.json`);
    fs.writeFileSync(rawFile, JSON.stringify(reports, null, 2));
    console.log(`✅ Raw reports saved to ${rawFile}`);

    // 2. Load Existing Topics
    const topicMgr = new TopicManager();
    const existingTopics = topicMgr.getAllTopics();
    
    // Sort and trim to top 100 for context limit
    const trimmedTopics = existingTopics
        .sort((a, b) => new Date(b.last_updated) - new Date(a.last_updated))
        .slice(0, 100);

    // 3. Run Clustering (Analysis)
    const analysisResults = await dailyRadar.runClustering(reports, trimmedTopics);
    if (!analysisResults || !Array.isArray(analysisResults)) {
        console.log('⚠️ Clustering failed or returned empty analysis.');
        return;
    }

    // 4. Save Raw Reports (Daily Log) - Already saved earlier
    // const dateStr = new Date().toISOString().split('T')[0];
    // const rawFile = path.join(RAW_DIR, `${dateStr}.json`);
    // fs.writeFileSync(rawFile, JSON.stringify(reports, null, 2));
    // console.log(`✅ Raw reports saved to ${rawFile}`);

    // 5. Update Topic Memory
    console.log('💾 Synchronizing Topic Memory...');
    for (const result of analysisResults) {
        try {
            if (result.topic_action === 'attach_existing') {
                const updated = topicMgr.updateTopic(result.topic_id, result, reports);
                if (updated) {
                    console.log(`   [Attached] Topic: ${updated.label} (ID: ${updated.topic_id})`);
                } else {
                    console.log(`   [Error] Topic ID ${result.topic_id} not found for attachment. Creating new instead...`);
                    result.topic_action = 'create_new';
                    // We need a label if we're forced to create new
                    result.situation_label = result.situation_label || `Recovery: ${reports[result.supporting_reports[0]].title}`;
                }
            }
            
            if (result.topic_action === 'create_new') {
                const created = topicMgr.createTopicFromAnalysis(result, reports);
                console.log(`   [New] Topic: ${created.label} (ID: ${created.topic_id})`);
            }
        } catch (e) {
            console.error(`   [Error] Failed to process analysis result:`, e.message);
        }
    }

    console.log('🎉 Enhanced Intelligence Cycle Complete.');
}

main().catch(console.error);
