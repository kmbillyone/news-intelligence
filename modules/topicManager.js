const fs = require('fs');
const path = require('path');

const TOPICS_DIR = path.join(__dirname, '../data/topics');

class TopicManager {
    constructor() {
        if (!fs.existsSync(TOPICS_DIR)) {
            fs.mkdirSync(TOPICS_DIR, { recursive: true });
        }
    }

    getTopic(topicId) {
        const filePath = path.join(TOPICS_DIR, `topic_${topicId}.json`);
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
        return null;
    }

    getAllTopics() {
        return fs.readdirSync(TOPICS_DIR)
            .filter(file => file.endsWith('.json'))
            .map(file => JSON.parse(fs.readFileSync(path.join(TOPICS_DIR, file), 'utf8')));
    }

    saveTopic(topic) {
        // Validation (Basic Schema Check)
        if (!topic.topic_id || !topic.label) {
            throw new Error("Invalid topic schema: missing topic_id or label");
        }

        const filePath = path.join(TOPICS_DIR, `topic_${topic.topic_id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2));
        return filePath;
    }

    createTopic(label, category, initialSummary, initialArticle) {
        const topicId = crypto.randomUUID().split('-')[0]; // Short ID
        const now = new Date().toISOString();
        
        const newTopic = {
            topic_id: topicId,
            label: label,
            category: category || 'general',
            interest_score: 0.5, // Default start
            last_updated: now,
            status: 'new',
            summary: initialSummary,
            timeline: [{
                date: now,
                event: 'Initial Discovery',
                source_count: 1,
                sources: [initialArticle.url],
                update_count: 1
            }]
        };
        
        this.saveTopic(newTopic);
        return newTopic;
    }
}

module.exports = TopicManager;
