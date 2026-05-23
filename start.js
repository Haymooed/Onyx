const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_URL = "https://github.com/Haymooed/Onyx";
const WORK_DIR = '/home/container';

function run(command, { optional = false, silent = false } = {}) {
    try {
        if (!silent) console.log(`> ${command}`);
        execSync(command, { stdio: silent ? 'pipe' : 'inherit', cwd: WORK_DIR, shell: true });
        return true;
    } catch (error) {
        if (!silent) console.error(`Failed: ${command}`);
        if (!optional) process.exit(1);
        return false;
    }
}

// Pull latest code (node_modules is bundled in the repo — no npm install needed)
if (!fs.existsSync(path.join(WORK_DIR, '.git'))) {
    console.log("Initial setup: Cloning repository...");
    run(`git init`);
    run(`git remote add origin ${REPO_URL}`);
    run(`git fetch --depth=1 origin main`);
    run(`git reset --hard origin/main`);
} else {
    console.log("Checking for updates...");
    run(`git fetch --depth=1 origin main`, { silent: true });
    const local = execSync('git rev-parse HEAD', { cwd: WORK_DIR }).toString().trim();
    const remote = execSync('git rev-parse FETCH_HEAD', { cwd: WORK_DIR }).toString().trim();
    if (local !== remote) {
        console.log("Updates found! Applying...");
        run(`git reset --hard origin/main`);
    } else {
        console.log("Already up to date.");
    }
}

// Start the server
console.log("Starting the server...");
run(`node server.js`);
