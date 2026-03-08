const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { execSync } = require('child_process');
const { geminiCLI, geminiGroundingRadarPython, geminiGroundingWithMetadata } = require('./modules/geminiHelper');
const { resolveSources } = require('./modules/urlResolver');

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

function validateReferences(result) {
    if (!result.summary) return false;
    const lowerSummary = result.summary.trim().toLowerCase();
    if (lowerSummary === "no_new_developments") return true;
    
    if (!Array.isArray(result.sources) || result.sources.length === 0) {
        console.warn(`   ⚠️ No grounding sources were found.`);
        return true; // Still allow empty sources, just warn
    }
    
    // Sort sources by publisher to have a consistent order
    result.sources.sort((a, b) => (a.publisher || "").localeCompare(b.publisher || ""));
    
    const oldSourceIds = (result.sources || []).map(s => s.id);
    const newSources = result.sources.map((s, idx) => ({ ...s, newId: idx + 1 }));
    const idMap = new Map();
    newSources.forEach(s => idMap.set(s.id, s.newId));

    // Updated refRegex to match multiple references like [1], [1.2], or [1.24, 1.26]
    const refRegex = /\[([0-9.,\s]+)\]/g;
    
    // Clean up references in the summary
    result.summary = result.summary.replace(refRegex, (match, p1) => {
        // Split by comma in case there are multiple references
        const parts = p1.split(',').map(p => p.trim()).filter(p => p);
        const mappedIds = [];
        
        for (const p of parts) {
            // Extract the base integer if it's a decimal like "1.24"
            const refId = parseInt(p.split('.')[0]);
            if (idMap.has(refId)) {
                mappedIds.push(idMap.get(refId));
            } else {
                console.warn(`   ⚠️ Removing broken reference [${p}].`);
            }
        }
        
        // Return unique mapped IDs joined by commas
        const uniqueMapped = [...new Set(mappedIds)];
        if (uniqueMapped.length === 0) return "";
        return `[${uniqueMapped.join(', ')}]`;
    });
    
    // Update IDs in sources
    result.sources = newSources.map(s => ({
        id: s.newId,
        publisher: s.publisher,
        url: s.url
    }));

    // Clean up empty brackets and double spaces
    result.summary = result.summary.replace(/\s+\[\]/g, '').replace(/\[\]/g, '').replace(/  +/g, ' ');
    
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
You are generating a comprehensive daily intelligence report for a tracked News Story.

Requirements:
- Search for the latest developments related to the story within the past 24 hours.
- Base your summary on 5-10 verifiable news references.
- Produce a ONE LINE TITLE (around 10-15 words) for today's development.
- Produce a SUB-TITLE (around 20-30 words) providing context for the development.
- Produce an ARTICLE-STYLE SUMMARY with multiple paragraphs (total around 500 words).
- Every factual statement MUST include inline references [n] mapping to the citations in the grounding metadata.
- If NO significant news or new developments are found for this specific story within the past 24 hours, return exactly:
  { "summary": "NO_NEW_DEVELOPMENTS", "status": "stable", "sources": [] }

Reply in strict JSON with the following structure:
{
	"title": "One line title here",
	"sub_title": "Descriptive sub-title providing context",
	"summary": "Full article with multiple paragraphs and inline [1] [2] markers...",
	"status": "ongoing"
}

TARGET STORY:
	name: ${story.label}
	history snippet:
		${history || 'No previous history found.'}
`;

    let attempts = 0;
    let result = null;
    const maxRetries = 2;

    while (attempts < maxRetries) {
        attempts++;
        console.log(`   Attempt ${attempts} to fetch data with grounding metadata...`);
        try {
            const response = await geminiGroundingWithMetadata(prompt);
            
            if (response.text.includes("NO_NEW_DEVELOPMENTS")) {
                result = { summary: "NO_NEW_DEVELOPMENTS", status: "stable", sources: [] };
                break;
            }

            const firstBrace = response.text.indexOf('{');
            const lastBrace = response.text.lastIndexOf('}');
            if (firstBrace === -1 || lastBrace === -1) {
                throw new Error("Could not find JSON structure in response text.");
            }
            
            const articleData = JSON.parse(response.text.substring(firstBrace, lastBrace + 1));
            
            const sources = [];
            if (response.groundingMetadata && Array.isArray(response.groundingMetadata.groundingChunks)) {
                response.groundingMetadata.groundingChunks.forEach((chunk, index) => {
                    if (chunk.web) {
                        sources.push({
                            id: index + 1,
                            publisher: chunk.web.title || "News Source",
                            url: chunk.web.uri
                        });
                    }
                });
            }

            result = {
                title: articleData.title,
                sub_title: articleData.sub_title,
                summary: articleData.summary,
                status: articleData.status || "ongoing",
                sources: sources,
                groundingMetadata: response.groundingMetadata
            };

            if (result.title && result.summary && validateReferences(result)) {
                if (result.sources && result.sources.length > 0) {
                    console.log(`   🔗 Resolving ${result.sources.length} news URLs...`);
                    result.sources = await resolveSources(result.sources);
                }
                break;
            } else {
                console.warn(`   ⚠️ Validation failed (invalid structure or references).`);
                result = null;
            }
        } catch (e) {
            console.error(`   ❌ Attempt ${attempts} failed: ${e.message}`);
        }
    }

    if (result) {
        if (result.summary === "NO_NEW_DEVELOPMENTS") {
            console.log(`   ⏭️ No new developments for "${story.label}".`);
        } else {
            if (result.sources && result.sources.length > 0) {
                const urls = result.sources.map(s => s.url);
                result.thumbnails = await fetchThumbnails(urls);
            }
            await saveTimeline(story.story_id, result);
        }
    } else {
        console.error(`   ❌ Failed to get valid data for story "${story.label}" after retries.`);
    }
}

async function saveTimeline(storyId, data) {
    const client = await pool.connect();
    const today = new Date().toISOString().split('T')[0];
    try {
        await client.query('BEGIN');
        
        await client.query(`
            INSERT INTO story_timeline (story_id, date, title, sub_title, summary, story_status_id, thumbnails)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
            ON CONFLICT (story_id, date) 
            DO UPDATE SET title = $3, sub_title = $4, summary = $5, story_status_id = $6, thumbnails = $7
        `, [storyId, today, data.title, data.sub_title, data.summary, data.status.toLowerCase(), JSON.stringify(data.thumbnails || [])]);

        await client.query(`DELETE FROM story_timeline_source WHERE story_id = $1 AND date = $2`, [storyId, today]);
        if (Array.isArray(data.sources)) {
            for (const src of data.sources) {
                await client.query(`
                    INSERT INTO story_timeline_source (story_id, date, source_id, publisher, url)
                    VALUES ($1, $2, $3, $4, $5)
                `, [storyId, today, src.id, src.publisher, src.url]);
            }
        }

        await client.query(`UPDATE story SET last_updated = NOW() WHERE story_id = $1`, [storyId]);
        
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
    const stories = await getTopStories(15);
    console.log(`📋 Processing ${stories.length} stories.`);

    for (let i = 0; i < stories.length; i++) {
        const story = stories[i];
        try {
            await processStory(story);
            if (i < stories.length - 1) {
                console.log(`   ⏳ Delaying 15s before processing next story to avoid rate limits...`);
                await new Promise(res => setTimeout(res, 15000));
            }
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
