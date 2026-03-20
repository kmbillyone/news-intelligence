require('dotenv').config();
const { geminiGroundingWithMetadata } = require('./modules/geminiHelper.js');

async function test() {
    const prompt = `
You are generating a comprehensive daily intelligence report for a tracked News Story.

Requirements:
- Search for the latest developments related to the story within the past 24 hours.
- Base your summary on 5-10 verifiable news references.
- Produce a ONE LINE TITLE (around 10-15 words) for today's development.
- Produce a SUB-TITLE (around 20-30 words) providing context for the development.
- Produce an ARTICLE-STYLE SUMMARY with multiple paragraphs (total around 500 words).
- DO NOT include inline references like [1] or [2] in your response. I will add them myself based on the grounding metadata.
- If NO significant news or new developments are found for this specific story within the past 24 hours, return exactly:
  { "summary": "NO_NEW_DEVELOPMENTS", "status": "stable", "sources": [] }

Reply in strict JSON with the following structure:

{
	"title": "English Title",
	"sub_title": "English Sub Title",
	"summary": "English Summary...",
	"status": "ongoing"
}

TARGET STORY:
	name: Hong Kong Waste Charging Scheme
	history snippet:
		No previous history found.
`;
    const res = await geminiGroundingWithMetadata(prompt);
    console.log("Has groundingChunks?", !!(res.groundingMetadata && res.groundingMetadata.groundingChunks));
    if (res.groundingMetadata && res.groundingMetadata.groundingChunks) {
        console.log("Chunk count:", res.groundingMetadata.groundingChunks.length);
    } else {
        console.log("Metadata:", JSON.stringify(res.groundingMetadata, null, 2));
    }
}
test();
