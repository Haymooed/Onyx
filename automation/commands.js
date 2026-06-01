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
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                ...headers
            }
        };
        const req = https.request(opts, (res) => {
            // Follow redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return httpsGet(res.headers.location, headers).then(resolve).catch(reject);
            }
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

// ─── RedGifs ──────────────────────────────────────────────────────────────────

let _rgToken = null;
let _rgTokenExpiry = 0;

async function getRgToken() {
    if (_rgToken && Date.now() < _rgTokenExpiry) return _rgToken;
    const { body } = await httpsGet('https://api.redgifs.com/v2/auth/temporary');
    _rgToken = body.token;
    _rgTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _rgToken;
}

async function searchRedgifs(query) {
    try {
        const token = await getRgToken();
        const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=40&order=trending`;
        const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
        const gifs = body?.gifs;
        if (!Array.isArray(gifs) || gifs.length === 0) return null;
        const gif = gifs[Math.floor(Math.random() * gifs.length)];
        return gif.urls?.hd || gif.urls?.sd || `https://www.redgifs.com/watch/${gif.id}`;
    } catch (e) {
        console.error('[Commands] RedGifs error:', e.message);
        return null;
    }
}

// ─── Paheal → fxtwitter ───────────────────────────────────────────────────────
// Paheal CDN URLs have no extension so Discord won't embed them.
// But every paheal post has a source= Twitter URL — we convert those to
// fxtwitter.com which Discord embeds natively (video + image).

function toFxTwitter(url) {
    if (!url || typeof url !== 'string') return null;
    return url
        .replace('https://x.com/', 'https://fxtwitter.com/')
        .replace('https://twitter.com/', 'https://fxtwitter.com/')
        .replace('http://x.com/', 'https://fxtwitter.com/')
        .replace('http://twitter.com/', 'https://fxtwitter.com/');
}

async function searchPaheal(tag) {
    try {
        const url = `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=100`;
        const { body } = await httpsGet(url);
        const xml = typeof body === 'string' ? body : '';

        if (!xml.includes('file_url')) return null;

        // Collect (source, file_url) pairs per post
        const posts = [];
        const postRe = /<tag [^>]+>/g;
        let postMatch;
        while ((postMatch = postRe.exec(xml)) !== null) {
            const el = postMatch[0];
            const fu = /file_url=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            const src = /source=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            if (fu || src) posts.push({ file_url: fu, source: src });
        }

        if (posts.length === 0) return null;

        // Shuffle so we don't always get the same post
        const shuffled = posts.sort(() => Math.random() - 0.5);

        // Prefer posts with a Twitter source → convert to fxtwitter
        for (const p of shuffled) {
            const fx = toFxTwitter(p.source);
            if (fx) return fx;
        }

        // Fall back to file_url (Discord may embed if it can infer type)
        for (const p of shuffled) {
            if (p.file_url) return p.file_url;
        }

        return null;
    } catch (e) {
        console.error('[Commands] Paheal error:', e.message);
        return null;
    }
}

// ─── Marvel Rivals hero → paheal tag ─────────────────────────────────────────

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
    '!groot':          'groot',
    '!rocket':         'rocket_raccoon',
    '!mantis':         'mantis_(marvel)',
    '!nebula':         'nebula_(marvel)',
    '!psylocke':       'psylocke',
    '!magik':          'magik_(marvel)',
    '!emma':           'emma_frost',
};

// ─── Command map ──────────────────────────────────────────────────────────────

const COMMANDS = {
    // Debug
    '!test': () => Promise.resolve('✅ Commands are working!'),

    // Gay (RedGifs)
    '!gay':      () => searchRedgifs('gay'),
    '!bear':     () => searchRedgifs('gay bear'),
    '!twink':    () => searchRedgifs('gay twink'),
    '!daddy':    () => searchRedgifs('gay daddy'),
    '!yaoi':     () => searchRedgifs('yaoi'),
    '!bl':       () => searchRedgifs('boys love yaoi'),
    '!frotting': () => searchRedgifs('frotting'),
    '!handjob':  () => searchRedgifs('gay handjob'),
    '!rimjob':   () => searchRedgifs('rimjob'),

    // General NSFW (RedGifs)
    '!cum':      () => searchRedgifs('cumshot'),
    '!abs':      () => searchRedgifs('abs muscle'),
    '!blowjob':  () => searchRedgifs('blowjob'),
    '!anal':     () => searchRedgifs('anal'),
    '!bulge':    () => searchRedgifs('bulge'),
    '!thighs':   () => searchRedgifs('thick thighs'),
    '!boobs':    () => searchRedgifs('big boobs'),
    '!ass':      () => searchRedgifs('big ass'),
    '!feet':     () => searchRedgifs('feet'),
    '!creampie': () => searchRedgifs('creampie'),
    '!moan':     () => searchRedgifs('moaning'),
};

// Marvel Rivals → paheal (fxtwitter embed)
for (const [cmd, tag] of Object.entries(RIVALS_NSFW)) {
    COMMANDS[cmd] = () => searchPaheal(tag);
}

// ─── Handler ──────────────────────────────────────────────────────────────────

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

                const cmd = content.split(/\s+/)[0].toLowerCase();
                const handler = COMMANDS[cmd];
                if (!handler) return;

                this.log(`Handling: ${cmd}`);

                try { await message.delete(); } catch {}

                let result;
                try {
                    result = await handler();
                } catch (e) {
                    this.log(`Handler error (${cmd}): ${e.message}`);
                    result = null;
                }

                if (!result) {
                    await message.channel.send(`❌ No results found for ${cmd}.`).catch(() => {});
                    return;
                }
                await message.channel.send(result).catch((e) => {
                    this.log(`Send error: ${e.message}`);
                });
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
