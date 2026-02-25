const { geminiCLI, geminiGroundingRadarPython } = require('./geminiHelper');

async function runRadar() {
    console.log('📡 Starting Global Daily News Radar Sweep (with Grounding)...');

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
- url
- publication
- published_time (if available)
- category:
    local_news
    international_news
    local_entertainment
    tech_science
    global_trending
- 1-line factual description of what happened

Return 40–60 results if available.

Return JSON only.
`;

    // Strategy:
    // 1. Try Gemini CLI with gemini-3-pro-preview (User confirms it has grounding)
    // 2. If fail, fallback to Python script with gemini-3-pro-preview
    // 3. If fail, fallback to Python script with gemini-2.5-flash

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
    
    if (!reports) {
        throw new Error("Failed to retrieve radar reports (null/undefined) after all attempts.");
    }

    console.log("DEBUG: Raw reports type:", typeof reports);
    if (typeof reports === 'string') {
        try {
            reports = JSON.parse(reports);
        } catch (e) {
            console.log("DEBUG: Could not parse string as JSON directly.");
        }
    }

    // Normalize: If model returned { results: [...] } instead of [...]
    if (!Array.isArray(reports)) {
        console.log("DEBUG: Normalizing reports object. Keys:", Object.keys(reports));
        if (reports.response && typeof reports.response === 'string') {
             // Maybe the 'response' field contains the JSON?
             try {
                 const inner = JSON.parse(reports.response.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim());
                 reports = inner;
             } catch (e) {
                 console.log("DEBUG: reports.response is not JSON.");
             }
        }
        
        if (!Array.isArray(reports)) {
            if (reports.results && Array.isArray(reports.results)) reports = reports.results;
            else if (reports.data && Array.isArray(reports.data)) reports = reports.data;
            else if (reports.items && Array.isArray(reports.items)) reports = reports.items;
            else if (reports.news && Array.isArray(reports.news)) reports = reports.news;
            else {
                // Last resort: try to find any array property
                const keys = Object.keys(reports);
                for (const k of keys) {
                    if (Array.isArray(reports[k])) {
                        reports = reports[k];
                        break;
                    }
                }
            }
        }
    }

    if (!Array.isArray(reports) || reports.length === 0) {
        throw new Error("Radar response is not a valid array of reports.");
    }

    console.log(`✅ Radar sweep found ${reports.length} reports.`);
    return reports;
}

async function runClustering(reports, existingTopics) {
    console.log('🧠 Running Topic Clustering & Intelligence Analysis (without Grounding)...');

    const clusteringPrompt = `
You are an intelligence analyst maintaining a persistent Topic Memory of real-world developing situations.

You are given:

1. A list of EXISTING TRACKED TOPICS
2. A batch of recent news reports from the past 24 hours

Your task is to determine whether today's reports:

- belong to an EXISTING topic
OR
- represent a NEW developing situation that should become a NEW topic

--------------------------------

Rules:

A report should be attached to an existing topic if:

- it describes a continuation of that situation
- it reflects escalation, response, expansion or new consequences
- it is a policy, technological or organizational development related to it

Create a NEW topic only if:

- no existing topic adequately represents the situation
- this represents a distinct emerging development
- it is likely to evolve across multiple days

Avoid:

- duplicating existing topics under slightly different wording
- creating topics tied to a single announcement
- topics that cannot persist across time

--------------------------------

For each situation you identify, return:

- topic_action:
    attach_existing
    create_new

If attach_existing:

    topic_id

If create_new:

    situation_label
    (4–7 word stable reusable label)

Also include:

- novelty:
    new
    ongoing
    escalating

- scope:
    local
    international

- category:
    local_news
    international_news
    local_entertainment
    tech_science
    global_trending

- signal_strength:
    strong
    medium
    weak

- supporting_reports:
    list of report indexes (0-based index from the input reports list)

--------------------------------

Return JSON only.

EXISTING TOPICS:
${JSON.stringify(existingTopics.map(t => ({ topic_id: t.topic_id, label: t.label, category: t.category })))}

Reports:
${reports.map((r, i) => `${i}. ${r.title} (${r.category}): ${r.description}`).join('\n')}
`;

    // Step 2: Execute Clustering (Gemini 3 Pro CLI)
    console.log('🔹 Attempting Clustering with gemini-3-pro-preview (with retry)...');
    try {
        const analysis = await geminiCLI(clusteringPrompt, 'gemini-3-pro-preview');
        return analysis;
    } catch (e) {
        console.warn(`⚠️ Clustering attempt 1 failed: ${e.message}. Retrying in 5s...`);
        try {
            // Wait 5 seconds
            await new Promise(resolve => setTimeout(resolve, 5000));
            // Try with flash as fallback if pro fails repeatedly
            console.log('🔹 Fallback: Attempting Clustering with gemini-3-flash-preview...');
            const analysis = await geminiCLI(clusteringPrompt, 'gemini-3-flash-preview');
            return analysis;
        } catch (innerE) {
            console.error("❌ All clustering attempts failed.");
            throw innerE;
        }
    }
}

module.exports = { runRadar, runClustering };
