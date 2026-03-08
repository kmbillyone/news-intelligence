const { geminiCLI } = require('./geminiHelper');

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

    console.log('🔹 Attempting Identification...');
    try {
        return await geminiCLI(clusteringPrompt);
    } catch (e) {
        console.warn(`⚠️ Identification failed: ${e.message}.`);
        throw e;
    }
}

module.exports = { runClustering };
