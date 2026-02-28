const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { execSync } = require('child_process');
const { geminiCLI, geminiGroundingRadarPython } = require('./modules/geminiHelper');

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
        ORDER BY interest_score DESC, last_updated DESC 
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
    return res.rows.map(row => `${row.date.toISOString().split('T')[0]}: ${row.summary.substring(0, 100)}...`).join('\n');
}

function validateReferences(summary, sources) {
    if (!summary || !Array.isArray(sources)) return false;
    const lowerSummary = summary.trim().toLowerCase();
    if (lowerSummary === "no_new_developments") return true;
    
    const sourceIds = sources.map(s => s.id);
    const refRegex = /\[(\d+)\]/g;
    let match;
    while ((match = refRegex.exec(summary)) !== null) {
        const refId = parseInt(match[1]);
        if (!sourceIds.includes(refId)) {
            console.warn(`   ⚠️ Reference [${refId}] has no corresponding source.`);
            return false;
        }
    }
    return true;
}

async function fetchThumbnails(urls) {
    let found = [];
    for (const url of urls.slice(0, 3)) {
        try {
            console.log(`   🖼️ Grepping thumbnail from: ${url}`);
            // Use curl to fetch the page and grep for og:image
            const cmd = `curl -sL --max-time 10 "${url}" | grep -oE '<meta [^>]*property="og:image"[^>]*content="([^"]+)"' | head -1 | sed -E 's/.*content="([^"]+)".*/\\1/'`;
            const imgUrl = execSync(cmd, { timeout: 15000 }).toString().trim();
            if (imgUrl && imgUrl.startsWith('http')) {
                found.push(imgUrl);
            }
        } catch (e) {
            console.warn(`   ⚠️ Thumbnail fetch failed for ${url}: ${e.message}`);
        }
    }
    return found;
}

async function processStory(story) {
    console.log(`\n🔄 Processing story: ${story.label} (${story.story_id})`);
    const history = await getStoryHistory(story.story_id);
    
    const prompt = `
You are generating a comprehensive daily intelligence report for a tracked Story. 

Requirements:
- Search for latest developments related to the story within the past 24 hours.
- Produce a ONE LINE TITLE for today's development (around 10-15 words).
- CRITICAL: Use a rich and descriptive title. DO NOT use generic phrases like "Summary" or "內容摘要". Every title must reflect the specific event.
- Produce a SUB-TITLE (around 20-30 words) providing context for the development.
- Produce an ARTICLE-STYLE SUMMARY with multiple paragraphs (total around 500 words).
- Every factual statement must include inline references [n]. Each reference must be included in the sources array, with the direct URL to the related news report.
- If NO significant news or new developments are found for this specific story within the past 24 hours, return exactly:
  { "summary": "NO_NEW_DEVELOPMENTS", "status": "stable", "sources": [] }

Reply in strict JSON. Do NOT include any other text.

Format:
{
	"title": "One line title here",
	"sub_title": "Descriptive sub-title providing context for the day",
	"summary": "Full article with multiple paragraphs [1] [2].\\n\\nSecond paragraph here [3]...",
	"status": "ongoing",
	"sources": [
		{ "id": 1, "publisher": "Publisher Name", "url": "direct URL to the news report" }
	]
}

TARGET STORY:
	name: ${story.label}
	history snippet:
		${history || 'No previous history found.'}
`;

    let attempts = 0;
    let result = null;

    while (attempts < 3) {
        attempts++;
        console.log(`   Attempt ${attempts} to fetch data...`);
        try {
            // Using default gemini-3-flash-preview via the helper
            result = await geminiCLI(prompt);
            
            if (result && (result.summary === "NO_NEW_DEVELOPMENTS" || (result.title && result.summary && validateReferences(result.summary, result.sources)))) {
                break;
            } else {
                console.warn(`   ⚠️ Validation failed (invalid structure or references).`);
                console.warn(result);
                result = null;
            }
        } catch (e) {
            console.error(`   ❌ Attempt ${attempts} failed: ${e.message}`);
        }
    }

    if (result) {
        if (result.summary.trim().toUpperCase() === "NO_NEW_DEVELOPMENTS") {
            console.log(`   ⏭️ No new developments for "${story.label}".`);
        } else {
            // Fetch thumbnails
            if (result.sources && result.sources.length > 0) {
                const urls = result.sources.map(s => s.url);
                result.thumbnails = await fetchThumbnails(urls);
            }
            await saveTimeline(story.story_id, result);
        }
    } else {
        console.error(`   ❌ Failed to get valid data for story "${story.label}" after 3 attempts.`);
    }
}

async function saveTimeline(storyId, data) {
    const client = await pool.connect();
    const today = new Date().toISOString().split('T')[0];
    try {
        await client.query('BEGIN');
        
        // Upsert timeline
        await client.query(`
            INSERT INTO story_timeline (story_id, date, title, sub_title, summary, story_status_id, thumbnails)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (story_id, date) 
            DO UPDATE SET title = $3, sub_title = $4, summary = $5, story_status_id = $6, thumbnails = $7
        `, [storyId, today, data.title, data.sub_title, data.summary, data.status.toLowerCase(), JSON.stringify(data.thumbnails || [])]);

        // Overwrite sources
        await client.query(`DELETE FROM story_timeline_source WHERE story_id = $1 AND date = $2`, [storyId, today]);
        if (Array.isArray(data.sources)) {
            for (const src of data.sources) {
                await client.query(`
                    INSERT INTO story_timeline_source (story_id, date, source_id, publisher, url)
                    VALUES ($1, $2, $3, $4, $5)
                `, [storyId, today, src.id, src.publisher, src.url]);
            }
        }
        
        await client.query('COMMIT');
        console.log(`   ✅ Updated timeline and thumbnails for ${storyId}.`);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`   ❌ DB Error for ${storyId}: ${e.message}`);
    } finally {
        client.release();
    }
}

async function main() {
    console.log('🌟 Starting Comprehensive Story Consolidation Job...');
    const stories = await getTopStories(30);
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
