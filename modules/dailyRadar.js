const { geminiCLI, geminiGroundingRadarPython } = require('./geminiHelper');

async function runRadar() {
    console.log('📡 Starting Global Daily News Radar Sweep (Prompt 1)...');

    const sweepPrompt = `
You are performing a global daily news radar sweep.

Search for factual news reports published within the past 24 hours.

Your objective is to identify recent REAL-WORLD DEVELOPMENTS across the following interest areas:

1. Local News
2. International News
3. Local Entertainment
4. Technology and Science
5. Other Globally Trending Topics
   (major incidents, emerging issues, unusual developments gaining attention)

--------------------------------

INTAKE BALANCE TARGET

Try to return results in approximately:

- 10–15 Hong Kong Local News
- 8–12 International News
- 5–8 Local Entertainment
- 10–15 Technology and Science
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
        console.log('🔹 Attempt 1: Gemini CLI (gemini-3-pro-preview)...');
        reports = await geminiCLI(sweepPrompt, 'gemini-3-pro-preview');
    } catch (e) {
        console.warn(`⚠️ CLI Attempt failed: ${e.message}`);
        console.log('🔹 Attempt 2: Python Script (gemini-3-pro-preview)...');
        try {
            reports = await geminiGroundingRadarPython(sweepPrompt, 'gemini-3-pro-preview');
        } catch (innerE) {
            console.warn(`⚠️ Python (3-pro) failed: ${innerE.message}`);
            console.log('🔹 Attempt 3: Python Script (gemini-2.5-flash)...');
            try {
                reports = await geminiGroundingRadarPython(sweepPrompt, 'gemini-2.5-flash');
            } catch (finalE) {
                console.error('❌ All radar sweep attempts failed.');
                throw finalE;
            }
        }
    }
    
    return reports;
}

async function runClustering(reports, existingStories) {
    console.log('🧠 Running Story Clustering (Prompt 2)...');

    const clusteringPrompt = `
You are an intelligence analyst maintaining a persistent Story Memory of real-world developing situations.

You are given:

1. A list of EXISTING TRACKED STORIES
2. A batch of recent NEWS REPORTS from the past 24 hours

Your task is to determine whether today's reports:

- belong to an EXISTING story
OR
- represent a NEW developing situation that should become a NEW story

--------------------------------

Rules:

A report should be attached to an existing story if:

- it describes a continuation of that situation
- it reflects escalation, response, expansion or new consequences
- it is a policy, technological or organizational development related to it

Create a NEW story only if:

- no existing story adequately represents the situation
- this represents a distinct emerging development
- it is likely to evolve across multiple days

Avoid:

- duplicating existing stories under slightly different wording
- creating stories tied to a single announcement
- stories that cannot persist across time

--------------------------------

For each new story you identify, return:

    situation_label (4–7 word stable reusable label)
        category:
	    local_news
	    international_news
	    local_entertainment
	    tech_science
	    global_trending

--------------------------------

Return strict JSON only. Do NOT include any other text.

Example format:
[
    {
        "situation_label": "Escalating Security Risks in Middle East",
	    "category": "international_news"
    }
]

EXISTING TRACKED STORIES:
${JSON.stringify(existingStories)}

NEWS REPORTS:
${JSON.stringify(reports)}
`;

    console.log('🔹 Attempting Identification with gemini-3-pro-preview...');
    try {
        return await geminiCLI(clusteringPrompt, 'gemini-3-pro-preview');
    } catch (e) {
        console.warn(`⚠️ Attempt 1 failed. Retrying with gemini-3-flash-preview...`);
        return await geminiCLI(clusteringPrompt, 'gemini-3-flash-preview');
    }
}

module.exports = { runRadar, runClustering };
