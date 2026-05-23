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
const NPM_FLAGS = [
    '--no-package-lock',
    '--omit=optional',
    '--legacy-peer-deps',
    '--ignore-scripts',   // skip native binary compilation (voice/audio not used)
    '--no-fund',
    '--no-audit',
    `--cache /tmp/npm-cache-${process.pid}`, // isolate cache so it doesn't bloat disk
].join(' ');

const CACHE_DIR = `/tmp/npm-cache-${process.pid}`;

function cleanCache() {
    run(`rm -rf ${CACHE_DIR}`, { optional: true, silent: true });
}

const nodeModulesExist = fs.existsSync(path.join(WORK_DIR, 'node_modules'));
if (!nodeModulesExist) {
    // Wipe any stale global npm cache first
    run(`npm cache clean --force`, { optional: true, silent: true });
    console.log("Installing dependencies...");
    run(`npm install ${NPM_FLAGS}`);
    cleanCache();
} else {
    console.log("Verifying dependencies...");
    run(`npm install ${NPM_FLAGS} --prefer-offline`, { silent: true });
    cleanCache();
}

// 3. Start the server
console.log("Starting the server...");
run(`node server.js`);
