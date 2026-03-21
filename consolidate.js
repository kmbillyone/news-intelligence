const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
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

async function getTopStories(limitPerCategory = 6) {
    const categoriesRes = await pool.query('SELECT category_id FROM category');
    const categories = categoriesRes.rows.map(r => r.category_id);
    
    let allStories = [];
    for (const catId of categories) {
        const res = await pool.query(`
            SELECT story_id, label, category_id 
            FROM story 
            WHERE category_id = $1
            ORDER BY interest_score DESC, last_updated DESC 
            LIMIT $2
        `, [catId, limitPerCategory]);
        allStories = allStories.concat(res.rows);
    }
    
    // Shuffle or sort by interest score across all selected
    return allStories.sort((a, b) => b.interest_score - a.interest_score);
}

async function getStoryHistory(storyId, days = 5) {
    const res = await pool.query(`
        SELECT date, summary, summary_zh 
        FROM story_timeline 
        WHERE story_id = $1 
        ORDER BY date DESC 
        LIMIT $2
    `, [storyId, days]);
    return res.rows.map(row => `${row.date.toISOString().split('T')[0]}: ${(row.summary || row.summary_zh || '').substring(0, 100)}...`).join('\n');
}

/**
 * Validates references, extracts sources, and prepares grounding supports for later injection.
 * Does NOT inject [n] into the summary text anymore.
 */
function validateReferences(result, rawText, groundingMetadata) {
    if (!result.summary) return false;
    const lowerSummary = result.summary.trim().toLowerCase();
    if (lowerSummary === "no_new_developments") return true;
    
    if (!groundingMetadata || !Array.isArray(groundingMetadata.groundingChunks) || groundingMetadata.groundingChunks.length === 0) {
        console.warn(`   ⚠️ No grounding sources were found in metadata.`);
        return false; // Return false to trigger retry/fallback
    }
    
    // 1. Extract and Renumber Sources
    const rawSources = groundingMetadata.groundingChunks.map((chunk, index) => ({
        oldId: index + 1,
        publisher: chunk.web ? (chunk.web.title || "News Source") : "News Source",
        url: chunk.web ? chunk.web.uri : ""
    }));

    // Sort sources by publisher for consistent order
    rawSources.sort((a, b) => a.publisher.localeCompare(b.publisher));
    
    const idMap = new Map();
    const finalSources = rawSources.map((s, idx) => {
        const newId = idx + 1;
        idMap.set(s.oldId, newId);
        return { id: newId, publisher: s.publisher, url: s.url };
    });

    result.sources = finalSources;
    result.groundingSupports = [];

    // 2. Extract Supports and Inject Placeholders into summary
    if (groundingMetadata.groundingSupports && groundingMetadata.groundingSupports.length > 0) {
        // Find where summary is in rawText to handle index offsets
        // For zh summary, we need to find "summary_zh": or "summary":
        let summaryKey = '"summary":';
        if (rawText.includes('"summary_zh":')) {
            summaryKey = '"summary_zh":';
        } else if (rawText.includes('summary_zh')) {
            // Flexible check for cases where model might omit quotes in some weird contexts or variations
            summaryKey = 'summary_zh';
        }
        
        const summaryKeyIdx = rawText.indexOf(summaryKey);
        
        if (summaryKeyIdx !== -1) {
            const openQuoteIdx = rawText.indexOf('"', summaryKeyIdx + summaryKey.length);
            if (openQuoteIdx !== -1) {
                const offset = openQuoteIdx + 1;
                
                const supports = groundingMetadata.groundingSupports
                    .map(support => {
                        const newIds = (support.groundingChunkIndices || [])
                            .map(idx => idMap.get(idx + 1))
                            .filter(id => id);
                        return {
                            startIndex: support.segment.startIndex - offset,
                            endIndex: support.segment.endIndex - offset,
                            sourceIds: [...new Set(newIds)]
                        };
                    })
                    .filter(sup => sup.sourceIds.length > 0 && sup.startIndex >= 0);

                result.groundingSupports = supports;

                // Inject placeholders into the summary text [ref:1, 2]
                // We sort descending by endIndex to insert from back to front
                const sortedInjections = [...supports].sort((a, b) => b.endIndex - a.endIndex);
                
                // If we are in ZH mode, result.summary might be the ZH one
                let summaryWithRefs = result.summary;
                for (const sup of sortedInjections) {
                    let insertPos = sup.endIndex;
                    
                    // For English, move to end of word. For Chinese, the endIndex is usually fine as it's char-based
                    // but we'll keep a simpler check for whitespace/punctuation if needed.
                    while (insertPos < summaryWithRefs.length && /\w/.test(summaryWithRefs[insertPos])) {
                        insertPos++;
                    }
                    
                    if (insertPos <= summaryWithRefs.length) {
                        const refMarker = ` [ref:${sup.sourceIds.join(', ')}]`;
                        summaryWithRefs = summaryWithRefs.substring(0, insertPos) + refMarker + summaryWithRefs.substring(insertPos);
                    }
                }
                result.summary = summaryWithRefs;
            }
        }
    }
    
    return true;
}

async function downloadImage(url, storyId) {
    try {
        const thumbDir = path.join(__dirname, 'story-website/public/thumbnails');
        if (!fs.existsSync(thumbDir)) fs.mkdirSync(thumbDir, { recursive: true });

        // Create a unique filename based on URL hash
        const hash = crypto.createHash('md5').update(url).digest('hex');
        const ext = path.extname(new URL(url).pathname) || '.jpg';
        const filename = `${storyId}_${hash}${ext}`;
        const filePath = path.join(thumbDir, filename);

        // Skip if already exists
        if (fs.existsSync(filePath)) {
            return `thumbnails/${filename}`;
        }

        console.log(`   ⬇️ Downloading thumbnail: ${url}`);
        execSync(`curl -sL --max-time 15 -o "${filePath}" "${url}"`, { timeout: 20000 });
        
        // Basic check if file is valid (not empty)
        const stats = fs.statSync(filePath);
        if (stats.size < 100) {
            fs.unlinkSync(filePath);
            return null;
        }

        return `thumbnails/${filename}`;
    } catch (e) {
        console.warn(`   ⚠️ Download failed for ${url}: ${e.message}`);
        return null;
    }
}

async function fetchThumbnails(urls, storyId) {
    let found = [];
    for (const url of urls.slice(0, 3)) {
        try {
            console.log(`   🖼️ Grepping thumbnail from: ${url}`);
            // Use curl to fetch the page and grep for og:image
            const cmd = `curl -sL --max-time 10 "${url}" | grep -oE '<meta [^>]*property="og:image"[^>]*content="([^"]+)"' | head -1 | sed -E 's/.*content="([^"]+)".*/\\1/'`;
            const imgUrl = execSync(cmd, { timeout: 15000 }).toString().trim();
            if (imgUrl && imgUrl.startsWith('http')) {
                const localPath = await downloadImage(imgUrl, storyId);
                if (localPath) found.push(localPath);
            }
        } catch (e) {
            console.warn(`   ⚠️ Thumbnail fetch failed for ${url}: ${e.message}`);
        }
    }
    return found;
}

async function processStory(story) {
    console.log(`\n🔄 Processing story: ${story.label} (${story.story_id}) [Category: ${story.category_id}]`);
    const history = await getStoryHistory(story.story_id);
    
    const isLocal = story.category_id === 'local_news' || story.category_id === 'local_entertainment';
    
    let languageRequirement = '';
    let jsonStructure = '';
    
    if (isLocal) {
        languageRequirement = `
- **Search Instruction**: Use Google Search to find the latest specific details about this story. You can search in both English and Chinese.
- **Grounding Requirement**: You MUST include grounding references in your response. Ensure all factual claims in the summary are cited using grounding metadata.
- **Direct Language Requirement**: The story is under Hong Kong Local News/Entertainment. You MUST write the final "title_zh", "sub_title_zh", and "summary_zh" in Traditional Chinese (Hong Kong style).
- Do NOT provide English versions for the final text fields if they are local stories.`;
        jsonStructure = `
{
	"title_zh": "繁體中文標題",
	"sub_title_zh": "繁體中文子標題 (提供背景資料)",
	"summary_zh": "繁體中文詳盡文章總結 (多個段落)...",
	"status": "ongoing"
}`;
    } else {
        jsonStructure = `
{
	"title": "One line title here",
	"sub_title": "Descriptive sub-title providing context",
	"summary": "Full article with multiple paragraphs...",
	"status": "ongoing"
}`;
    }

    const prompt = `
You are generating a comprehensive daily intelligence report for a tracked News Story.

Requirements:
- Search for the latest developments related to the story within the past 24 hours.
- Base your summary on 5-10 verifiable news references.
- Produce a ONE LINE TITLE (around 10-15 words) for today's development.
- Produce a SUB-TITLE (around 20-30 words) providing context for the development.
- Produce an ARTICLE-STYLE SUMMARY with multiple paragraphs (total around 500 words).
- DO NOT include inline references like [1] or [2] in your response. I will add them myself based on the grounding metadata.${languageRequirement}
- If NO significant news or new developments are found for this specific story within the past 24 hours, return exactly:
  { "summary": "NO_NEW_DEVELOPMENTS", "status": "stable", "sources": [] }

Reply in strict JSON with the following structure:
${jsonStructure}

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
        // Use gemini-3-flash-preview for all attempts to conserve quota as requested
        const model = 'gemini-3-flash-preview';
        console.log(`   Attempt ${attempts} to fetch data with grounding metadata using ${model}...`);
        
        try {
            const response = await geminiGroundingWithMetadata(prompt, model);
            
            if (response && response.error) {
                throw new Error(`Gemini API Error: ${response.error}`);
            }

            if (!response || !response.text) {
                throw new Error("Empty response from Gemini.");
            }

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
            
            if (isLocal) {
                result = {
                    title_zh: articleData.title_zh,
                    sub_title_zh: articleData.sub_title_zh,
                    summary: articleData.summary_zh, // Map to internal 'summary' for re-processing
                    status: articleData.status || "ongoing",
                    isLocal: true,
                    sources: [], // Initial empty sources
                    groundingMetadata: response.groundingMetadata
                };
            } else {
                result = {
                    title: articleData.title,
                    sub_title: articleData.sub_title,
                    summary: articleData.summary,
                    status: articleData.status || "ongoing",
                    isLocal: false,
                    sources: [], // Initial empty sources
                    groundingMetadata: response.groundingMetadata
                };
            }

            if ((result.title || result.title_zh) && result.summary && validateReferences(result, response.text, response.groundingMetadata)) {
                if (result.sources && result.sources.length > 0) {
                    console.log(`   🔗 Resolving ${result.sources.length} news URLs...`);
                    result.sources = await resolveSources(result.sources);
                }
                break;
            } else {
                console.warn(`   ⚠️ Validation failed (invalid structure or missing grounding sources).`);
                result = null;
                // If it failed because of missing sources, attempts++ will happen and we'll retry with Pro
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
                result.thumbnails = await fetchThumbnails(urls, story.story_id);
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
        
        if (data.isLocal) {
            // Save directly to ZH columns
            await client.query(`
                INSERT INTO story_timeline (story_id, date, title_zh, sub_title_zh, summary_zh, story_status_id, thumbnails, grounding_supports, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (story_id, date) 
                DO UPDATE SET title_zh = $3, sub_title_zh = $4, summary_zh = $5, story_status_id = $6, thumbnails = $7, grounding_supports = $8, updated_at = NOW()
            `, [
                storyId, 
                today, 
                data.title_zh, 
                data.sub_title_zh, 
                data.summary, // The summary with refs injected by validateReferences
                data.status.toLowerCase(), 
                JSON.stringify(data.thumbnails || []),
                JSON.stringify(data.groundingSupports || [])
            ]);
        } else {
            // Save to standard columns
            await client.query(`
                INSERT INTO story_timeline (story_id, date, title, sub_title, summary, story_status_id, thumbnails, grounding_supports, updated_at)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                ON CONFLICT (story_id, date) 
                DO UPDATE SET title = $3, sub_title = $4, summary = $5, story_status_id = $6, thumbnails = $7, grounding_supports = $8, updated_at = NOW()
            `, [
                storyId, 
                today, 
                data.title, 
                data.sub_title, 
                data.summary, 
                data.status.toLowerCase(), 
                JSON.stringify(data.thumbnails || []),
                JSON.stringify(data.groundingSupports || [])
            ]);
        }

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
    const stories = await getTopStories(6); // 6 per category
    console.log(`📋 Processing ${stories.length} stories across categories.`);

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
