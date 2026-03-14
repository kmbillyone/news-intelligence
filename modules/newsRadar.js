const { geminiCLI, geminiGroundingRadarPython } = require('./geminiHelper');

async function runRadar() {
    console.log('📡 Starting Global Daily News Radar Sweep (Prompt 1)...');

    const sweepPrompt = `
You are performing a global daily news radar sweep.

Search for factual news reports published within the past 24 hours.

Your objective is to identify recent REAL-WORLD DEVELOPMENTS across the following interest areas. 

--------------------------------

INTAKE BALANCE TARGET

Try to return results in approximately:

- 15–20 Hong Kong Local News
- 10–12 International News
- 8–10 Hong Kong Local Entertainment (Include but don't limit to: collar, candy@collar)
- 10–15 Technology and Science (Include but don't limit to: 粵語/廣東話 TTS, AI models, web development, openclaw)
- 5–10 Other Trending Topics

Avoid overrepresentation of:
- consumer gadget rumors
- minor app or feature announcements
- celebrity personal gossip without wider impact

--------------------------------

PRIORITIZE:

- developments that may evolve across multiple days
- leadership or policy changes
- industry-level shifts
- public safety or environmental risks
- infrastructure disruptions
- scientific or engineering breakthroughs
- notable entertainment industry developments

--------------------------------

DEPRIORITIZE:

- opinion columns
- listicles
- promotional content
- repetitive product leaks
- viral social media topics without formal reporting

--------------------------------

For Hong Kong Local News and Entertainment, you may refer to the sources including:
- HK01
- Commercial Radio (881903.com)
- Now News (Now 新聞)
- Ming Pao (明報)
- Sing Tao (星島)
- South China Morning Post (SCMP)
- RTHK

--------------------------------

For each result return:

- title
- category:
    local_news
    international_news
    local_entertainment
    tech_science
    global_trending
-  description: 1-line factual description of what happened

Return 40–60 results if available.

Return strict JSON only. Do NOT include any other text.

Example format:
[
    {
	"title": "example title 1",
	"category": "local_news",
	"description": "description 1"
    },
    {
	"title": "example title 2",
	"category": "international_news",
	"description": "description 2"
    }
]
`;

    let reports;
    try {
        console.log('🔹 Attempting Radar Sweep...');
        reports = await geminiCLI(sweepPrompt);
    } catch (e) {
        console.warn(`⚠️ CLI Attempt failed: ${e.message}`);
        console.log('🔹 Attempt 2: Python Script...');
        try {
            reports = await geminiGroundingRadarPython(sweepPrompt);
        } catch (innerE) {
            console.error('❌ All radar sweep attempts failed.');
            throw innerE;
        }
    }
    
    return reports;
}

module.exports = { runRadar };
