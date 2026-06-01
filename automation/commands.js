'use strict';

const https = require('https');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const opts = {
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                ...headers
            }
        };
        const req = https.request(opts, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

// ─── RedGifs (gay commands only) ─────────────────────────────────────────────

let _rgToken = null;
let _rgTokenExpiry = 0;

async function getRgToken() {
    if (_rgToken && Date.now() < _rgTokenExpiry) return _rgToken;
    const { body } = await httpsGet('https://api.redgifs.com/v2/auth/temporary');
    _rgToken = body.token;
    _rgTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _rgToken;
}

async function searchRedgifs(query, count = 40) {
    const token = await getRgToken();
    const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=${count}&order=trending`;
    const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
    const gifs = body?.gifs;
    if (!Array.isArray(gifs) || gifs.length === 0) return null;
    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    return gif.urls?.hd || gif.urls?.sd || `https://www.redgifs.com/watch/${gif.id}`;
}

// ─── Rule34.xxx (Rivals commands) ────────────────────────────────────────────

async function searchRule34(tags) {
    // Try animated/video first for better content
    const animated = encodeURIComponent(tags + ' animated');
    const base = `https://api.rule34.xxx/index.php?page=dapi&s=post&q=index&json=1&limit=100&tags=`;

    let { body } = await httpsGet(base + animated);
    let posts = Array.isArray(body) ? body : [];

    // Fall back to any content if no animated results
    if (posts.length === 0) {
        ({ body } = await httpsGet(base + encodeURIComponent(tags)));
        posts = Array.isArray(body) ? body : [];
    }

    if (posts.length === 0) return null;

    // Prefer actual video/gif files
    const media = posts.filter(p =>
        p.file_url && /\.(gif|mp4|webm)$/i.test(p.file_url)
    );
    const pool = media.length > 0 ? media : posts.filter(p => p.file_url);
    if (pool.length === 0) return null;

    return pool[Math.floor(Math.random() * pool.length)].file_url;
}

// ─── Marvel Rivals hero → Rule34 tags ────────────────────────────────────────

const RIVALS_NSFW = {
    '!ironman':        'iron_man',
    '!spiderman':      'peter_parker',
    '!miles':          'miles_morales',
    '!venom':          'venom_(marvel)',
    '!thor':           'thor_odinson',
    '!hulk':           'hulk',
    '!shehulk':        'she-hulk',
    '!captainamerica': 'captain_america',
    '!storm':          'storm_(marvel)',
    '!magneto':        'magneto',
    '!scarletwitch':   'scarlet_witch',
    '!doctorstrange':  'doctor_strange',
    '!blackpanther':   'black_panther_(marvel)',
    '!blackwidow':     'natasha_romanoff',
    '!hawkeye':        'clint_barton',
    '!wolverine':      'wolverine',
    '!loki':           'loki_laufeyson',
    '!lunasnow':       'luna_snow',
    '!namor':          'namor_(marvel)',
    '!peniparker':     'peni_parker',
    '!punisher':       'frank_castle',
    '!wintersoldier':  'bucky_barnes',
    '!starlord':       'peter_quill',
    '!hela':           'hela_(marvel)',
    '!adamwarlock':    'adam_warlock',
    '!moonknight':     'marc_spector',
    '!ironfist':       'iron_fist_(marvel)',
    '!mrfantastic':    'reed_richards',
    '!invisiblewoman': 'susan_storm',
    '!humantorch':     'johnny_storm',
    '!thething':       'ben_grimm',
    '!squirrelgirl':   'squirrel_girl',
    '!cloak':          'tandy_bowen',
    '!jefftheshark':   'jeff_(marvel)',
};

// ─── Command map ──────────────────────────────────────────────────────────────

const COMMANDS = {
    // Gay — RedGifs (this is where that content actually lives)
    '!gay':   () => searchRedgifs('gay'),
    '!bear':  () => searchRedgifs('gay bear'),
    '!twink': () => searchRedgifs('gay twink'),
    '!daddy': () => searchRedgifs('gay daddy'),
    '!yaoi':  () => searchRedgifs('yaoi'),
    '!bl':    () => searchRedgifs('boys love yaoi'),
};

// Rivals — Rule34.xxx with proper character tags
for (const [cmd, tag] of Object.entries(RIVALS_NSFW)) {
    COMMANDS[cmd] = () => searchRule34(tag);
}

// ─── Handler class ────────────────────────────────────────────────────────────

class SelfbotCommands {
    constructor(log) {
        this.log = log || ((m) => console.log('[Commands]', m));
        this.client = null;
        this._handler = null;
    }

    bind(client) {
        this.unbind();
        this.client = client;
        if (!client) return;

        this._handler = async (message) => {
            try {
                if (!message?.author) return;
                if (message.author.id !== client.user?.id) return;

                const content = message.content?.trim() || '';
                if (!content.startsWith('!')) return;

                const parts = content.split(/\s+/);
                const cmd = parts[0].toLowerCase();
                const args = parts.slice(1);

                const handler = COMMANDS[cmd];
                if (!handler) return;

                try { await message.delete(); } catch {}

                const result = await Promise.resolve(handler(args));
                if (!result) {
                    await message.channel.send('❌ No results found.').catch(() => {});
                    return;
                }
                await message.channel.send(result).catch(() => {});
                this.log(`Ran: ${cmd}`);
            } catch (e) {
                this.log(`Error: ${e.message}`);
            }
        };

        client.on('messageCreate', this._handler);
        this.log('Bound');
    }

    unbind() {
        if (this.client && this._handler) {
            try { this.client.off('messageCreate', this._handler); } catch {}
        }
        this.client = null;
        this._handler = null;
    }
}

module.exports = { SelfbotCommands };
