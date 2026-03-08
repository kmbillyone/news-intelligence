const axios = require('axios');

async function resolveUrl(url) {
    try {
        const response = await axios.head(url, {
            maxRedirects: 5,
            timeout: 5000,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
            }
        });
        return response.request.res.responseUrl || url;
    } catch (error) {
        // If HEAD fails, try GET but only for headers
        try {
            const response = await axios.get(url, {
                maxRedirects: 5,
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                }
            });
            return response.request.res.responseUrl || url;
        } catch (e) {
            return url;
        }
    }
}

async function resolveSources(sources) {
    const resolved = [];
    for (const source of sources) {
        if (source.url && source.url.includes('grounding-api-redirect')) {
            console.log(`      🔗 Resolving: ${source.url.substring(0, 50)}...`);
            const realUrl = await resolveUrl(source.url);
            resolved.push({ ...source, url: realUrl });
        } else {
            resolved.push(source);
        }
    }
    return resolved;
}

module.exports = { resolveSources };
