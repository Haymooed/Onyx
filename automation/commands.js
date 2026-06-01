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
function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

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

async function searchRedgifs(query, n = 4) {
    try {
        const token = await getRgToken();
        const url = `https://api.redgifs.com/v2/gifs/search?search_text=${encodeURIComponent(query)}&count=80&order=trending`;
        const { body } = await httpsGet(url, { Authorization: `Bearer ${token}` });
        const gifs = body?.gifs;
        if (!Array.isArray(gifs) || gifs.length === 0) return [];
        return [...gifs].sort(() => Math.random() - 0.5).slice(0, n)
            .map(g => g.urls?.hd || g.urls?.sd || `https://www.redgifs.com/watch/${g.id}`)
            .filter(Boolean);
    } catch (e) {
        console.error('[Commands] RedGifs error:', e.message);
        return [];
    }
}

// ─── Paheal with RedGifs fallback ─────────────────────────────────────────────

function toFxTwitter(url) {
    if (!url) return null;
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
        const re = /<tag [^>]+>/g;
        let m;
        while ((m = re.exec(xml)) !== null) {
            const el = m[0];
            const fu  = /file_url=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            const src = /source=['"]([^'"]+)['"]/.exec(el)?.[1] || null;
            if (fu || src) posts.push({ file_url: fu, source: src });
        }
        if (posts.length === 0) return [];

        const results = [];
        for (const p of [...posts].sort(() => Math.random() - 0.5)) {
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

// Tries paheal first, falls back to RedGifs if not enough results
async function searchRivals(pahealTag, rgFallback, n = 4) {
    const paheal = await searchPaheal(pahealTag, n);
    if (paheal.length >= 2) return paheal;
    const rg = await searchRedgifs(rgFallback, n - paheal.length);
    return [...paheal, ...rg].slice(0, n);
}

// ─── Fun command helpers ──────────────────────────────────────────────────────

const EIGHT_BALL = [
    'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes definitely.',
    'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
    'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
    'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
    "Don't count on it.", 'My reply is no.', 'My sources say no.',
    'Outlook not so good.', 'Very doubtful.',
];

const ROASTS = [
    "You're the reason they put instructions on shampoo.",
    "I'd agree with you but then we'd both be wrong.",
    "You have your whole life to be an idiot. Why not take today off?",
    "I've seen better heads on a pimple.",
    "You're like a cloud — when you disappear, it's a beautiful day.",
    "Somewhere out there is a tree, tirelessly producing oxygen for you. You owe that tree an apology.",
    "I'd insult you, but you wouldn't get it.",
    "You're not stupid, you just have bad luck thinking.",
    "You're proof that evolution can go in reverse.",
    "Even Google can't find your intelligence.",
];

const COMPLIMENTS = [
    'You absolutely radiate main character energy. 💫',
    'Honestly? Built different fr fr. 🔥',
    'The drip is immaculate today. 👑',
    "You're the reason this server stays alive.",
    'Goated with the sauce, no cap.',
    "If loyalty had a face, it'd be yours.",
    'You could make anyone's day better just by existing.',
    "Sharp as a tack and twice as cool.",
];

const FACTS = [
    'Honey never spoils. Archaeologists found 3000-year-old honey in Egyptian tombs and it was still edible.',
    'Crows can recognize and remember human faces.',
    'The Eiffel Tower grows about 6 inches taller in summer due to thermal expansion.',
    'A group of flamingos is called a flamboyance.',
    'Octopuses have three hearts, blue blood, and nine brains.',
    'Cleopatra lived closer in time to the Moon landing than to the construction of the Great Pyramid.',
    'A day on Venus is longer than a year on Venus.',
    'Sharks are older than trees.',
    'The word "nerd" was first coined by Dr. Seuss in 1950.',
    'There are more possible games of chess than atoms in the observable universe.',
];

const JOKES = [
    'Why don\'t scientists trust atoms? Because they make up everything.',
    'I told my wife she was drawing her eyebrows too high. She looked surprised.',
    'Why don\'t eggs tell jokes? They\'d crack each other up.',
    'What do you call a fake noodle? An impasta.',
    'I used to hate facial hair, but then it grew on me.',
    'Why did the scarecrow win an award? Because he was outstanding in his field.',
    'I\'m reading a book about anti-gravity. It\'s impossible to put down.',
    'What do you call cheese that isn\'t yours? Nacho cheese.',
    'Why did the bicycle fall over? Because it was two-tired.',
    'What\'s a computer\'s favorite snack? Microchips.',
];

const DARES = [
    'Text someone "I know what you did" and don\'t respond for an hour.',
    'Change your status to "crying in the club" for 30 minutes.',
    'Send the last meme in your camera roll to someone random.',
    'Go 10 messages using only emojis.',
    'Speak in third person for the next 5 minutes.',
    'Send your most embarrassing screenshot to the chat.',
    'Change your nickname to "Wet Sock" for an hour.',
    'Quote tweet the most unhinged thing you can find.',
];

const TRUTHS = [
    'What\'s the most embarrassing thing in your search history?',
    'What\'s something you\'ve lied about to impress someone?',
    'Who\'s the last person you stalked on social media?',
    'What\'s the pettiest thing you\'ve ever done?',
    'What\'s the most cringe thing you did as a kid?',
    'Have you ever faked being sick to avoid someone?',
    'What\'s the longest you\'ve gone without showering?',
    'What\'s something you pretend to like but actually hate?',
];

function uwuify(text) {
    return text
        .replace(/r|l/g, 'w')
        .replace(/R|L/g, 'W')
        .replace(/n([aeiou])/g, 'ny$1')
        .replace(/N([aeiou])/g, 'Ny$1')
        .replace(/ove/g, 'uv')
        .replace(/!+/g, ' uwu!')
        .replace(/\?+/g, ' owo?')
        + ' :3';
}

function mockify(text) {
    return [...text].map((c, i) => i % 2 === 0 ? c.toLowerCase() : c.toUpperCase()).join('');
}

// ─── Marvel Rivals map (paheal tag, redgifs fallback) ─────────────────────────

const RIVALS_NSFW = {
    '!ironman':        ['iron_man',                'iron man hentai sfm'],
    '!spiderman':      ['peter_parker',            'spider-man hentai sfm'],
    '!miles':          ['miles_morales',           'miles morales hentai'],
    '!venom':          ['venom_(marvel)',           'venom hentai sfm'],
    '!thor':           ['thor_odinson',            'thor hentai sfm'],
    '!hulk':           ['hulk',                    'hulk hentai sfm'],
    '!shehulk':        ['she-hulk',                'she-hulk hentai'],
    '!captainamerica': ['captain_america',         'captain america hentai sfm'],
    '!storm':          ['storm_(marvel)',           'storm marvel hentai'],
    '!magneto':        ['magneto',                 'magneto hentai sfm'],
    '!scarletwitch':   ['scarlet_witch',           'scarlet witch hentai sfm'],
    '!doctorstrange':  ['doctor_strange',          'doctor strange hentai sfm'],
    '!blackpanther':   ['black_panther_(marvel)',  'black panther hentai sfm'],
    '!blackwidow':     ['natasha_romanoff',        'black widow hentai sfm'],
    '!hawkeye':        ['clint_barton',            'hawkeye hentai sfm'],
    '!wolverine':      ['wolverine',               'wolverine hentai sfm'],
    '!loki':           ['loki_laufeyson',          'loki hentai sfm'],
    '!lunasnow':       ['luna_snow',               'luna snow hentai'],
    '!namor':          ['namor_(marvel)',           'namor hentai sfm'],
    '!peniparker':     ['peni_parker',             'peni parker hentai'],
    '!punisher':       ['frank_castle',            'punisher hentai sfm'],
    '!wintersoldier':  ['bucky_barnes',            'winter soldier hentai sfm'],
    '!starlord':       ['peter_quill',             'star lord hentai sfm'],
    '!hela':           ['hela_(marvel)',           'hela marvel hentai'],
    '!adamwarlock':    ['adam_warlock',            'adam warlock hentai'],
    '!moonknight':     ['marc_spector',            'moon knight hentai sfm'],
    '!ironfist':       ['iron_fist_(marvel)',      'iron fist marvel hentai sfm'],
    '!mrfantastic':    ['reed_richards',           'mister fantastic hentai'],
    '!invisiblewoman': ['susan_storm',             'invisible woman hentai sfm'],
    '!humantorch':     ['johnny_storm',            'human torch hentai'],
    '!thething':       ['ben_grimm',               'the thing marvel hentai'],
    '!squirrelgirl':   ['squirrel_girl',           'squirrel girl hentai'],
    '!cloak':          ['tandy_bowen',             'cloak dagger hentai'],
    '!groot':          ['groot',                   'groot hentai sfm'],
    '!rocket':         ['rocket_raccoon',          'rocket raccoon hentai'],
    '!mantis':         ['mantis_(marvel)',         'mantis marvel hentai'],
    '!nebula':         ['nebula_(marvel)',         'nebula marvel hentai'],
    '!psylocke':       ['psylocke',               'psylocke hentai sfm'],
    '!magik':          ['magik_(marvel)',          'magik marvel hentai'],
    '!emma':           ['emma_frost',             'emma frost hentai sfm'],
};

// ─── Command list string ──────────────────────────────────────────────────────

const COMMAND_LIST = `\`\`\`
🔧  UTILITY
!test · !commands · !ping · !coin · !dice · !rps

🎉  FUN
!8ball <q> · !ship · !rate <thing>
!roast · !compliment · !joke · !fact
!dare · !truth · !mock <text> · !uwu <text>
!clap <text> · !hug · !slap · !bonk

🌈  GAY NSFW
!gay · !bear · !twink · !daddy · !yaoi · !bl
!frotting · !handjob · !rimjob · !cum

💦  GENERAL NSFW
!abs · !blowjob · !anal · !bulge
!thighs · !boobs · !ass · !feet · !creampie · !moan

⚔️  MARVEL RIVALS (4 images each)
!ironman · !spiderman · !miles · !venom
!thor · !hulk · !shehulk · !captainamerica
!storm · !magneto · !scarletwitch · !doctorstrange
!blackpanther · !blackwidow · !hawkeye · !wolverine
!loki · !lunasnow · !namor · !peniparker
!punisher · !wintersoldier · !starlord · !hela
!adamwarlock · !moonknight · !ironfist · !mrfantastic
!invisiblewoman · !humantorch · !thething · !squirrelgirl
!cloak · !groot · !rocket · !mantis
!nebula · !psylocke · !magik · !emma
\`\`\``;

// ─── Command map — handlers receive (message, client), return string[] ─────────

const COMMANDS = {
    // Utility
    '!test':     async () => ['✅ Commands are working!'],
    '!commands': async () => [COMMAND_LIST],
    '!ping':     async (msg) => [`🏓 Pong! \`${Date.now() - msg.createdTimestamp}ms\``],
    '!coin':     async () => [Math.random() < 0.5 ? '🪙 **Heads!**' : '🪙 **Tails!**'],
    '!dice':     async (msg) => {
        const n = parseInt(msg.content.split(/\s+/)[1]) || 6;
        const sides = Math.min(Math.max(n, 2), 100);
        const roll = Math.floor(Math.random() * sides) + 1;
        return [`🎲 Rolled a d${sides}: **${roll}**`];
    },
    '!rps': async (msg) => {
        const choices = ['🪨 Rock', '📄 Paper', '✂️ Scissors'];
        const bot = pick(choices);
        const user = msg.content.split(/\s+/)[1]?.toLowerCase();
        const map = { rock: 0, paper: 1, scissors: 2, r: 0, p: 1, s: 2 };
        const ui = map[user];
        if (ui === undefined) return [`I chose **${bot}** — use \`!rps rock/paper/scissors\``];
        const diff = (ui - choices.indexOf(bot) + 3) % 3;
        const outcome = diff === 0 ? "It's a tie!" : diff === 1 ? 'You win! 🎉' : 'I win! 😈';
        return [`You: **${choices[ui]}** vs Me: **${bot}** — ${outcome}`];
    },

    // Fun
    '!8ball': async (msg) => {
        const q = msg.content.replace('!8ball', '').trim();
        if (!q) return ['🎱 Ask me a question!'];
        return [`🎱 *${q}* → **${pick(EIGHT_BALL)}**`];
    },
    '!ship': async (msg) => {
        const parts = msg.content.split(/\s+/).slice(1);
        if (parts.length < 2) return ['💘 Usage: `!ship name1 name2`'];
        const pct = Math.floor(Math.random() * 101);
        const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
        return [`💘 **${parts[0]}** + **${parts[1]}** = **${pct}%** compatible\n\`[${bar}]\``];
    },
    '!rate': async (msg) => {
        const thing = msg.content.replace('!rate', '').trim() || 'that';
        const score = Math.floor(Math.random() * 11);
        return [`📊 I rate **${thing}** a **${score}/10**`];
    },
    '!roast':      async () => [pick(ROASTS)],
    '!compliment': async () => [pick(COMPLIMENTS)],
    '!joke':       async () => [pick(JOKES)],
    '!fact':       async () => [`💡 ${pick(FACTS)}`],
    '!dare':       async () => [`😈 **Dare:** ${pick(DARES)}`],
    '!truth':      async () => [`👀 **Truth:** ${pick(TRUTHS)}`],
    '!mock': async (msg) => {
        const text = msg.content.replace('!mock', '').trim();
        if (!text) return ['Usage: `!mock <text>`'];
        return [mockify(text)];
    },
    '!uwu': async (msg) => {
        const text = msg.content.replace('!uwu', '').trim();
        if (!text) return ['Usage: `!uwu <text>`'];
        return [uwuify(text)];
    },
    '!clap': async (msg) => {
        const text = msg.content.replace('!clap', '').trim();
        if (!text) return ['Usage: `!clap <text>`'];
        return [text.split(' ').join(' 👏 ')];
    },
    '!hug':  async (msg) => {
        const target = msg.content.split(/\s+/)[1] || 'everyone';
        return [pick([`*hugs ${target} tightly* 🤗`, `*gives ${target} a big squeeze* 💗`, `${target} has been hugged 🫂`])];
    },
    '!slap': async (msg) => {
        const target = msg.content.split(/\s+/)[1] || 'someone';
        return [pick([`*slaps ${target} with a fish* 🐟`, `*roundhouse slaps ${target}* 💥`, `${target} has been bonked 😵`])];
    },
    '!bonk': async (msg) => {
        const target = msg.content.split(/\s+/)[1] || 'them';
        return [`*bonks ${target} on the head* 🔨 NO HORNY JAIL FOR YOU`];
    },

    // Gay NSFW (RedGifs)
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

// Marvel Rivals → paheal + RedGifs fallback
for (const [cmd, [pahealTag, rgFallback]] of Object.entries(RIVALS_NSFW)) {
    COMMANDS[cmd] = () => searchRivals(pahealTag, rgFallback, 4);
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
                    results = await handler(message, client);
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
