const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { geminiGroundingRadarPython } = require('./modules/geminiHelper');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'news_intelligence',
    password: 'openclaw',
    port: 5432,
});

async function getTopStories(limit = 5) {
    const res = await pool.query(`
        SELECT story_id, label 
        FROM story 
        ORDER BY last_updated DESC 
        LIMIT $1
    `, [limit]);
    return res.rows;
}

async function getStoryHistory(storyId, days = 5) {
    const res = await pool.query(`
        SELECT date, summary 
        FROM story_timeline 
        WHERE story_id = $1 
        ORDER BY date DESC 
        LIMIT $2
    `, [storyId, days]);
    return res.rows.map(row => `${row.date.toISOString().split('T')[0]}: ${row.summary}`).join('\n');
}

/**
 * Validates that all [n] references in summary have a corresponding entry in sources.
 */
function validateReferences(summary, sources) {
    if (!summary || !Array.isArray(sources)) return false;
    
    // Check for "Concise summary" placeholder
    if (summary.trim().startsWith("Concise summary with references")) {
        console.warn(`   ⚠️ Detected placeholder summary text. Retrying...`);
        return false;
    }
    
    const sourceIds = sources.map(s => s.id);
    const refRegex = /\[(\d+)\]/g;
    let match;
    let foundAny = false;
    
    while ((match = refRegex.exec(summary)) !== null) {
        foundAny = true;
        const refId = parseInt(match[1]);
        if (!sourceIds.includes(refId)) {
            console.warn(`   ⚠️ Reference [${refId}] has no corresponding source.`);
            return false;
        }
    }
    
    return true;
}

async function processStory(story) {
    console.log(`\n🔄 Processing story: ${story.label} (${story.story_id})`);
    const history = await getStoryHistory(story.story_id);
    
    const prompt = `
You are generating a consolidated update for a tracked Story. The summary of last 5 days on the story are provided for reference.

Requirements:

- Search for any web pages (sources) with the latest developments related to the story within the past 24 hours.
- Produce a concise summary on the latest development (under 200 words).
- Every factual statement must include inline references to the source id (integer).
- If a fact appears in multiple sources, cite all relevant source ids.
- Assign a unique, incremental integer (1, 2, 3...) to each unique source URL found. Do not use the sub-indices (like 1.1 or 2.1) provided by the search tool.
- Do NOT invent sources.
- Do NOT cite a source for information not present in its extract.
- If sources disagree, explicitly state the difference and cite them.
- Give a status to the story (new / ongoing / escalating / stable) according to the latest development.
- Return in strict JSON format, do NOT include any other text.
- IMPORTANT: Use actual search results for the summary. DO NOT use "Concise summary with references [1] [2]..." as placeholder text. Write the actual summary.
- IMPORTANT: If NO relevant news is found in the search results, return:
  { "status": "stable", "summary": "No significant updates found in the past 24 hours.", "sources": [] }

Format example (FOR JSON STRUCTURE ONLY):
{
	"summary": "Apple announced the iPhone 16 today [1]. Analysts predict strong sales [2].",
	"status": "ongoing",
	"sources": [
		{
			"id": 1,
			"publisher": "TechCrunch",
			"url": "https://techcrunch.com/..."
		},
		{
			"id": 2,
			"publisher": "Bloomberg",
			"url": "https://bloomberg.com/..."
		}
	]
}

TARGET STORY:
	name: ${story.label}
	history:
		${history || 'No previous history found.'}
`;

    let attempts = 0;
    let result = null;

    while (attempts < 3) {
        attempts++;
        console.log(`   Attempt ${attempts} to fetch data...`);
        try {
            // Using gemini-3-pro-preview for better quality summaries as requested by logic (even though heartbeat might use flash for basic tasks, consolidation is complex)
            // Reverting to pro-preview to avoid "Concise summary" lazy output from flash if possible, or sticking to flash if mandated.
            // Let's use pro-preview for better compliance.
            result = await geminiGroundingRadarPython(prompt, 'gemini-3-pro-preview');
            
        if (result && validateReferences(result.summary, result.sources)) {
            // Additional check: Ensure status is valid
            const validStatuses = ['new', 'ongoing', 'escalating', 'stable'];
            if (!validStatuses.includes(result.status.toLowerCase())) {
                 console.warn(`   ⚠️ Invalid status "${result.status}". Defaulting to "ongoing".`);
                 result.status = 'ongoing';
            }
            break;
        } else {
            console.warn(`   ⚠️ Validation failed. Retrying...`);
            result = null;
        }
        } catch (e) {
            console.error(`   ❌ Attempt ${attempts} failed: ${e.message}`);
        }
    }

    if (result) {
        await saveTimeline(story.story_id, result);
    } else {
        console.error(`   ❌ Failed to get valid data for story "${story.label}" after 3 attempts.`);
    }
}

async function saveTimeline(storyId, data) {
    const client = await pool.connect();
    const today = new Date().toISOString().split('T')[0];
    
    try {
        await client.query('BEGIN');
        
        // 1. Upsert into story_timeline
        // Note: story_status_id is a FK to story_status, must match 'new', 'ongoing', 'escalating', or 'stable'
        const statusId = data.status.toLowerCase();
        
        await client.query(`
            INSERT INTO story_timeline (story_id, date, summary, story_status_id)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (story_id, date) 
            DO UPDATE SET summary = $3, story_status_id = $4
        `, [storyId, today, data.summary, statusId]);

        // 2. Overwrite sources for today (Delete then Insert)
        await client.query(`
            DELETE FROM story_timeline_source 
            WHERE story_id = $1 AND date = $2
        `, [storyId, today]);

        if (Array.isArray(data.sources)) {
            for (const src of data.sources) {
                await client.query(`
                    INSERT INTO story_timeline_source (story_id, date, source_id, publisher, url)
                    VALUES ($1, $2, $3, $4, $5)
                `, [storyId, today, src.id, src.publisher, src.url]);
            }
        }

        await client.query('COMMIT');
        console.log(`   ✅ Successfully updated timeline and sources for today (${today}).`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`   ❌ DB Error for story ${storyId}: ${e.message}`);
    } finally {
        client.release();
    }
}

async function main() {
    console.log('🌟 Starting Story Consolidation Job...');
    const stories = await getTopStories(5);
    console.log(`📋 Processing ${stories.length} stories.`);

    for (const story of stories) {
        try {
            await processStory(story);
        } catch (err) {
            console.error(`💥 Error processing story ${story.story_id}:`, err);
        }
    }

    console.log('\n✨ Consolidation Job Complete.');
    process.exit(0);
}

main().catch(err => {
    console.error('💥 Fatal Error:', err);
    process.exit(1);
});
