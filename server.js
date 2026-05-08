'use strict';

require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const { Client } = require('discord.js-selfbot-v13');
const QuestManagerBridge = require('./quests/manager');
const { MessageScheduler } = require('./automation/messages');
const { AutoFeatures } = require('./automation/autoFeatures');
const { purgeOwn, sendTo, massDm } = require('./automation/utility');

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
        name: 'Onyx',
        application_id: '',
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
        button2_url: ''
    },
    custom_status: {
        enabled: false,
        text: '',
        emoji: ''
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

const messageScheduler = new MessageScheduler(() => discordClient);
const autoFeatures = new AutoFeatures();

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
        name: rpc.name || 'Onyx'
    };

    if (rpc.application_id) act.application_id = String(rpc.application_id);
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

    activities.push(act);

    // Custom status (the line under your username) — separate activity
    const custom = cfg.custom_status || {};
    if (custom.enabled && (custom.text || custom.emoji)) {
        const customAct = {
            type: 'CUSTOM',
            name: 'Custom Status',
            state: custom.text || ' '
        };
        if (custom.emoji) {
            const m = /<(a)?:(\w+):(\d+)>/.exec(custom.emoji);
            customAct.emoji = m
                ? { name: m[2], id: m[3], animated: !!m[1] }
                : { name: custom.emoji, id: null, animated: false };
        }
        activities.push(customAct);
    }

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
    try { messageScheduler.stop(); } catch {}
    try { autoFeatures.unbind(); } catch {}

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

        try { messageScheduler.initialize(); } catch (e) { console.error('[Messages] init:', e.message); }
        try { autoFeatures.bind(discordClient); } catch (e) { console.error('[Auto] bind:', e.message); }

        refreshInterval = setInterval(() => {
            applyPresence().catch(() => {});
        }, 5 * 60 * 1000);

        if (fs.existsSync(CONFIG_PATH)) {
            configWatcher = fs.watch(CONFIG_PATH, async (event) => {
                if (event === 'change') {
                    await applyPresence();
                }
            });
        }
    });

    discordClient.on('error', (err) => {
        clientError = err.message;
        console.error('[RPC] Client error:', clientError);
    });

    try {
        await discordClient.login(token);
    } catch (e) {
        clientState = 'error';
        clientError = e.message;
        console.error('[RPC] Login error:', e.message);
    }
}

function getQuestBridge() {
    if (!discordClient || clientState !== 'connected') return null;
    if (!questBridge) {
        questBridge = new QuestManagerBridge(discordClient, (p) => {
            if (!p) {
                applyPresence().catch(() => {});
            } else {
                discordClient.user.setPresence({
                    status: loadConfig().status || 'online',
                    activities: [{
                        type: 'PLAYING',
                        name: p.name,
                        application_id: p.appId,
                        timestamps: { start: p.start || Date.now() }
                    }]
                }).catch(() => {});
            }
        });
    }
    return questBridge;
}

// ─────────────────────────────────────────────────────────────────────────────
// API Routes
// ─────────────────────────────────────────────────────────────────────────────
app.get('/login', (req, res) => {
    if (isVercel) return res.redirect('/');
    res.render('login');
});

app.post('/api/login', (req, res) => {
    const { password } = req.body || {};
    if (password === getPanelPass()) {
        res.cookie('auth', password, { maxAge: 86400000, httpOnly: true });
        res.json({ success: true });
    } else {
        res.json({ success: false, error: 'Invalid password' });
    }
});

app.use((req, res, next) => {
    if (isVercel || req.path === '/login' || req.path.startsWith('/api/login') || req.path.startsWith('/public')) return next();
    const auth = req.cookies.auth;
    if (auth === getPanelPass()) return next();
    res.redirect('/login');
});

app.get('/api/config', (req, res) => {
    res.json(loadConfig());
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
// Messaging — scheduled (one-time) and recurring (interval)
// ─────────────────────────────────────────────────────────────────────────────
function requireConnected(res) {
    if (!discordClient || clientState !== 'connected') {
        res.json({ success: false, error: 'Discord client not connected' });
        return false;
    }
    return true;
}

app.get('/api/messages', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    res.json({ success: true, ...messageScheduler.list() });
});

app.post('/api/messages/scheduled', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    if (!requireConnected(res)) return;
    try {
        const entry = messageScheduler.addScheduled(req.body || {});
        res.json({ success: true, entry });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.delete('/api/messages/scheduled/:id', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    messageScheduler.removeScheduled(req.params.id);
    res.json({ success: true });
});

app.post('/api/messages/recurring', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    if (!requireConnected(res)) return;
    try {
        const entry = messageScheduler.addRecurring(req.body || {});
        res.json({ success: true, entry });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.delete('/api/messages/recurring/:id', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    messageScheduler.removeRecurring(req.params.id);
    res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auto features (AFK / auto-react / auto-reply)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/auto', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    res.json({ success: true, config: autoFeatures.config() });
});

app.post('/api/auto', (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    try {
        const next = autoFeatures.update(req.body || {});
        res.json({ success: true, config: next });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility — purge / dm / massdm
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/util/purge', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    if (!requireConnected(res)) return;
    try {
        const { channelId, count } = req.body || {};
        if (!channelId) return res.json({ success: false, error: 'channelId required' });
        const deleted = await purgeOwn(discordClient, channelId, count || 10);
        res.json({ success: true, deleted });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/util/send', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    if (!requireConnected(res)) return;
    try {
        const { targetId, message } = req.body || {};
        if (!targetId || !message) return res.json({ success: false, error: 'targetId and message required' });
        await sendTo(discordClient, targetId, message);
        res.json({ success: true });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

app.post('/api/util/massdm', async (req, res) => {
    if (isVercel) return res.status(403).json({ success: false, error: 'Access Denied' });
    if (!requireConnected(res)) return;
    try {
        const { ids, message, delayMs } = req.body || {};
        if (!Array.isArray(ids) || ids.length === 0 || !message) {
            return res.json({ success: false, error: 'ids[] and message required' });
        }
        const result = await massDm(discordClient, ids, message, Math.max(1000, parseInt(delayMs, 10) || 1500));
        res.json({ success: true, ...result });
    } catch (e) {
        res.json({ success: false, error: e.message });
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Updates feed (consumed by landing page)
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/updates', (req, res) => {
    try {
        const file = path.join(__dirname, 'data', 'updates.json');
        const raw = fs.readFileSync(file, 'utf8');
        res.type('application/json').send(raw);
    } catch (e) {
        res.json({ updates: [] });
    }
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
        console.log(`[Onyx] Panel running on port ${PORT}  password: ${getPanelPass()}`);
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
