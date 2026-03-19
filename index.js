const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const newsRadar = require('./modules/newsRadar');
const clustering = require('./modules/clustering');
const db = require('./modules/db');

const STATE_FILE = path.join(__dirname, 'data/pipeline_state.json');
const LOG_DIR = path.join(__dirname, 'logs');
const RAW_DIR = path.join(__dirname, 'data/raw_articles');
const SKIP_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(RAW_DIR)) fs.mkdirSync(RAW_DIR, { recursive: true });

function log(message) {
    const timestamp = new Date().toISOString();
    const formattedMessage = `[${timestamp}] ${message}`;
    console.log(formattedMessage);
    const dateStr = new Date().toISOString().split('T')[0];
    const logFile = path.join(LOG_DIR, `pipeline_${dateStr}.log`);
    fs.appendFileSync(logFile, formattedMessage + '\n');
}

function getPipelineState() {
    if (!fs.existsSync(STATE_FILE)) return {};
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch (e) {
        return {};
    }
}

function savePipelineState(state) {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function shouldSkip(stage, state) {
    if (!state[stage]) return false;
    const lastRun = new Date(state[stage]);
    const now = new Date();
    return (now - lastRun) < SKIP_THRESHOLD_MS;
}

async function runStage(name, stageFn) {
    const state = getPipelineState();
    if (shouldSkip(name, state)) {
        log(`⏭️ Skipping stage: ${name} (run within last 4 hours)`);
        return true;
    }

    log(`🚀 Starting stage: ${name}`);
    try {
        const result = await stageFn();
        state[name] = new Date().toISOString();
        savePipelineState(state);
        log(`✅ Completed stage: ${name}`);
        return result;
    } catch (e) {
        log(`❌ Stage failed: ${name} - ${e.message}`);
        // If it's an exec error, log the output if available
        if (e.stdout) log(`   Stdout: ${e.stdout.toString()}`);
        if (e.stderr) log(`   Stderr: ${e.stderr.toString()}`);
        return false;
    }
}

async function main() {
    log('🕵️‍♀️ Little Miss AI: Starting Integrated News Pipeline...');

    // Stage 0: Calculate Scores
    await runStage('calculate_scores', async () => {
        log('   Running calculate_scores.js...');
        const output = execSync('node calculate_scores.js', { cwd: __dirname }).toString();
        log(output);
    });

    let reports = [];

    // Stage 1: News Radar
    const radarSuccess = await runStage('news_radar', async () => {
        reports = await newsRadar.runRadar();
        if (!reports || reports.length === 0) throw new Error('No reports found');
        const dateStr = new Date().toISOString().split('T')[0];
        const rawFile = path.join(RAW_DIR, `${dateStr}.json`);
        fs.writeFileSync(rawFile, JSON.stringify(reports, null, 2));
        log(`   Raw reports saved to ${rawFile}`);
        return true;
    });

    if (!radarSuccess) return;

    // Stage 2: Clustering
    await runStage('clustering', async () => {
        // If radar was skipped, we need to load reports from today's file
        if (reports.length === 0) {
            const dateStr = new Date().toISOString().split('T')[0];
            const rawFile = path.join(RAW_DIR, `${dateStr}.json`);
            if (fs.existsSync(rawFile)) {
                reports = JSON.parse(fs.readFileSync(rawFile, 'utf8'));
            } else {
                throw new Error('No radar reports found for today to run clustering');
            }
        }

        const existingStories = await db.getActiveStories();
        const newStoriesFound = await clustering.runClustering(reports, existingStories);
        if (newStoriesFound && newStoriesFound.length > 0) {
            log(`   Inserting ${newStoriesFound.length} new stories into DB...`);
            await db.insertNewStories(newStoriesFound);
        } else {
            log('   No new stories identified.');
        }
    });

    // Stage 3: Consolidate
    await runStage('consolidate', async () => {
        log('   Running consolidate.js...');
        // Using spawn to stream logs in real-time
        const { spawn } = require('child_process');
        return new Promise((resolve, reject) => {
            const proc = spawn('node', ['consolidate.js'], { cwd: __dirname });
            
            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) log(`   [consolidate] ${line.trim()}`);
                });
            });

            proc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) log(`   [consolidate-error] ${line.trim()}`);
                });
            });

            proc.on('close', (code) => {
                if (code === 0) {
                    resolve(true);
                } else {
                    reject(new Error(`consolidate.js exited with code ${code}`));
                }
            });
            
            proc.on('error', (err) => {
                reject(err);
            });
        });
    });

    // Stage 4: Translate
    await runStage('translate', async () => {
        log('   Running translate.js...');
        const { spawn } = require('child_process');
        return new Promise((resolve, reject) => {
            const proc = spawn('node', ['translate.js'], { cwd: __dirname });
            proc.stdout.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) log(`   [translate] ${line.trim()}`);
                });
            });
            proc.stderr.on('data', (data) => {
                const lines = data.toString().split('\n');
                lines.forEach(line => {
                    if (line.trim()) log(`   [translate-error] ${line.trim()}`);
                });
            });
            proc.on('close', (code) => {
                if (code === 0) resolve(true);
                else reject(new Error(`translate.js exited with code ${code}`));
            });
            proc.on('error', (err) => reject(err));
        });
    });

    // Stage 5: Build and Deploy (Always run if any previous stage ran or manually requested)
    // For build and deploy, we might want a shorter skip time or just always run it if the user calls index.js?
    // User asked to skip if run within 4 hours for ALL stages.
    await runStage('build_deploy', async () => {
        log('   Running Website Rendering...');
        const renderOut = execSync('node ../website-rendering/index.js', { cwd: __dirname }).toString();
        log(renderOut);

        log('   Building Story Website...');
        const buildOut = execSync('node story-website/build.js', { cwd: __dirname }).toString();
        log(buildOut);

        log('   Syncing to AWS...');
        const syncOut = execSync('bash ../../scripts/sync-aws.sh', { cwd: __dirname }).toString();
        log(syncOut);
    });
    
    // Stage 6: Verification
    await runStage('verify_deployment', async () => {
        log('   Verifying deployment with curl...');
        try {
            const curlOut = execSync('curl -s https://news.waie.space/story/data.json | grep generatedAt', { cwd: __dirname }).toString();
            log(`   Verification successful. Found: ${curlOut.trim()}`);
        } catch (e) {
            log(`   Verification failed or generatedAt not found: ${e.message}`);
        }
    });

    log('🎉 Integrated News Pipeline Complete.');
}

main().catch(err => {
    log(`💥 Pipeline Fatal Error: ${err.message}`);
    process.exit(1);
});
