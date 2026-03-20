require('dotenv').config();
const { geminiGroundingWithMetadata } = require('./modules/geminiHelper.js');

async function test() {
    const prompt = `Search for the latest news about "Hong Kong Weather" from the past 24 hours. Provide a summary.`;
    const res = await geminiGroundingWithMetadata(prompt);
    console.log("Has groundingChunks?", !!(res.groundingMetadata && res.groundingMetadata.groundingChunks));
    if (res.groundingMetadata && res.groundingMetadata.groundingChunks) {
        console.log("Chunk count:", res.groundingMetadata.groundingChunks.length);
    } else {
        console.log("Metadata:", JSON.stringify(res.groundingMetadata, null, 2));
    }
}
test();
