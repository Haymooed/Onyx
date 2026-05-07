const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');

const REPO_URL = "https://github.com/Haymooed/RPcustom";

// ─── Colours ─────────────────────────────────────────────────────
const c = {
    reset: '\x1b[0m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    magenta: '\x1b[35m',
    bold: '\x1b[1m',
    dim: '\x1b[2m'
};

// ─── UI ──────────────────────────────────────────────────────────
function banner() {
    console.clear();

    console.log(`${c.cyan}${c.bold}
 ██████╗ ███╗   ██╗██╗   ██╗██╗  ██╗
██╔═══██╗████╗  ██║╚██╗ ██╔╝╚██╗██╔╝
██║   ██║██╔██╗ ██║ ╚████╔╝  ╚███╔╝ 
██║   ██║██║╚██╗██║  ╚██╔╝   ██╔██╗ 
╚██████╔╝██║ ╚████║   ██║   ██╔╝ ██╗
 ╚═════╝ ╚═╝  ╚═══╝   ╚═╝   ╚═╝  ╚═╝
${c.reset}`);

    console.log(`${c.dim}Onyx Auto Installer & Updater${c.reset}\n`);
}

function line() {
    console.log(`${c.dim}────────────────────────────────────────────────────${c.reset}`);
}

function info(msg) {
    console.log(`${c.cyan}➜${c.reset} ${msg}`);
}

function success(msg) {
    console.log(`${c.green}✔${c.reset} ${msg}`);
}

function warn(msg) {
    console.log(`${c.yellow}⚠${c.reset} ${msg}`);
}

function error(msg) {
    console.log(`${c.red}✘${c.reset} ${msg}`);
}

function runCommand(command, title, { optional = false } = {}) {
    try {
        info(title);
        console.log(`${c.dim}${command}${c.reset}\n`);
        execSync(command, { stdio: 'inherit' });
        success(`${title} complete\n`);
    } catch (err) {
        if (optional) {
            warn(`${title} skipped (non-fatal)\n`);
        } else {
            error(`${title} failed`);
            process.exit(1);
        }
    }
}

// ─── Start ───────────────────────────────────────────────────────
banner();

console.log(`${c.bold}System Information${c.reset}`);
line();

info(`OS: ${os.platform()} ${os.release()}`);
info(`Architecture: ${os.arch()}`);
info(`Node.js: ${process.version}`);

line();

// ─── Git Setup ───────────────────────────────────────────────────
console.log(`\n${c.bold}Repository Sync${c.reset}`);
line();

if (!fs.existsSync('.git')) {

    warn('No git repository found');
    info('Running first-time Onyx setup...\n');

    runCommand('git init', 'Initializing git repository');

    runCommand(
        `git remote add origin ${REPO_URL}`,
        'Connecting to GitHub repository'
    );

    runCommand(
        'git fetch origin',
        'Fetching Onyx files'
    );

    runCommand(
        'git reset --hard origin/main',
        'Installing latest Onyx build'
    );

} else {

    info('Existing repository detected');

    runCommand(
        'git fetch --all',
        'Checking for updates'
    );

    runCommand(
        'git reset --hard origin/main',
        'Applying latest updates'
    );
}

// ─── Dependencies ────────────────────────────────────────────────
console.log(`\n${c.bold}Dependency Installation${c.reset}`);
line();

// Clear npm cache first to free disk space before installing
runCommand(
    'npm cache clean --force',
    'Clearing npm cache',
    { optional: true }
);

runCommand(
    'npm install',
    'Installing npm packages'
);

// ─── Launch ──────────────────────────────────────────────────────
console.log(`\n${c.bold}Launch Sequence${c.reset}`);
line();

success('Onyx is ready');
info('Starting server.js...\n');

try {
    execSync('node server.js', {
        stdio: 'inherit'
    });
} catch (err) {
    error('Onyx crashed or exited unexpectedly');
}
