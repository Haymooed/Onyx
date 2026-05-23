'use strict';

const crypto = require('crypto');

// Key format:  ONYX-TTTT-EEEE-RRRR-CCCCCCCC
//   TTTT = tier code  (LIFE | YEAR | MONT | TRIA)
//   EEEE = hex days since Unix epoch at expiry, or 0000 for lifetime
//   RRRR = 4 random hex chars (salt)
//   CCCCCCCC = first 8 chars of HMAC-SHA256(secret, TTTT+EEEE+RRRR)

const TIER_CODES = {
    lifetime: 'LIFE',
    yearly:   'YEAR',
    monthly:  'MONT',
    trial:    'TRIA'
};

const TIER_NAMES = {
    LIFE: 'Lifetime',
    YEAR: '1 Year',
    MONT: '1 Month',
    TRIA: 'Trial (7 days)'
};

const TIER_DAYS = {
    YEAR: 365,
    MONT: 30,
    TRIA: 7
};

function getSecret() {
    return process.env.LICENSE_SECRET || null;
}

function generateKey(tier = 'lifetime') {
    const secret = getSecret();
    if (!secret) throw new Error('LICENSE_SECRET env var not set');

    const tierCode = TIER_CODES[tier] || 'LIFE';

    let expiryCode = '0000';
    let expiresAt = null;

    if (tierCode !== 'LIFE') {
        const days = TIER_DAYS[tierCode] || 30;
        expiresAt = new Date(Date.now() + days * 86400000);
        const daysSinceEpoch = Math.floor(expiresAt.getTime() / 86400000);
        expiryCode = daysSinceEpoch.toString(16).toUpperCase().padStart(4, '0');
    }

    const rand = crypto.randomBytes(2).toString('hex').toUpperCase();
    const payload = `${tierCode}${expiryCode}${rand}`;
    const checksum = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 8).toUpperCase();

    return {
        key: `ONYX-${tierCode}-${expiryCode}-${rand}-${checksum}`,
        tier: TIER_NAMES[tierCode],
        expiresAt: expiresAt?.toISOString() || null
    };
}

function validateKey(key) {
    if (!key || typeof key !== 'string') return { valid: false, error: 'No key provided' };

    const secret = getSecret();
    if (!secret) return { valid: true, tier: 'Dev Mode', tierCode: 'LIFE', expiresAt: null, daysLeft: null, key: 'dev' };

    const clean = key.trim().toUpperCase().replace(/\s/g, '');
    const match = clean.match(/^ONYX-([A-Z]{4})-([0-9A-F]{4})-([0-9A-F]{4})-([0-9A-F]{8})$/);
    if (!match) return { valid: false, error: 'Invalid key format' };

    const [, tierCode, expiryCode, rand, checksum] = match;

    if (!TIER_NAMES[tierCode]) return { valid: false, error: 'Unknown tier code' };

    const payload = `${tierCode}${expiryCode}${rand}`;
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex').slice(0, 8).toUpperCase();

    if (checksum !== expected) return { valid: false, error: 'Invalid key — signature mismatch' };

    let expiresAt = null;
    let daysLeft = null;
    let expired = false;

    if (expiryCode !== '0000') {
        const daysSinceEpoch = parseInt(expiryCode, 16);
        expiresAt = new Date(daysSinceEpoch * 86400000);
        expired = Date.now() > expiresAt.getTime();
        if (!expired) daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000);
    }

    return {
        valid: !expired,
        expired,
        tier: TIER_NAMES[tierCode],
        tierCode,
        expiresAt: expiresAt?.toISOString() || null,
        daysLeft,
        key: clean
    };
}

module.exports = { generateKey, validateKey, TIER_CODES, TIER_NAMES, getSecret };
