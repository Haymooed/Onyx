'use strict';

const https = require('https');

// ─── RedGifs API ─────────────────────────────────────────────────────────────

let _rgToken = null;
let _rgTokenExpiry = 0;

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

async function getRgToken() {
    if (_rgToken && Date.now() < _rgTokenExpiry) return _rgToken;
    const { body } = await httpsGet('https://api.redgifs.com/v2/auth/temporary');
    _rgToken = body.token;
    _rgTokenExpiry = Date.now() + 23 * 60 * 60 * 1000; // 23h
    return _rgToken;
}

async function searchRedgifs(query, count = 40) {
    const token = await getRgToken();
    const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=${count}&order=trending`;
    const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
    const gifs = body?.gifs;
    if (!Array.isArray(gifs) || gifs.length === 0) return null;
    const gif = gifs[Math.floor(Math.random() * gifs.length)];
    // prefer hd URL, fall back to sd, then page link
    return gif.urls?.hd || gif.urls?.sd || `https://www.redgifs.com/watch/${gif.id}`;
}

// ─── Marvel Rivals NSFW commands ─────────────────────────────────────────────
// Each hero maps to a RedGifs search query. Command = !<heroname> (no spaces).

const RIVALS_NSFW = {
    '!ironman':        'iron man marvel rule34',
    '!spiderman':      'spider-man marvel rule34',
    '!miles':          'miles morales rule34',
    '!venom':          'venom marvel rule34',
    '!thor':           'thor marvel rule34',
    '!hulk':           'hulk marvel rule34',
    '!shehulk':        'she-hulk rule34',
    '!captainamerica': 'captain america rule34',
    '!storm':          'storm marvel rule34',
    '!magneto':        'magneto marvel rule34',
    '!scarletwitch':   'scarlet witch rule34',
    '!doctorstrange':  'doctor strange rule34',
    '!blackpanther':   'black panther marvel rule34',
    '!blackwidow':     'black widow rule34',
    '!hawkeye':        'hawkeye marvel rule34',
    '!wolverine':      'wolverine rule34',
    '!loki':           'loki marvel rule34',
    '!lunasnow':       'luna snow rule34',
    '!namor':          'namor rule34',
    '!peniparker':     'peni parker rule34',
    '!punisher':       'punisher marvel rule34',
    '!wintersoldier':  'winter soldier bucky rule34',
    '!starlord':       'star-lord peter quill rule34',
    '!hela':           'hela marvel rule34',
    '!adamwarlock':    'adam warlock rule34',
    '!moonknight':     'moon knight rule34',
    '!ironfist':       'iron fist marvel rule34',
    '!mrfantastic':    'mister fantastic rule34',
    '!invisiblewoman': 'invisible woman rule34',
    '!humantorch':     'human torch rule34',
    '!thething':       'the thing marvel rule34',
    '!squirrelgirl':   'squirrel girl rule34',
    '!cloak':          'cloak dagger marvel rule34',
    '!jefftheshark':   'jeff the land shark rule34',
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
    COMMANDS[cmd] = () => searchRedgifs(query);
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
