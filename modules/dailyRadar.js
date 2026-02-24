const { geminiGroundingRadar, geminiCLI } = require('./geminiHelper');

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

    // Step 1: Execute Sweep with Grounding (Gemini 3 Pro)
    const reports = await geminiGroundingRadar(sweepPrompt);
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

    // Step 2: Execute Clustering (Gemini 3 Pro per user preference for complex analysis)
    const analysis = await geminiCLI(clusteringPrompt, 'gemini-3-pro-preview');
    return analysis;
}

module.exports = { runRadar, runClustering };
