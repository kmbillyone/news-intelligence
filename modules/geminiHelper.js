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
        
        const rawParsed = JSON.parse(output.trim());
        let result = rawParsed;
        
        // If it's an envelope, extract the response
        if (rawParsed.response && typeof rawParsed.response === 'string') {
            let jsonStr = rawParsed.response.trim();
            // Remove markdown blocks if present
            jsonStr = jsonStr.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
            try {
                result = JSON.parse(jsonStr);
            } catch (e) {
                console.warn(`⚠️ Failed to parse inner response as JSON. Using raw string.`);
                result = rawParsed.response;
            }
        } else if (typeof rawParsed === 'string') {
             // Sometimes it might return just the string? Unlikely with --output-format json
             try {
                result = JSON.parse(rawParsed);
             } catch(e) {}
        }
        
        return result;
    } catch (e) {
        console.error(`❌ geminiCLI failed: ${e.message}`);
        throw e;
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

/**
 * Searches Google using the existing grounding-enabled script.
 */
async function geminiGroundingRadarPython(prompt, model = null) {
    const gsearchScript = path.resolve(__dirname, '../../../scripts/gsearch');
    const tmpFile = path.join(__dirname, `tmp_radar_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);

    try {
        console.log(`   (Calling Python gsearch for radar sweep using ${model || 'default'}...)`);
        const env = { ...process.env };
        if (model) env.GEMINI_MODEL = model;

        const cmd = `"${gsearchScript}" "$(cat ${tmpFile})"`;
        const output = execSync(cmd, { 
            encoding: 'utf8', 
            maxBuffer: 50 * 1024 * 1024,
            env: env 
        });
        
        let jsonStr = output.trim();
        
        // Try to find markdown block first
        const markdownMatch = jsonStr.match(/```json\s*([\s\S]*?)\s*```/);
        
        if (markdownMatch) {
            jsonStr = markdownMatch[1].trim();
        } else {
            // Fallback: try to find the largest JSON object/array
            const firstBrace = jsonStr.indexOf('{');
            const firstBracket = jsonStr.indexOf('[');
            
            if (firstBrace === -1 && firstBracket === -1) {
                throw new Error("No JSON structure found in output.");
            }
            
            let startIdx = -1;
            let endChar = '';
            
            if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
                startIdx = firstBrace;
                endChar = '}';
            } else {
                startIdx = firstBracket;
                endChar = ']';
            }
            
            // Find the last occurrence of the closing character
            const lastIdx = jsonStr.lastIndexOf(endChar);
            
            if (lastIdx === -1 || lastIdx < startIdx) {
                throw new Error("Malformed JSON structure (unclosed).");
            }
            
            jsonStr = jsonStr.substring(startIdx, lastIdx + 1);
        }
        
        // Try to parse the extracted string
        let parsed;
        try {
            parsed = JSON.parse(jsonStr);
        } catch (e) {
            // If it failed with "Unexpected non-whitespace character after JSON at position X",
            // it means we have valid JSON followed by garbage. Let's try to slice it.
            const match = e.message.match(/position (\d+)/);
            if (match) {
                const pos = parseInt(match[1]);
                // Try to parse up to that position
                try {
                    const truncated = jsonStr.substring(0, pos);
                    parsed = JSON.parse(truncated);
                    // If successful, we are good!
                    jsonStr = truncated;
                } catch (e2) {
                    throw e; // Original error was more useful
                }
            } else {
                throw e;
            }
        }
        
        if (parsed.error || parsed.status === 'error') {
            throw new Error(parsed.error?.message || parsed.error || "Upstream API Error");
        }
        return parsed;
    } catch (e) {
        console.error(`❌ geminiGroundingRadarPython failed: ${e.message}`);
        throw e;
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

module.exports = { geminiCLI, geminiGroundingRadarPython };
