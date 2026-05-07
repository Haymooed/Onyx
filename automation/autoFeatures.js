'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'auto.json');

const DEFAULTS = {
    afk: {
        enabled: false,
        message: "I'm AFK right now — I'll get back to you soon.",
        cooldownMs: 5 * 60 * 1000  // 5 minutes per user
    },
    autoReact: {
        enabled: false,
        // { "userId": ["👀","🔥"] }
        userTriggers: {},
        // { "keyword": ["💀"] }  (case-insensitive substring match)
        textTriggers: {}
    },
    autoReply: {
        enabled: false,
        // [{ match:"hi", reply:"hello!", exact:false }]
        rules: []
    }
};

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
    ensureDir();
    if (!fs.existsSync(FILE)) return JSON.parse(JSON.stringify(DEFAULTS));
    try {
        return { ...DEFAULTS, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) };
    } catch {
        return JSON.parse(JSON.stringify(DEFAULTS));
    }
}

function save(data) {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

class AutoFeatures {
    constructor(log) {
        this.log = log || ((m) => console.log('[Auto]', m));
        this.client = null;
        this._afkLastReplied = new Map(); // userId -> timestamp
        this._handler = null;
    }

    config() { return load(); }
    update(patch) {
        const cur = load();
        const next = { ...cur, ...patch };
        save(next);
        return next;
    }

    bind(client) {
        this.unbind();
        this.client = client;
        if (!client) return;

        this._handler = async (message) => {
            try {
                if (!message || !message.author) return;
                if (message.author.id === client.user?.id) return;

                const cfg = load();

                // Auto-react on user/keyword triggers
                if (cfg.autoReact?.enabled) {
                    const userEmojis = cfg.autoReact.userTriggers?.[message.author.id];
                    if (Array.isArray(userEmojis)) {
                        for (const e of userEmojis) {
                            await message.react(e).catch(() => {});
                        }
                    }
                    const text = (message.content || '').toLowerCase();
                    for (const [kw, emojis] of Object.entries(cfg.autoReact.textTriggers || {})) {
                        if (!kw) continue;
                        if (text.includes(kw.toLowerCase())) {
                            for (const e of (emojis || [])) {
                                await message.react(e).catch(() => {});
                            }
                        }
                    }
                }

                // Auto-reply rules (DM or mention only, to avoid spam)
                const isDM = !message.guild;
                const mentioned = message.mentions?.users?.has?.(client.user.id);
                if (cfg.autoReply?.enabled && (isDM || mentioned)) {
                    const text = (message.content || '');
                    const lower = text.toLowerCase();
                    for (const rule of (cfg.autoReply.rules || [])) {
                        if (!rule || !rule.match) continue;
                        const m = String(rule.match).toLowerCase();
                        const hit = rule.exact ? lower === m : lower.includes(m);
                        if (hit) {
                            await message.channel.send(String(rule.reply || '')).catch(() => {});
                            break;
                        }
                    }
                }

                // AFK auto-responder (DMs only, with per-user cooldown)
                if (cfg.afk?.enabled && isDM) {
                    const now = Date.now();
                    const last = this._afkLastReplied.get(message.author.id) || 0;
                    if (now - last > (cfg.afk.cooldownMs || 300000)) {
                        this._afkLastReplied.set(message.author.id, now);
                        await message.channel.send(cfg.afk.message || "I'm AFK.").catch(() => {});
                    }
                }
            } catch (e) {
                this.log(`handler error: ${e.message}`);
            }
        };

        client.on('messageCreate', this._handler);
    }

    unbind() {
        if (this.client && this._handler) {
            try { this.client.off('messageCreate', this._handler); } catch {}
        }
        this.client = null;
        this._handler = null;
    }
}

module.exports = { AutoFeatures };
