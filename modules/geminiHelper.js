const fs = require('fs');
const { execSync, execFileSync } = require('child_process');
const path = require('path');

function extractJSON(text) {
    if (!text) throw new Error("Empty text provided for JSON extraction");
    
    // 1. Try markdown first
    const mdMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (mdMatch) {
        try { return JSON.parse(mdMatch[1].trim()); } catch (e) {}
    }
    
    // 2. Try parsing the whole thing
    try { return JSON.parse(text.trim()); } catch (e) {}
    
    // 3. Try finding the first { and last }
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try { return JSON.parse(text.substring(firstBrace, lastBrace + 1)); } catch (e) {}
    }

    // 4. Try finding the first [ and last ]
    const firstBracket = text.indexOf('[');
    const lastBracket = text.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        try { return JSON.parse(text.substring(firstBracket, lastBracket + 1)); } catch (e) {}
    }

    throw new Error("Could not extract valid JSON from response.");
}

/**
 * Executes a Gemini prompt using the CLI tool.
 */
async function geminiCLI(prompt, requestedModel = 'gemini-3-flash-preview') {
    const tmpFile = path.join(__dirname, `tmp_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);
    
    const actualModel = requestedModel;

    try {
        console.log(`   [CLI] Attempting with model: ${actualModel}...`);
        try {
            const output = execFileSync('gemini', [
                '-m', actualModel,
                '-p', prompt
            ], { 
                encoding: 'utf8', 
                maxBuffer: 50 * 1024 * 1024, 
                env: { ...process.env, GOOGLE_CLOUD_PROJECT: "pivotal-gearbox-486906-b0" } 
            });
            
            let rawJson = output.trim();
            let result = extractJSON(rawJson);
            
            // Handle envelope if it exists
            if (result && result.response && typeof result.response === 'string') {
                try {
                    result = extractJSON(result.response);
                } catch (e) {
                    result = result.response;
                }
            } else if (result && result.response) {
                result = result.response;
            }
            
            console.log(`   ✅ [CLI] Success with ${actualModel}`);
            return result;
        } catch (e) {
            console.error(`❌ geminiCLI failed: ${e.message.split('\n')[0]}. Falling back to Python...`);
            return await geminiGroundingRadarPython(prompt, actualModel);
        }
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

/**
 * Searches Google using the existing grounding-enabled script.
 * Updated: Only uses gemini-3-flash-preview as per user request.
 */
async function geminiGroundingRadarPython(prompt, requestedModel = null) {
    const gsearchScript = path.resolve(__dirname, '../../../scripts/gsearch');
    const tmpFile = path.join(__dirname, `tmp_radar_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);

    const actualModel = 'gemini-3-flash-preview';

    const tryPython = async (targetModel) => {
        console.log(`   (Calling Python gsearch using ${targetModel}...)`);
        const env = { ...process.env, GEMINI_MODEL: targetModel };
        const cmd = `"${gsearchScript}" "$(cat ${tmpFile})"`;
        const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env });
        
        let cleanOutput = output;
        if (output.includes('---')) {
            const parts = output.split('---');
            cleanOutput = parts[parts.length - 1].trim();
        }

        return extractJSON(cleanOutput);
    };

    try {
        const result = await tryPython(actualModel);
        console.log(`   ✅ [Python] Success with ${actualModel}`);
        return result;
    } catch (e) {
        console.error(`❌ geminiGroundingRadarPython failed with ${actualModel}: ${e.message.split('\n')[0]}`);
        throw e;
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

module.exports = { geminiCLI, geminiGroundingRadarPython };
