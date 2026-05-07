'use strict';

// One-shot utility actions: purge own messages, send DM, send channel message.
async function resolveTarget(client, targetId) {
    const ch = await client.channels.fetch(targetId).catch(() => null);
    if (ch && typeof ch.send === 'function') return ch;
    const u = await client.users.fetch(targetId).catch(() => null);
    if (u && typeof u.send === 'function') return u;
    throw new Error(`Target ${targetId} not found`);
}

async function purgeOwn(client, channelId, count) {
    const n = Math.max(1, Math.min(100, parseInt(count, 10) || 0));
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || typeof channel.messages?.fetch !== 'function') {
        throw new Error('Channel not found or not text-based');
    }
    const fetched = await channel.messages.fetch({ limit: 100 });
    const own = [...fetched.values()].filter(m => m.author?.id === client.user.id).slice(0, n);
    let deleted = 0;
    for (const m of own) {
        try { await m.delete(); deleted++; } catch {}
        await new Promise(r => setTimeout(r, 750));
    }
    return deleted;
}

async function sendTo(client, targetId, message) {
    const t = await resolveTarget(client, targetId);
    await t.send(String(message));
}

async function massDm(client, ids, message, delayMs = 1500) {
    const out = { sent: 0, failed: 0, errors: [] };
    for (const id of ids) {
        try {
            const u = await client.users.fetch(String(id).trim()).catch(() => null);
            if (!u) throw new Error('user not found');
            await u.send(String(message));
            out.sent++;
        } catch (e) {
            out.failed++;
            out.errors.push({ id, error: e.message });
        }
        await new Promise(r => setTimeout(r, delayMs));
    }
    return out;
}

module.exports = { purgeOwn, sendTo, massDm };
