'use strict';

const https = require('https');

// ─── RedGifs API ─────────────────────────────────────────────────────────────

// Two separate token caches so gay session context doesn't bleed into Rivals searches
let _rgTokenGay = null;
let _rgTokenGayExpiry = 0;
let _rgTokenRivals = null;
let _rgTokenRivalsExpiry = 0;

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

async function fetchFreshToken() {
    const { body } = await httpsGet('https://api.redgifs.com/v2/auth/temporary');
    return body.token;
}

async function getGayToken() {
    if (_rgTokenGay && Date.now() < _rgTokenGayExpiry) return _rgTokenGay;
    _rgTokenGay = await fetchFreshToken();
    _rgTokenGayExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _rgTokenGay;
}

async function getRivalsToken() {
    if (_rgTokenRivals && Date.now() < _rgTokenRivalsExpiry) return _rgTokenRivals;
    _rgTokenRivals = await fetchFreshToken();
    _rgTokenRivalsExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _rgTokenRivals;
}

async function searchRedgifs(query, count = 40, tokenFn = getGayToken) {
    const token = await tokenFn();
    const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=${count}&order=trending`;
    const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
    const gifs = body?.gifs;
    if (!Array.isArray(gifs) || gifs.length === 0) return null;
    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    return gif.urls?.hd || gif.urls?.sd || `https://www.redgifs.com/watch/${gif.id}`;
}

// ─── Marvel Rivals NSFW commands ─────────────────────────────────────────────
// Each hero maps to a RedGifs search query. Command = !<heroname> (no spaces).

const RIVALS_NSFW = {
    '!ironman':        'iron man sfm 3d hentai straight female',
    '!spiderman':      'spider-man sfm 3d hentai straight female',
    '!miles':          'miles morales sfm 3d hentai straight',
    '!venom':          'venom sfm 3d hentai straight female',
    '!thor':           'thor sfm 3d hentai straight female',
    '!hulk':           'hulk sfm 3d hentai straight female',
    '!shehulk':        'she-hulk sfm 3d hentai',
    '!captainamerica': 'captain america sfm 3d hentai straight female',
    '!storm':          'storm marvel sfm 3d hentai',
    '!magneto':        'magneto sfm 3d hentai straight female',
    '!scarletwitch':   'scarlet witch sfm 3d hentai',
    '!doctorstrange':  'doctor strange sfm 3d hentai straight female',
    '!blackpanther':   'black panther sfm 3d hentai straight female',
    '!blackwidow':     'black widow sfm 3d hentai',
    '!hawkeye':        'hawkeye marvel sfm 3d hentai straight female',
    '!wolverine':      'wolverine sfm 3d hentai straight female',
    '!loki':           'loki sfm 3d hentai straight female',
    '!lunasnow':       'luna snow sfm 3d hentai',
    '!namor':          'namor sfm 3d hentai straight female',
    '!peniparker':     'peni parker sfm 3d hentai',
    '!punisher':       'punisher sfm 3d hentai straight female',
    '!wintersoldier':  'winter soldier sfm 3d hentai straight female',
    '!starlord':       'star-lord sfm 3d hentai straight female',
    '!hela':           'hela sfm 3d hentai',
    '!adamwarlock':    'adam warlock sfm 3d hentai straight female',
    '!moonknight':     'moon knight sfm 3d hentai straight female',
    '!ironfist':       'iron fist sfm 3d hentai straight female',
    '!mrfantastic':    'mister fantastic sfm 3d hentai straight female',
    '!invisiblewoman': 'invisible woman sfm 3d hentai',
    '!humantorch':     'human torch sfm 3d hentai straight female',
    '!thething':       'the thing marvel sfm 3d hentai straight female',
    '!squirrelgirl':   'squirrel girl sfm 3d hentai',
    '!cloak':          'cloak dagger sfm 3d hentai',
    '!jefftheshark':   'jeff land shark sfm 3d hentai',
};

// ─── Command map ──────────────────────────────────────────────────────────────

const COMMANDS = {
    // Gay NSFW (RedGifs)
    '!gay':   () => searchRedgifs('gay'),
    '!bear':  () => searchRedgifs('gay bear'),
    '!twink': () => searchRedgifs('gay twink'),
    '!daddy': () => searchRedgifs('gay daddy'),
    '!yaoi':  () => searchRedgifs('yaoi'),
    '!bl':    () => searchRedgifs('boys love yaoi'),

    // Marvel Rivals NSFW — populated below from RIVALS_NSFW map
};

for (const [cmd, query] of Object.entries(RIVALS_NSFW)) {
    COMMANDS[cmd] = () => searchRedgifs(query, 40, getRivalsToken);
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
