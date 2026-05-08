const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REPO_URL = "https://github.com/Haymooed/Onyx";
const WORK_DIR = '/home/container';

function run(command, { optional = false, silent = false } = {}) {
    try {
        if (!silent) console.log(`> ${command}`);
        execSync(command, { stdio: silent ? 'pipe' : 'inherit', cwd: WORK_DIR });
        return true;
    } catch (error) {
        if (!silent) console.error(`Failed: ${command}`);
        if (!optional) process.exit(1);
        return false;
    }
}

// 1. Smart Update (Git)
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
        console.log("Updates found! Updating...");
        run(`git reset --hard origin/main`);
    } else {
        console.log("Already up to date.");
    }
}

// 2. Optimized Dependency Install
// Only run npm install if package.json changed or node_modules is missing
const nodeModulesExist = fs.existsSync(path.join(WORK_DIR, 'node_modules'));
if (!nodeModulesExist) {
    console.log("Installing missing dependencies...");
    run(`npm install --no-package-lock --omit=optional`);
} else {
    // Optional: check if package.json was updated in the last git pull
    // For simplicity and speed, we can skip if node_modules exists, 
    // or run a quick install which npm handles efficiently anyway.
    console.log("Verifying dependencies...");
    run(`npm install --no-package-lock --omit=optional --prefer-offline --no-audit`, { silent: true });
}

// 3. Start the server
console.log("Starting the server...");
run(`node server.js`);
