'use strict';

// Curated spoof presets. `appId` = Discord verified application_id so the game
// shows with the proper icon in the user's profile. Where official Discord-verified
// IDs aren't available, the app falls back to plain "Playing <name>".
const GAMES = [
    { id: 'minecraft',    name: 'Minecraft',           appId: '1402418491272986635', icon: 'https://cdn.discordapp.com/app-icons/1402418491272986635/166fbad351ecdd02d11a3b464748f66b.png?size=240' },
    { id: 'genshin',      name: 'Genshin Impact',      appId: '762434991303950386',  icon: 'https://cdn.discordapp.com/app-icons/762434991303950386/eb0e25b739e4fa38c1671a3d1edcd1e0.png?size=240' },
    { id: 'valorant',     name: 'VALORANT',            appId: '700136079562375258' },
    { id: 'league',       name: 'League of Legends',   appId: '401518684763586560' },
    { id: 'cs2',          name: 'Counter-Strike 2',    appId: '1147034201275125760' },
    { id: 'fortnite',     name: 'Fortnite',            appId: '432980957394370572' },
    { id: 'apex',         name: 'Apex Legends',        appId: '542951265862746131' },
    { id: 'gta5',         name: 'Grand Theft Auto V',  appId: '356875221078245376' },
    { id: 'roblox',       name: 'Roblox',              appId: '363445589247131668' },
    { id: 'rocketleague', name: 'Rocket League',       appId: '356877880938070016' },
    { id: 'rust',         name: 'Rust',                appId: '356875057232052226' },
    { id: 'overwatch',    name: 'Overwatch 2',         appId: '1085686298337349673' },
    { id: 'eldenring',    name: 'ELDEN RING',          appId: '1107733904515977267' },
    { id: 'rivals',       name: 'Marvel Rivals',       appId: '1310261445354881044' },
    { id: 'palworld',     name: 'Palworld',            appId: '1199156524316831826' },
    { id: 'pubg',         name: 'PUBG: BATTLEGROUNDS', appId: '530196305138417685' },
    { id: 'tarkov',       name: 'Escape from Tarkov',  appId: '524880104675311618' },
    { id: 'wow',          name: 'World of Warcraft',   appId: '356876019614253059' },
    { id: 'dota2',        name: 'Dota 2',              appId: '356877880938070016' },
    { id: 'tf2',          name: 'Team Fortress 2',     appId: '440011176109015041' },
    { id: 'osu',          name: 'osu!',                appId: '367827983903490050' },
    { id: 'amongus',      name: 'Among Us',            appId: '477175586805252107' },
    { id: 'fall_guys',    name: 'Fall Guys',           appId: '742887361628340234' },
    { id: 'terraria',     name: 'Terraria',            appId: '356875221078245376' },
    { id: 'stardew',      name: 'Stardew Valley',      appId: '383941910670082058' },
    { id: 'doom',         name: 'DOOM Eternal',        appId: '676919133022388234' }
];

const APPS = [
    { id: 'spotify',      name: 'Spotify',             appId: '383226320970055681' },
    { id: 'crunchyroll',  name: 'Crunchyroll',         appId: '981509069309354054' },
    { id: 'netflix',      name: 'Netflix',             appId: '926541425682829352' },
    { id: 'youtube',      name: 'YouTube',             appId: '463097721130188830' },
    { id: 'twitch',       name: 'Twitch',              appId: '802958789555781663' },
    { id: 'vscode',       name: 'Visual Studio Code',  appId: '383226320970055681' },
    { id: 'tiktok',       name: 'TikTok',              appId: '1118503961864937522' },
    { id: 'apple_music',  name: 'Apple Music',         appId: '773825528921849856' }
];

const PLATFORMS = [
    { id: 'playstation',  name: 'PlayStation 5', appId: '1008890872156405890', platform: 'ps5' },
    { id: 'playstation4', name: 'PlayStation 4', appId: '1008890872156405890', platform: 'ps4' },
    { id: 'xbox',         name: 'Xbox',          appId: '438122941302046720',  platform: 'xbox' },
    { id: 'switch',       name: 'Nintendo Switch', appId: '1351431990672101376' }
];

function findGame(id) {
    return GAMES.find(g => g.id === id);
}

function findApp(id) {
    return APPS.find(a => a.id === id);
}

function findPlatform(id) {
    return PLATFORMS.find(p => p.id === id);
}

module.exports = { GAMES, APPS, PLATFORMS, findGame, findApp, findPlatform };
