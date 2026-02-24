const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

/**
 * Executes a Gemini prompt using the CLI tool.
 * Supports model override and JSON formatting.
 */
async function geminiCLI(prompt, model = 'gemini-3-pro-preview') {
    const tmpFile = path.join(__dirname, `tmp_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);
    
    try {
        const cmd = `gemini -m "${model}" -p "$(cat ${tmpFile})" --output-format json`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        
        let jsonStr = output.trim();
        // Remove markdown blocks if CLI returns them despite --output-format json
        jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        
        return JSON.parse(jsonStr);
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

/**
 * Searches Google using the existing grounding-enabled script.
 * Since the user wants to use a specific prompt with grounding,
 * we can either:
 * 1. Use the search_json.py script (which handles the grounding internally).
 * 2. Or if 'gemini' CLI supports grounding, use that. 
 * Based on MEMORY.md, 'scripts/gsearch' or 'search_json.py' is the preferred way for grounding.
 * However, the prompt provided is for a Gemini Sweep with grounding.
 */
async function geminiGroundingRadar(prompt) {
    // We use the search_json.py script which is already configured for search grounding.
    // To pass the custom complex prompt, we need a way to send it to the grounding model.
    // The search_json.py typically takes a simple query.
    // For a complex sweep, we might need to use the 'gemini' CLI if it supports grounding,
    // or a custom script that calls the generative-ai library with grounding enabled.
    
    // Check if gsearch supports the full prompt
    const gsearchScript = path.resolve(__dirname, '../../../scripts/gsearch');
    const tmpFile = path.join(__dirname, `tmp_radar_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);

    try {
        // gsearch typically takes a query. If we pass the whole prompt, 
        // the grounding engine will use it as the search context.
        const cmd = `"${gsearchScript}" "$(cat ${tmpFile})"`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 });
        
        let jsonStr = output.trim();
        // Extract JSON from potential logging
        const jsonMatch = jsonStr.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }
        
        return JSON.parse(jsonStr);
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

module.exports = { geminiCLI, geminiGroundingRadar };
