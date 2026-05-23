#!/usr/bin/env node
'use strict';

// Usage:
//   node scripts/keygen.js              → generates a Lifetime key
//   node scripts/keygen.js yearly       → generates a 1-Year key
//   node scripts/keygen.js monthly      → generates a 1-Month key
//   node scripts/keygen.js trial        → generates a 7-day trial key
//   node scripts/keygen.js bulk 10      → generates 10 Lifetime keys
//   node scripts/keygen.js bulk 5 yearly→ generates 5 Yearly keys

try { require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') }); } catch {}

const { generateKey, getSecret } = require('../lib/license');

const args = process.argv.slice(2);
const isBulk = args[0] === 'bulk';
const tier = isBulk ? (args[2] || 'lifetime') : (args[0] || 'lifetime');
const count = isBulk ? (parseInt(args[1]) || 1) : 1;

const VALID_TIERS = ['lifetime', 'yearly', 'monthly', 'trial'];
if (!VALID_TIERS.includes(tier)) {
    console.error(`Invalid tier "${tier}". Choose: ${VALID_TIERS.join(', ')}`);
    process.exit(1);
}

if (!getSecret()) {
    console.error('ERROR: LICENSE_SECRET is not set in your .env file.');
    console.error('Add this to .env:  LICENSE_SECRET=your-long-random-secret-here');
    process.exit(1);
}

console.log(`\n  Onyx Key Generator — ${tier.toUpperCase()}\n`);
console.log('─'.repeat(52));

for (let i = 0; i < count; i++) {
    const result = generateKey(tier);
    console.log(`  Key      : ${result.key}`);
    console.log(`  Tier     : ${result.tier}`);
    console.log(`  Expires  : ${result.expiresAt ? new Date(result.expiresAt).toDateString() : 'Never (Lifetime)'}`);
    if (count > 1 && i < count - 1) console.log('  ·  ·  ·');
}

console.log('─'.repeat(52));
console.log(`  ${count} key(s) generated\n`);
