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
 * Executes a Gemini prompt using the CLI tool with retry logic.
 */
async function geminiCLI(prompt, requestedModel = 'gemini-3-flash-preview', maxRetries = 3, retryDelayMs = 5000) {
    const tmpFile = path.join(__dirname, `tmp_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);
    
    const actualModel = requestedModel;

    const executeWithRetry = async (attempt = 1) => {
        try {
            console.log(`   [CLI] Attempt ${attempt}/${maxRetries} with model: ${actualModel}...`);
            const output = execFileSync('gemini', [
                '-m', actualModel,
                '--output-format', 'json',
                '-p', prompt
            ], { 
                encoding: 'utf8', 
                maxBuffer: 50 * 1024 * 1024, 
                env: { ...process.env, GOOGLE_CLOUD_PROJECT: "pivotal-gearbox-486906-b0" } 
            });
            
            let rawJsonText = output.trim();
            let parsedOutput = {};
            try {
                parsedOutput = JSON.parse(rawJsonText);
            } catch (err) {
                // fallback if output isn't proper wrapper JSON
                parsedOutput.response = rawJsonText;
            }
            
            let responseText = parsedOutput.response || "";
            if (typeof responseText !== 'string') {
                responseText = JSON.stringify(responseText);
            }
            
            let sources = [];
            const parts = responseText.split('**Grounding References:**');
            let mainText = parts[0];
            
            if (parts.length > 1) {
                const refsText = parts[1].trim();
                const lines = refsText.split('\n');
                const regex = /^(\d+)\.\s+\[(.*?)\]\((.*?)\)$/;
                for (const line of lines) {
                    const match = line.trim().match(regex);
                    if (match) {
                        sources.push({ id: parseInt(match[1]), publisher: match[2].trim(), url: match[3].trim() });
                    }
                }
            }
            
            let result = extractJSON(mainText);
            
            if (sources.length > 0) {
                result.sources = sources;
            }
            
            console.log(`   ✅ [CLI] Success with ${actualModel}. Grounding sources found: ${sources.length}`);
            return result;
        } catch (e) {
            console.error(`   ❌ Attempt ${attempt} failed: ${e.message.split('\n')[0]}`);
            
            if (attempt < maxRetries) {
                console.log(`   ⏳ Retrying in ${retryDelayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                return await executeWithRetry(attempt + 1);
            }
            
            console.log(`   ⚠️ [CLI] All ${maxRetries} attempts failed. Falling back to Python...`);
            return await geminiGroundingRadarPython(prompt, actualModel);
        }
    };

    try {
        return await executeWithRetry();
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

/**
 * Searches Google using the existing grounding-enabled script with retry logic.
 */
async function geminiGroundingRadarPython(prompt, requestedModel = null, maxRetries = 3, retryDelayMs = 10000) {
    const gsearchScript = path.resolve(__dirname, '../../../scripts/gsearch');
    const tmpFile = path.join(__dirname, `tmp_radar_prompt_${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, prompt);

    const actualModel = 'gemini-3-flash-preview';

    const executeWithRetry = async (attempt = 1) => {
        try {
            console.log(`   (Calling Python gsearch attempt ${attempt}/${maxRetries} using ${actualModel}...)`);
            const env = { ...process.env, GEMINI_MODEL: actualModel };
            const cmd = `"${gsearchScript}" "$(cat ${tmpFile})"`;
            const output = execSync(cmd, { encoding: 'utf8', maxBuffer: 50 * 1024 * 1024, env });
            
            let cleanOutput = output;
            if (output.includes('---')) {
                const parts = output.split('---');
                cleanOutput = parts[parts.length - 1].trim();
            }

            const result = extractJSON(cleanOutput);
            console.log(`   ✅ [Python] Success with ${actualModel}`);
            return result;
        } catch (e) {
            console.error(`   ❌ Python attempt ${attempt} failed: ${e.message.split('\n')[0]}`);
            
            if (attempt < maxRetries) {
                console.log(`   ⏳ Retrying in ${retryDelayMs / 1000}s...`);
                await new Promise(resolve => setTimeout(resolve, retryDelayMs));
                return await executeWithRetry(attempt + 1);
            }
            
            throw e;
        }
    };

    try {
        return await executeWithRetry();
    } finally {
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    }
}

async function geminiGroundingWithMetadata(prompt, requestedModel = 'gemini-3-flash-preview') {
    const pythonScript = path.resolve(__dirname, '../../../skills/google-web-search/scripts/grounding_metadata.py');
    // Ensure the python script exists
    if (!fs.existsSync(pythonScript)) {
        const scriptContent = `#!/usr/bin/env python3
import os
import sys
import json
from google import genai
from google.genai import types

def get_grounded_response_with_metadata(prompt, model):
    api_key = os.environ.get("GEMINI_API_KEY")
    client = genai.Client(api_key=api_key)
    
    grounding_tool = types.Tool(google_search=types.GoogleSearch())
    config = types.GenerateContentConfig(tools=[grounding_tool])
    
    response = client.models.generate_content(
        model=model,
        contents=prompt,
        config=config,
    )
    
    result = {
        "text": response.text,
        "groundingMetadata": None
    }
    
    if response.candidates and response.candidates[0].grounding_metadata:
        gm = response.candidates[0].grounding_metadata
        metadata = {
            "searchEntryPoint": gm.search_entry_point.rendered_content if gm.search_entry_point else None,
            "groundingChunks": [],
            "groundingSupports": []
        }
        
        if gm.grounding_chunks:
            for chunk in gm.grounding_chunks:
                if chunk.web:
                    metadata["groundingChunks"].append({
                        "web": {
                            "uri": chunk.web.uri,
                            "title": chunk.web.title
                        }
                    })
        
        if gm.grounding_supports:
            for support in gm.grounding_supports:
                metadata["groundingSupports"].append({
                    "segment": {
                        "startIndex": support.segment.start_index,
                        "endIndex": support.segment.end_index,
                        "text": support.segment.text
                    },
                    "groundingChunkIndices": support.grounding_chunk_indices,
                    "confidenceScores": support.confidence_scores
                })
        
        result["groundingMetadata"] = metadata
        
    return result

if __name__ == "__main__":
    prompt = sys.argv[1]
    model = os.environ.get("GEMINI_MODEL", "gemini-3-flash-preview")
    try:
        res = get_grounded_response_with_metadata(prompt, model)
        print(json.dumps(res))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
`;
        fs.writeFileSync(pythonScript, scriptContent, { mode: 0o755 });
    }

    try {
        const venvPython = path.resolve(__dirname, '../../../skills/google-web-search/.venv/bin/python');
        const pythonExecutable = fs.existsSync(venvPython) ? venvPython : 'python3';
        const output = execFileSync(pythonExecutable, [pythonScript, prompt], {
            encoding: 'utf8',
            maxBuffer: 50 * 1024 * 1024,
            env: { ...process.env, GEMINI_MODEL: requestedModel }
        });
        return JSON.parse(output.trim());
    } catch (e) {
        console.error(`   ❌ Grounding with metadata failed: ${e.message}`);
        throw e;
    }
}

module.exports = { geminiCLI, geminiGroundingRadarPython, geminiGroundingWithMetadata };
