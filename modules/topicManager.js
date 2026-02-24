const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        if (!fs.existsSync(TOPICS_DIR)) return [];
        return fs.readdirSync(TOPICS_DIR)
            .filter(file => file.endsWith('.json'))
            .map(file => {
                try {
                    return JSON.parse(fs.readFileSync(path.join(TOPICS_DIR, file), 'utf8'));
                } catch (e) {
                    return null;
                }
            })
            .filter(t => t !== null);
    }

    saveTopic(topic) {
        if (!topic.topic_id || !topic.label) {
            throw new Error("Invalid topic schema: missing topic_id or label");
        }
        const filePath = path.join(TOPICS_DIR, `topic_${topic.topic_id}.json`);
        fs.writeFileSync(filePath, JSON.stringify(topic, null, 2));
        return filePath;
    }

    updateTopic(topicId, analysis, reports) {
        const topic = this.getTopic(topicId);
        if (!topic) return null;

        const now = new Date().toISOString();
        topic.last_updated = now;
        topic.status = analysis.novelty || 'ongoing';
        topic.signal_strength = analysis.signal_strength || 'medium';

        // Add new events to timeline
        analysis.supporting_reports.forEach(idx => {
            const r = reports[idx];
            if (r) {
                topic.timeline.push({
                    date: now,
                    event: r.title,
                    description: r.description,
                    publication: r.publication,
                    url: r.url
                });
            }
        });

        this.saveTopic(topic);
        return topic;
    }

    createTopicFromAnalysis(analysis, reports) {
        const topicId = crypto.randomUUID().split('-')[0];
        const now = new Date().toISOString();
        
        const firstReport = reports[analysis.supporting_reports[0]] || {};

        const newTopic = {
            topic_id: topicId,
            label: analysis.situation_label,
            category: analysis.category || 'general',
            interest_score: 0.5,
            last_updated: now,
            status: analysis.novelty || 'new',
            scope: analysis.scope || 'international',
            signal_strength: analysis.signal_strength || 'medium',
            timeline: analysis.supporting_reports.map(idx => {
                const r = reports[idx];
                return {
                    date: r.published_time || now,
                    event: r.title,
                    description: r.description,
                    publication: r.publication,
                    url: r.url
                };
            })
        };
        
        this.saveTopic(newTopic);
        return newTopic;
    }
}

module.exports = TopicManager;
