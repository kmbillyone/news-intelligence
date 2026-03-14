const { Pool } = require('pg');
const { geminiCLI } = require('./modules/geminiHelper');

const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'news_intelligence',
    password: 'openclaw',
    port: 5432,
});

const TRANSLATION_MODEL = 'gemini-2.5-flash-lite';

async function translateBatch() {
    console.log(`🌐 Starting Translation Batch (Optimized using ${TRANSLATION_MODEL})...`);

    // 1. Stories Labels
    const storiesRes = await pool.query(`SELECT story_id, label FROM story WHERE label_zh IS NULL LIMIT 20`);
    if (storiesRes.rows.length > 0) {
        console.log(`📝 Translating ${storiesRes.rows.length} story labels in batch...`);
        const prompt = `Translate these story labels into Traditional Chinese (Hong Kong context). 
Reply in strict JSON array of objects.
Input: ${JSON.stringify(storiesRes.rows)}
Format: [{"story_id": "...", "label_zh": "..."}]`;
        try {
            const translated = await geminiCLI(prompt, TRANSLATION_MODEL);
            const items = Array.isArray(translated) ? translated : [];
            for (const item of items) {
                if (item.story_id && item.label_zh) {
                    await pool.query('UPDATE story SET label_zh = $1 WHERE story_id = $2', [item.label_zh, item.story_id]);
                }
            }
            console.log(`   ✅ Success: ${items.length} labels translated.`);
        } catch (e) { console.error('❌ Label translation failed:', e.message); }
    }

    // 2. Timeline Entries (Title, Sub-title, Summary)
    // We do batch translation of 5 stories at a time to balance speed and stability
    const BATCH_SIZE = 5;
    const timelineRes = await pool.query(`
        SELECT story_id, date::text as date_str, title, sub_title, summary 
        FROM story_timeline 
        WHERE (title_zh IS NULL OR sub_title_zh IS NULL OR summary_zh IS NULL) 
        AND summary != 'NO_NEW_DEVELOPMENTS'
        ORDER BY date DESC
        LIMIT 15
    `);

    if (timelineRes.rows.length > 0) {
        console.log(`📝 Found ${timelineRes.rows.length} timeline entries to translate.`);
        
        for (let i = 0; i < timelineRes.rows.length; i += BATCH_SIZE) {
            const batch = timelineRes.rows.slice(i, i + BATCH_SIZE);
            console.log(`   👉 Translating batch of ${batch.length} entries (${i + 1} to ${Math.min(i + BATCH_SIZE, timelineRes.rows.length)})...`);
            
            // Extract references per paragraph and clean up the input summary for translation
            const batchWithRefHints = batch.map(row => {
                const paragraphs = row.summary.split(/\n+/);
                const pRefs = [];
                const cleanParagraphs = paragraphs.map(p => {
                    const matches = p.match(/\[ref:[\d, ]+\]/g);
                    pRefs.push(matches ? [...new Set(matches.flatMap(m => m.match(/\d+/g)))].join(', ') : null);
                    // Remove the [ref:...] markers from the text before sending to translation
                    return p.replace(/\s*\[ref:[\d, ]+\]/g, '').trim();
                });
                return { 
                    ...row, 
                    summary_to_translate: cleanParagraphs.join('\n\n'),
                    paragraph_refs: pRefs 
                };
            });

            const prompt = `Translate these news entries into Traditional Chinese (Hong Kong context). 

Guidelines for "summary_zh":
1. Use "summary_to_translate" as the source text.
2. Preserve exactly the same number of paragraphs as the input.
3. For each translated paragraph, look at the corresponding "paragraph_refs" list. 
4. MUST append the reference marker (e.g., [ref:1, 2]) at the end of the translated paragraph if it has refs.
5. DO NOT invent new references or place them in the middle of sentences. Only append at the end of paragraphs.

Input: ${JSON.stringify(batchWithRefHints.map(({ story_id, date_str, title, sub_title, summary_to_translate, paragraph_refs }) => ({ story_id, date_str, title, sub_title, summary_to_translate, paragraph_refs })))}
Format: [{"story_id": "...", "date_str": "...", "title_zh": "...", "sub_title_zh": "...", "summary_zh": "..."}]`;

            try {
                const translated = await geminiCLI(prompt, TRANSLATION_MODEL);
                const items = Array.isArray(translated) ? translated : [];
                
                for (const item of items) {
                    if (item.story_id && item.title_zh) {
                        await pool.query(
                            'UPDATE story_timeline SET title_zh = $1, sub_title_zh = $2, summary_zh = $3 WHERE story_id = $4 AND date = $5::date',
                            [item.title_zh, item.sub_title_zh, item.summary_zh, item.story_id, item.date_str]
                        );
                        console.log(`      ✅ Updated: ${item.story_id} (${item.date_str})`);
                    }
                }
            } catch (e) { 
                console.error(`      ❌ Batch failed: ${e.message}. Will try next batch or individual fallback in next run.`); 
            }
        }
    }

    console.log('✨ Translation Batch Complete.');
}

translateBatch().then(() => pool.end()).catch(err => {
    console.error('💥 Fatal Error:', err);
    pool.end();
});
