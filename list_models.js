const { GoogleGenerativeAI } = require('@google/generative-ai');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function checkModel(name) {
    try {
        console.log(`Checking ${name}...`);
        const model = genAI.getGenerativeModel({ model: name });
        const result = await model.generateContent('Hi');
        console.log(`✅ ${name} SUCCESS`);
        return true;
    } catch (e) {
        console.log(`❌ ${name} FAILED: ${e.message.split('\n')[0]}`);
        return false;
    }
}

async function main() {
    const candidates = [
        'gemini-1.5-flash',
        'gemini-1.5-flash-001',
        'gemini-1.5-flash-latest',
        'gemini-1.5-pro',
        'gemini-1.0-pro',
        'gemini-pro',
        'gemini-2.0-flash-exp'
    ];
    
    console.log('Testing models with API Key ending in:', process.env.GEMINI_API_KEY ? process.env.GEMINI_API_KEY.slice(-4) : 'NONE');

    for (const m of candidates) {
        await checkModel(m);
    }
}

main();
