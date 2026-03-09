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
            
            const prompt = `Translate these news entries into Traditional Chinese (Hong Kong context). 
- Keep inline reference markers like [ref:1] or [ref:1, 2] EXACTLY as they are and place them at the end of the corresponding translated sentences.
- Ensure "summary_zh" preserves paragraph breaks.
- Reply in strict JSON array of objects.

Input: ${JSON.stringify(batch)}
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
