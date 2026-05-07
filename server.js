'use strict';

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Client } = require('discord.js-selfbot-v13');
const QuestManagerBridge = require('./quests/manager');

const app = express();
const CONFIG_PATH = path.join(__dirname, 'config.yml');
const isVercel = process.env.VERCEL === '1' || !!process.env.VERCEL_URL;

const DEFAULT_CONFIG = {
    token: 'PASTE_YOUR_TOKEN_HERE',
    panel_pass: 'admin',
    status: 'online',
    rpc: {
        enabled: true,
        type: 'PLAYING',
        name: 'RPcustom',
        details: '',
        state: '',
        stream_url: 'https://twitch.tv/discord',
        show_elapsed: false,
        large_image: '',
        large_text: '',
        small_image: '',
        small_text: '',
        button1_text: '',
        button1_url: '',
        button2_text: '',
        button2_url: '',
        spoof_game: 'none',
        spoof_app: 'none'
    }
};

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ─────────────────────────────────────────────────────────────────────────────
// Config helpers
// ─────────────────────────────────────────────────────────────────────────────
function deepMerge(base, extra) {
    if (!extra || typeof extra !== 'object') return base;
    const out = Array.isArray(base) ? [...base] : { ...base };

    for (const [key, value] of Object.entries(extra)) {
        if (
            value &&
            typeof value === 'object' &&
            !Array.isArray(value) &&
            base &&
            typeof base[key] === 'object' &&
            !Array.isArray(base[key])
        ) {
            out[key] = deepMerge(base[key], value);
        } else {
            out[key] = value;
        }
    }

    return out;
}

function ensureConfigExists() {
    if (isVercel) return false;

    if (!fs.existsSync(CONFIG_PATH)) {
        fs.writeFileSync(CONFIG_PATH, yaml.dump(DEFAULT_CONFIG, { lineWidth: -1 }));
        console.log('[Config] Created missing config.yml');
        return true;
    }

    return true;
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_PATH)) {
            if (!isVercel) ensureConfigExists();
            return deepMerge({}, DEFAULT_CONFIG);
        }

        const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
        const parsed = yaml.load(raw) || {};
        return deepMerge(DEFAULT_CONFIG, parsed);
    } catch (e) {
        console.error('[Config] Read error:', e.message);
        return deepMerge({}, DEFAULT_CONFIG);
    }
}

function saveConfig(data) {
    if (isVercel) return;
    fs.writeFileSync(CONFIG_PATH, yaml.dump(data, { lineWidth: -1 }));
}

function getPanelPass() {
    const cfg = loadConfig();
    return cfg.panel_pass || process.env.PANEL_PASS || 'admin';
}

// ─────────────────────────────────────────────────────────────────────────────
// Discord presence
// ─────────────────────────────────────────────────────────────────────────────
let discordClient = null;
let clientState = 'disconnected';
let clientError = '';
let currentTag = '';
let refreshInterval = null;
let configWatcher = null;
let presenceStart = null;
let questBridge = null;

function isHttpUrl(u) {
    return typeof u === 'string' && (u.startsWith('http://') || u.startsWith('https://'));
}

function buildPresence(cfg) {
    const rpc = cfg.rpc || {};
    const activities = [];

    if (rpc.enabled === false) {
        return { status: cfg.status || 'online', activities };
    }

    const act = {
        type: (rpc.type || 'PLAYING').toUpperCase(),
        name: rpc.name || 'RPcustom'
    };

    if (rpc.application_id) act.application_id = rpc.application_id;
    if (rpc.details) act.details = rpc.details;
    if (rpc.state) act.state = rpc.state;

    const assets = {};
    if (rpc.large_image) {
        assets.large_image = rpc.large_image;
        if (rpc.large_text) assets.large_text = rpc.large_text;
    }
    if (rpc.small_image) {
        assets.small_image = rpc.small_image;
        if (rpc.small_text) assets.small_text = rpc.small_text;
    }
    if (Object.keys(assets).length) act.assets = assets;

    const buttons = [];
    const buttonUrls = [];

    if (rpc.button1_text && isHttpUrl(rpc.button1_url)) {
        buttons.push(rpc.button1_text);
        buttonUrls.push(rpc.button1_url);
    }
    if (rpc.button2_text && isHttpUrl(rpc.button2_url)) {
        buttons.push(rpc.button2_text);
        buttonUrls.push(rpc.button2_url);
    }

    if (buttons.length) {
        act.buttons = buttons;
        act.metadata = { button_urls: buttonUrls };
    }

    if (rpc.show_elapsed) {
        act.timestamps = { start: presenceStart || Date.now() };
    }

    const spoofGame = (rpc.spoof_game || 'none').toLowerCase();
    if (spoofGame !== 'none') {
        act.type = 'PLAYING';
        act.name = 'RPcustom';
        delete act.details;
        delete act.state;
        delete act.buttons;
        delete act.metadata;
        act.assets = {};
        act.timestamps = { start: presenceStart || Date.now() };

        if (spoofGame === 'minecraft') {
            act.application_id = '1402418491272986635';
            act.name = 'Minecraft';
            act.assets.large_image = 'https://cdn.discordapp.com/app-icons/1402418491272986635/166fbad351ecdd02d11a3b464748f66b.png?size=240';
        } else if (spoofGame === 'genshin') {
            act.application_id = '762434991303950386';
            act.name = 'Genshin Impact';
            act.assets.large_image = 'https://cdn.discordapp.com/app-icons/762434991303950386/eb0e25b739e4fa38c1671a3d1edcd1e0.png?size=240';
        }
    }

    const spoofApp = (rpc.spoof_app || 'none').toLowerCase();
    if (spoofApp === 'crunchyroll') {
        act.application_id = '981509069309354054';
    } else if (spoofApp === 'playstation') {
        act.application_id = '1008890872156405890';
        act.platform = 'ps5';
    }

    activities.push(act);
    return { status: cfg.status || 'online', activities };
}

async function applyPresence() {
    if (!discordClient || clientState !== 'connected') return;

    try {
        const cfg = loadConfig();
        await discordClient.user.setPresence(buildPresence(cfg));
        console.log('[RPC] Presence updated');
    } catch (e) {
        console.error('[RPC] Presence error:', e.message);
    }
}

function stopClient() {
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }

    if (configWatcher) {
        try {
            configWatcher.close();
        } catch {}
        configWatcher = null;
    }

    if (discordClient) {
        try {
            discordClient.destroy();
        } catch {}
        discordClient = null;
    }

    clientState = 'disconnected';
    clientError = '';
    currentTag = '';
    presenceStart = null;
}

async function connectClient(token) {
    if (isVercel) return;

    stopClient();

    clientState = 'connecting';
    clientError = '';
    discordClient = new Client({ checkUpdate: false });

    discordClient.once('ready', async () => {
        clientState = 'connected';
        currentTag = discordClient.user?.tag || '';
        presenceStart = Date.now();

        console.log(`[RPC] Logged in as ${currentTag}`);

        await applyPresence();

        refreshInterval = setInterval(() => {
            applyPresence().catch(() => {});
        }, 5 * 60 * 1000);

        if (fs.existsSync(CONFIG_PATH)) {
            configWatcher = fs.watch(CONFIG_PATH, { persistent: false }, () => {
                clearTimeout(configWatcher._debounce);
                configWatcher._debounce = setTimeout(() => {
                    applyPresence().catch(() => {});
                }, 400);
            });
        }
    });

    discordClient.on('error', err => {
        clientError = err?.message || 'Unknown Discord client error';
        console.error('[RPC] Client error:', clientError);
    });

    discordClient.on('shardDisconnect', () => {
        clientState = 'disconnected';
    });

    try {
        await discordClient.login(token);
    } catch (e) {
        clientState = 'error';
        clientError = e.message;
        console.error('[RPC] Login error:', e.message);
        if (discordClient) {
            try {
                discordClient.destroy();
            } catch {}
            discordClient = null;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quest bridge
// ─────────────────────────────────────────────────────────────────────────────
function getQuestBridge() {
    if (isVercel) return null;

    const cfg = loadConfig();
    if (!cfg.token || cfg.token === 'PASTE_YOUR_TOKEN_HERE') return null;

    const tok = String(cfg.token).replace('Bot ', '');

    if (!questBridge || questBridge.token !== tok) {
        questBridge = new QuestManagerBridge(tok, async (gameInfo) => {
            if (!discordClient || clientState !== 'connected') return;

            try {
                if (gameInfo) {
                    await discordClient.user.setPresence({
                        status: loadConfig().status || 'online',
                        activities: [{
                            type: 'PLAYING',
                            application_id: gameInfo.appId,
                            name: gameInfo.name,
                            timestamps: { start: gameInfo.start }
                        }]
                    });
                } else {
                    await applyPresence();
                }
            } catch (e) {
                console.error('[Quest] Presence set error:', e.message);
            }
        });
    }

    return questBridge;
}

// ─────────────────────────────────────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────────────────────────────────────
if (!isVercel) {
    ensureConfigExists();

    const initCfg = loadConfig();
    const envToken = process.env.DISCORD_TOKEN;

    if (envToken && (!initCfg.token || initCfg.token === 'PASTE_YOUR_TOKEN_HERE')) {
        initCfg.token = envToken;
        saveConfig(initCfg);
    }

    if (initCfg.token && initCfg.token !== 'PASTE_YOUR_TOKEN_HERE') {
        connectClient(initCfg.token).catch(err => {
            console.error('[RPC] Initial connect failed:', err.message);
        });
    } else if (fs.existsSync(CONFIG_PATH)) {
        configWatcher = fs.watch(CONFIG_PATH, { persistent: false }, () => {
            clearTimeout(configWatcher._debounce);
            configWatcher._debounce = setTimeout(() => {
                applyPresence().catch(() => {});
            }, 400);
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────────────────────────────────────
app.use((req, res, next) => {
    if (isVercel) {
        if (req.path === '/') return next();
        return res.status(403).send('Access Denied: This environment only hosts the landing page.');
    }

    if (req.path === '/') return res.redirect('/login');
    if (req.path === '/login' || req.path === '/api/login') return next();

    if (req.cookies.session === 'ok') return next();
    return res.redirect('/login');
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
    if (isVercel) return res.status(403).send('Access Denied');
    if (req.cookies.session === 'ok') return res.redirect('/panel');
    res.render('login');
});

app.post('/api/login', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    if (req.body.password === getPanelPass()) {
        res.cookie('session', 'ok', {
            maxAge: 7 * 24 * 60 * 60 * 1000,
            httpOnly: true
        });
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Wrong password' });
    }
});

app.get('/logout', (req, res) => {
    if (isVercel) return res.status(403).send('Access Denied');
    res.clearCookie('session');
    res.redirect('/login');
});

// ─────────────────────────────────────────────────────────────────────────────
// RPC API
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    const cfg = loadConfig();
    const safe = { ...cfg };

    if (safe.token && safe.token !== 'PASTE_YOUR_TOKEN_HERE') {
        safe.token = '••••';
    } else {
        safe.token = '';
    }

    res.json(safe);
});

app.post('/api/config', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    try {
        const current = loadConfig();
        const updated = deepMerge(current, req.body || {});
        saveConfig(updated);
        await applyPresence();
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/connect', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    const { token } = req.body || {};
    if (!token) return res.json({ success: false, error: 'Token required' });

    try {
        const cfg = loadConfig();
        cfg.token = token;
        saveConfig(cfg);

        questBridge = null;
        await connectClient(token);

        setTimeout(() => {
            res.json({
                success: clientState !== 'error',
                state: clientState,
                error: clientError,
                tag: currentTag
            });
        }, 3500);
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.get('/api/status', (req, res) => {
    if (isVercel) return res.json({ state: 'disconnected', error: '', tag: '' });
    res.json({ state: clientState, error: clientError, tag: currentTag });
});

app.post('/api/disconnect', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    stopClient();
    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Quest API
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/quests', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

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
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    const bridge = getQuestBridge();
    if (!bridge) return res.json({ success: false, error: 'Not connected — set a token first' });
    if (bridge.isRunning) return res.json({ success: false, error: 'Quests already running' });

    const { questId } = req.body || {};
    res.json({ success: true });

    if (questId) bridge.startOne(questId).catch(() => {});
    else bridge.startAll().catch(() => {});
});

app.post('/api/quests/stop', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    if (questBridge) questBridge.stopAll();
    res.json({ success: true });
});

app.get('/api/quests/status', (req, res) => {
    if (isVercel) return res.json({ isRunning: false, currentQuest: null, logs: [] });

    const bridge = questBridge;
    res.json({
        isRunning: bridge?.isRunning || false,
        currentQuest: bridge?.currentQuestInfo || null,
        logs: bridge?.globalLogs || []
    });
});

app.post('/api/quests/clear-logs', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });

    if (questBridge) questBridge.clearLogs();
    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pages
// ─────────────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    if (isVercel) {
        res.sendFile(path.join(__dirname, 'landing.html'));
    } else {
        res.redirect('/login');
    }
});

app.get('/panel', (req, res) => {
    if (isVercel) {
        return res.status(403).send('Access Denied');
    }

    res.render('index');
});

// ─────────────────────────────────────────────────────────────────────────────
// Start
// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

if (!isVercel) {
    app.listen(PORT, () => {
        console.log(`[RPcustom] Panel running on port ${PORT}  password: ${getPanelPass()}`);
    });
}

// Vercel may still load the file, but it should not try to hold a server open.
module.exports = app;

process.on('SIGINT', () => {
    if (refreshInterval) clearInterval(refreshInterval);
    if (configWatcher) {
        try {
            configWatcher.close();
        } catch {}
    }
    if (discordClient) {
        try {
            discordClient.destroy();
        } catch {}
    }
    process.exit(0);
});
