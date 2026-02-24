const { GoogleGenerativeAI } = require('@google/generative-ai');
const { execSync } = require('child_process');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

// Configuration
const SEARCH_SCRIPT = path.resolve(__dirname, '../../../skills/google-web-search/scripts/search_json.py');
const PYTHON_BIN = path.resolve(__dirname, '../../../skills/google-web-search/.venv/bin/python'); // Assuming venv exists from skill
const GEMINI_MODEL = 'gemini-2.5-flash'; // Fast model for clustering

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

function searchGoogle(query) {
    try {
        console.log(`📡 Radar Scanning: "${query}"...`);
        // Fallback to system python if venv not found, but try specific first
        const python = require('fs').existsSync(PYTHON_BIN) ? PYTHON_BIN : 'python3';
        const cmd = `"${python}" "${SEARCH_SCRIPT}" "${query}"`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }); // 10MB buffer
        
        // Parse JSON output from script
        // The script output might contain logs, so we look for the JSON array
        const jsonStart = output.indexOf('[');
        const jsonEnd = output.lastIndexOf(']') + 1;
        if (jsonStart === -1 || jsonEnd === 0) return [];
        
        return JSON.parse(output.substring(jsonStart, jsonEnd));
    } catch (e) {
        console.error(`❌ Search failed for "${query}":`, e.message);
        return [];
    }
}

async function clusterArticles(articles) {
    if (!articles || articles.length === 0) return [];

    console.log(`🧠 Gemini Clustering ${articles.length} articles...`);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
    You are a Senior Strategic Intelligence Analyst.
    Input: A list of raw news articles (JSON).
    Task: Synthesize these individual reports into broader "Evolving Real-World Situations".

    CRITICAL INSTRUCTION:
    Do NOT simply list headlines as topics.
    You must abstract individual reports into broader, ongoing situational contexts.
    
    Strategy:
    1. **Identify the Core Situation**: Ask "What bigger story is this headline a part of?"
    2. **Group Signals**: Combine related rumors, announcements, and reactions into a single Topic.
    3. **Analyst Naming**: Name the topic like a dossier file (e.g., "Microsoft Leadership Transition"), not a newspaper headline.

    Examples:
    - Input: "Apple rumors suggest multi-day March event" + "Apple supply chain spikes"
    - BAD Topic: "Apple Rumored Multi-Day Product Launch"
    - GOOD Topic: "Apple Spring 2026 Product Strategy & Event Planning"

    - Input: "Phil Spencer resigns" + "Xbox revenue drops"
    - BAD Topic: "Phil Spencer Resigns from Microsoft"
    - GOOD Topic: "Microsoft Gaming Leadership Restructuring & Strategy Shift"

    Output Schema (JSON):
    [
      {
        "label": "The Broader Situation Name (Max 10 words)",
        "category": "local" | "international" | "tech" | "business",
        "initial_summary": "A high-level situational summary synthesizing the signals.",
        "related_links": ["url1", "url2", "url3"] // Include ALL URLs from the grouped articles
      }
    ]

    Articles to Process:
    ${JSON.stringify(articles.map(a => ({ title: a.title, snippet: a.description, link: a.link, source: a.source })))}
    `;

    try {
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        
        // Clean markdown code blocks if present
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("❌ Clustering failed:", e);
        return [];
    }
}

module.exports = {
    async runRadar(queries) {
        let allArticles = [];
        for (const q of queries) {
            const results = searchGoogle(q);
            allArticles = allArticles.concat(results);
        }
        
        // Deduplicate by link
        allArticles = Array.from(new Map(allArticles.map(item => [item.link, item])).values());
        
        const topics = await clusterArticles(allArticles);
        return { topics, rawArticles: allArticles };
    }
};
