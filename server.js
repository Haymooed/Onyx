'use strict';
require('dotenv').config();
const express = require('express');
const { Client } = require('discord.js-selfbot-v13');
const fs = require('fs');
const yaml = require('js-yaml');
const path = require('path');
const cookieParser = require('cookie-parser');
const QuestManagerBridge = require('./quests/manager');

const CONFIG_PATH = path.join(__dirname, 'config.yml');
const app = express();
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_URL;

app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─── Load / Save config ───────────────────────────────────────────────────────
function loadConfig() {
    try { return yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8')); }
    catch (e) { console.error('[Config] Read error:', e.message); return {}; }
}
function saveConfig(data) {
    fs.writeFileSync(CONFIG_PATH, yaml.dump(data, { lineWidth: -1 }));
}

// ─── Build Discord presence ───────────────────────────────────────────────────
function buildPresence(cfg) {
    const rpc = cfg.rpc || {};
    const activities = [];
    if (rpc.enabled !== false) {
        const act = {
            type: (rpc.type || 'PLAYING').toUpperCase(),
            name: rpc.name || 'RPcustom',
            application_id: rpc.application_id || undefined,
            details: rpc.details || undefined,
            state: rpc.state || undefined,
            assets: {}, buttons: [], metadata: { button_urls: [] }
        };
        if (act.type === 'STREAMING') act.url = rpc.stream_url || 'https://twitch.tv/discord';
        if (rpc.show_elapsed) act.timestamps = { start: presenceStart || Date.now() };
        if (rpc.large_image) { act.assets.large_image = rpc.large_image; if (rpc.large_text) act.assets.large_text = rpc.large_text; }
        if (rpc.small_image) { act.assets.small_image = rpc.small_image; if (rpc.small_text) act.assets.small_text = rpc.small_text; }
        if (!Object.keys(act.assets).length) delete act.assets;
        const isUrl = u => u && (u.startsWith('http://') || u.startsWith('https://'));
        if (rpc.button1_text && isUrl(rpc.button1_url)) { act.buttons.push(rpc.button1_text); act.metadata.button_urls.push(rpc.button1_url); }
        if (rpc.button2_text && isUrl(rpc.button2_url)) { act.buttons.push(rpc.button2_text); act.metadata.button_urls.push(rpc.button2_url); }
        if (!act.buttons.length) { delete act.buttons; delete act.metadata; }
        const game = (rpc.spoof_game || 'none').toLowerCase();
        if (game !== 'none') {
            delete act.details; delete act.state; act.assets = {}; delete act.buttons; delete act.metadata;
            act.type = 'PLAYING'; act.timestamps = { start: presenceStart || Date.now() };
            if (game === 'minecraft') { act.application_id = '1402418491272986635'; act.name = 'Minecraft'; act.assets.large_image = 'https://cdn.discordapp.com/app-icons/1402418491272986635/166fbad351ecdd02d11a3b464748f66b.png?size=240'; }
            else if (game === 'genshin') { act.application_id = '762434991303950386'; act.name = 'Genshin Impact'; act.assets.large_image = 'https://cdn.discordapp.com/app-icons/762434991303950386/eb0e25b739e4fa38c1671a3d1edcd1e0.png?size=240'; }
        }
        const appSpoof = (rpc.spoof_app || 'none').toLowerCase();
        if (appSpoof === 'crunchyroll') act.application_id = '981509069309354054';
        else if (appSpoof === 'playstation') { act.application_id = '1008890872156405890'; act.platform = 'ps5'; }
        activities.push(act);
    }
    return { status: cfg.status || 'online', activities };
}

// ─── Discord Client ───────────────────────────────────────────────────────────
let discordClient = null;
let clientState = 'disconnected';
let clientError = '';
let currentTag = '';
let refreshInterval = null;
let configWatcher = null;
let presenceStart = null;

async function applyPresence() {
    if (!discordClient || clientState !== 'connected') return;
    try {
        const cfg = loadConfig();
        await discordClient.user.setPresence(buildPresence(cfg));
        console.log('[RPC] Presence updated');
    } catch (e) { console.error('[RPC] Presence error:', e.message); }
}

async function connectClient(token) {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (configWatcher)   { try { configWatcher.close(); } catch {} configWatcher = null; }
    if (discordClient)   { try { discordClient.destroy(); } catch {} discordClient = null; }

    clientState = 'connecting'; clientError = '';
    discordClient = new Client({ checkUpdate: false });

    discordClient.once('ready', async () => {
        clientState = 'connected';
        currentTag = discordClient.user.tag;
        presenceStart = Date.now();
        console.log(`[RPC] Logged in as ${currentTag}`);
        await applyPresence();
        refreshInterval = setInterval(applyPresence, 5 * 60 * 1000);
        configWatcher = fs.watch(CONFIG_PATH, () => {
            clearTimeout(configWatcher._debounce);
            configWatcher._debounce = setTimeout(applyPresence, 400);
        });
    });

    discordClient.on('error', err => { clientError = err.message; });
    discordClient.on('shardDisconnect', () => { clientState = 'disconnected'; });

    try { await discordClient.login(token); }
    catch (e) { clientState = 'error'; clientError = e.message; discordClient = null; }
}

const initCfg = loadConfig();
const envToken = process.env.DISCORD_TOKEN;
if (envToken && (!initCfg.token || initCfg.token === 'PASTE_YOUR_TOKEN_HERE')) {
    initCfg.token = envToken;
    saveConfig(initCfg);
}
if (initCfg.token && initCfg.token !== 'PASTE_YOUR_TOKEN_HERE') {
    connectClient(initCfg.token);
} else {
    configWatcher = fs.watch(CONFIG_PATH, () => {
        clearTimeout(configWatcher._debounce);
        configWatcher._debounce = setTimeout(applyPresence, 400);
    });
}

// ─── Quest Manager ────────────────────────────────────────────────────────────
let questBridge = null;

function getQuestBridge() {
    const cfg = loadConfig();
    if (!cfg.token || cfg.token === 'PASTE_YOUR_TOKEN_HERE') return null;
    const tok = cfg.token.replace('Bot ', '');
    if (!questBridge || questBridge.token !== tok) {
        questBridge = new QuestManagerBridge(tok, async (gameInfo) => {
            if (!discordClient || clientState !== 'connected') return;
            if (gameInfo) {
                try {
                    await discordClient.user.setPresence({
                        status: loadConfig().status || 'online',
                        activities: [{
                            type: 'PLAYING',
                            application_id: gameInfo.appId,
                            name: gameInfo.name,
                            timestamps: { start: gameInfo.start },
                        }]
                    });
                } catch (e) { console.error('[Quest] Presence set error:', e.message); }
            } else {
                await applyPresence();
            }
        });
    }
    return questBridge;
}

// ─── Auth middleware ──────────────────────────────────────────────────────────
function getPanelPass() {
    const cfg = loadConfig();
    return cfg.panel_pass || process.env.PANEL_PASS || 'admin';
}

app.use((req, res, next) => {
    if (isVercel) {
        // On Vercel: ONLY allow the landing page (root)
        // Block access to panel, login, and all APIs
        if (req.path === '/') return next();
        return res.status(403).send('Access Denied: This environment only hosts the landing page.');
    } else {
        // On Self-Hosted: ONLY allow panel and login
        // Block access to the landing page
        if (req.path === '/') return res.redirect('/login');
        
        // Public routes for self-hosted
        if (req.path === '/login' || req.path === '/api/login') return next();
        
        // Everything else requires a valid session cookie
        if (req.cookies.session === 'ok') return next();
        res.redirect('/login');
    }
});

// ─── Auth routes ──────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
    if (req.cookies.session === 'ok') return res.redirect('/panel');
    res.render('login');
});

app.post('/api/login', (req, res) => {
    if (req.body.password === getPanelPass()) {
        res.cookie('session', 'ok', { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true });
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Wrong password' });
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('session');
    res.redirect('/login');
});

// ─── RPC API ──────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
    const cfg = loadConfig();
    const safe = { ...cfg, token: cfg.token && cfg.token !== 'PASTE_YOUR_TOKEN_HERE' ? '••••' : '' };
    res.json(safe);
});

app.post('/api/config', async (req, res) => {
    try {
        const current = loadConfig();
        const updated = { ...current, ...req.body };
        saveConfig(updated);
        await applyPresence();
        res.json({ success: true });
    } catch (e) { res.json({ success: false, error: e.message }); }
});

app.post('/api/connect', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.json({ success: false, error: 'Token required' });
    const cfg = loadConfig();
    cfg.token = token;
    saveConfig(cfg);
    questBridge = null;
    await connectClient(token);
    setTimeout(() => {
        res.json({ success: clientState !== 'error', state: clientState, error: clientError, tag: currentTag });
    }, 3500);
});

app.get('/api/status', (req, res) => {
    res.json({ state: clientState, error: clientError, tag: currentTag });
});

app.post('/api/disconnect', (req, res) => {
    if (refreshInterval) { clearInterval(refreshInterval); refreshInterval = null; }
    if (configWatcher)   { try { configWatcher.close(); } catch {} configWatcher = null; }
    if (discordClient)   { try { discordClient.destroy(); } catch {} discordClient = null; }
    clientState = 'disconnected'; currentTag = ''; presenceStart = null;
    res.json({ success: true });
});

// ─── Quest API ────────────────────────────────────────────────────────────────
app.get('/api/quests', async (req, res) => {
    const bridge = getQuestBridge();
    if (!bridge) return res.json({ success: false, error: 'Not connected — set a token first' });
    try {
        const quests = await bridge.fetchQuests();
        res.json({ success: true, quests });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/quests/start', (req, res) => {
    const bridge = getQuestBridge();
    if (!bridge) return res.json({ success: false, error: 'Not connected — set a token first' });
    if (bridge.isRunning) return res.json({ success: false, error: 'Quests already running' });
    const { questId } = req.body;
    res.json({ success: true });
    if (questId) bridge.startOne(questId).catch(() => {});
    else         bridge.startAll().catch(() => {});
});

app.post('/api/quests/stop', (req, res) => {
    if (questBridge) questBridge.stopAll();
    res.json({ success: true });
});

app.get('/api/quests/status', (req, res) => {
    const bridge = questBridge;
    res.json({
        isRunning: bridge?.isRunning || false,
        currentQuest: bridge?.currentQuestInfo || null,
        logs: bridge?.globalLogs || [],
    });
});

app.post('/api/quests/clear-logs', (req, res) => {
    if (questBridge) questBridge.clearLogs();
    res.json({ success: true });
});

// ─── Pages ────────────────────────────────────────────────────────────────────
// Public landing page — shown only on Vercel
app.get('/', (req, res) => {
    if (isVercel) {
        res.sendFile(path.join(__dirname, 'landing.html'));
    } else {
        res.redirect('/login');
    }
});

// Protected admin panel — shown only on self-hosted
app.get('/panel', (req, res) => {
    if (isVercel) {
        return res.status(403).send('Access Denied');
    }
    res.render('index');
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`[RPcustom] Panel running on port ${PORT}  password: ${getPanelPass()}`);
});

process.on('SIGINT', () => {
    if (refreshInterval) clearInterval(refreshInterval);
    if (configWatcher)   try { configWatcher.close(); } catch {}
    if (discordClient)   try { discordClient.destroy(); } catch {}
    process.exit(0);
});
