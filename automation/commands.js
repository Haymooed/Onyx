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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── RedGifs — returns up to `n` URLs ────────────────────────────────────────

let _rgToken = null;
let _rgTokenExpiry = 0;

async function getRgToken() {
    if (_rgToken && Date.now() < _rgTokenExpiry) return _rgToken;
    const { body } = await httpsGet('https://api.redgifs.com/v2/auth/temporary');
    _rgToken = body.token;
    _rgTokenExpiry = Date.now() + 23 * 60 * 60 * 1000;
    return _rgToken;
}

async function searchRedgifs(query, n = 4) {
    try {
        const token = await getRgToken();
        const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=80&order=trending`;
        const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
        const gifs = body?.gifs;
        if (!Array.isArray(gifs) || gifs.length === 0) return [];
        const shuffled = [...gifs].sort(() => Math.random() - 0.5).slice(0, n);
        return shuffled
            .map(g => g.urls?.hd || g.urls?.sd || `https://www.redgifs.com/watch/${g.id}`)
            .filter(Boolean);
    } catch (e) {
        console.error('[Commands] RedGifs error:', e.message);
        return [];
    }
}

// ─── Paheal → fxtwitter — returns up to `n` embeddable URLs ──────────────────

function toFxTwitter(url) {
    if (!url || typeof url !== 'string') return null;
    return url
        .replace('https://x.com/', 'https://fxtwitter.com/')
        .replace('https://twitter.com/', 'https://fxtwitter.com/')
        .replace('http://x.com/', 'https://fxtwitter.com/')
        .replace('http://twitter.com/', 'https://fxtwitter.com/');
}

async function searchPaheal(tag, n = 4) {
    try {
        const url = `https://rule34.paheal.net/api/danbooru/find_posts?tags=${encodeURIComponent(tag)}&limit=100`;
        const { body } = await httpsGet(url);
        const xml = typeof body === 'string' ? body : '';
        if (!xml.includes('file_url')) return [];

        const posts = [];
        const postRe = /<tag [^>]+>/g;
        let m;
        while ((m = postRe.exec(xml)) !== null) {
            const el = m[0];
            const fu  = /file_url=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            const src = /source=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            if (fu || src) posts.push({ file_url: fu, source: src });
        }
        if (posts.length === 0) return [];

        const shuffled = [...posts].sort(() => Math.random() - 0.5);
        const results = [];

        for (const p of shuffled) {
            if (results.length >= n) break;
            const fx = toFxTwitter(p.source);
            if (fx) { results.push(fx); continue; }
            if (p.file_url) results.push(p.file_url);
        }

        return results;
    } catch (e) {
        console.error('[Commands] Paheal error:', e.message);
        return [];
    }
}

// ─── Command list ─────────────────────────────────────────────────────────────

const COMMAND_LIST = `\`\`\`
🔧 UTILITY
!test      — check commands are alive
!commands  — this list

🌈 GAY
!gay  !bear  !twink  !daddy  !yaoi  !bl
!frotting  !handjob  !rimjob  !cum

💦 GENERAL NSFW
!abs  !blowjob  !anal  !bulge  !thighs
!boobs  !ass  !feet  !creampie  !moan

⚔️ MARVEL RIVALS
!ironman     !spiderman   !miles       !venom
!thor        !hulk        !shehulk     !captainamerica
!storm       !magneto     !scarletwitch !doctorstrange
!blackpanther !blackwidow !hawkeye     !wolverine
!loki        !lunasnow    !namor       !peniparker
!punisher    !wintersoldier !starlord  !hela
!adamwarlock !moonknight  !ironfist    !mrfantastic
!invisiblewoman !humantorch !thething  !squirrelgirl
!cloak       !groot       !rocket      !mantis
!nebula      !psylocke    !magik       !emma
\`\`\``;

// ─── Marvel Rivals → paheal tag ───────────────────────────────────────────────

const RIVALS_NSFW = {
    '!ironman':         'iron_man',
    '!spiderman':       'peter_parker',
    '!miles':           'miles_morales',
    '!venom':           'venom_(marvel)',
    '!thor':            'thor_odinson',
    '!hulk':            'hulk',
    '!shehulk':         'she-hulk',
    '!captainamerica':  'captain_america',
    '!storm':           'storm_(marvel)',
    '!magneto':         'magneto',
    '!scarletwitch':    'scarlet_witch',
    '!doctorstrange':   'doctor_strange',
    '!blackpanther':    'black_panther_(marvel)',
    '!blackwidow':      'natasha_romanoff',
    '!hawkeye':         'clint_barton',
    '!wolverine':       'wolverine',
    '!loki':            'loki_laufeyson',
    '!lunasnow':        'luna_snow',
    '!namor':           'namor_(marvel)',
    '!peniparker':      'peni_parker',
    '!punisher':        'frank_castle',
    '!wintersoldier':   'bucky_barnes',
    '!starlord':        'peter_quill',
    '!hela':            'hela_(marvel)',
    '!adamwarlock':     'adam_warlock',
    '!moonknight':      'marc_spector',
    '!ironfist':        'iron_fist_(marvel)',
    '!mrfantastic':     'reed_richards',
    '!invisiblewoman':  'susan_storm',
    '!humantorch':      'johnny_storm',
    '!thething':        'ben_grimm',
    '!squirrelgirl':    'squirrel_girl',
    '!cloak':           'tandy_bowen',
    '!groot':           'groot',
    '!rocket':          'rocket_raccoon',
    '!mantis':          'mantis_(marvel)',
    '!nebula':          'nebula_(marvel)',
    '!psylocke':        'psylocke',
    '!magik':           'magik_(marvel)',
    '!emma':            'emma_frost',
};

// ─── Command map — all handlers return string[] ───────────────────────────────

const COMMANDS = {
    '!test':     async () => ['✅ Commands are working!'],
    '!commands': async () => [COMMAND_LIST],

    // Gay (RedGifs)
    '!gay':      () => searchRedgifs('gay'),
    '!bear':     () => searchRedgifs('gay bear'),
    '!twink':    () => searchRedgifs('gay twink'),
    '!daddy':    () => searchRedgifs('gay daddy'),
    '!yaoi':     () => searchRedgifs('yaoi'),
    '!bl':       () => searchRedgifs('boys love yaoi'),
    '!frotting': () => searchRedgifs('frotting gay'),
    '!handjob':  () => searchRedgifs('gay handjob'),
    '!rimjob':   () => searchRedgifs('gay rimjob'),
    '!cum':      () => searchRedgifs('gay cumshot cumming'),

    // General NSFW (RedGifs)
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

// Marvel Rivals → paheal (4 fxtwitter links)
for (const [cmd, tag] of Object.entries(RIVALS_NSFW)) {
    COMMANDS[cmd] = () => searchPaheal(tag, 4);
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

                let results;
                try {
                    results = await handler();
                } catch (e) {
                    this.log(`Handler error (${cmd}): ${e.message}`);
                    results = [];
                }

                if (!results || results.length === 0) {
                    await message.channel.send(`❌ No results for ${cmd}.`).catch(() => {});
                    return;
                }

                for (const r of results) {
                    await message.channel.send(r).catch(e => this.log(`Send error: ${e.message}`));
                    await sleep(400);
                }
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
