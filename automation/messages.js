'use strict';

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = (() => {
    try { return require('uuid'); } catch { return { v4: () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) }; }
})();

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'messages.json');

function ensureDir() {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
    ensureDir();
    if (!fs.existsSync(FILE)) return { scheduled: [], recurring: [] };
    try {
        const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
        return {
            scheduled: Array.isArray(data.scheduled) ? data.scheduled : [],
            recurring: Array.isArray(data.recurring) ? data.recurring : []
        };
    } catch {
        return { scheduled: [], recurring: [] };
    }
}

function save(data) {
    ensureDir();
    fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

function unitToMs(value, unit) {
    const n = Number(value);
    if (!isFinite(n) || n <= 0) return 0;
    switch ((unit || '').toLowerCase()) {
        case 'second': case 'seconds': case 's': return n * 1000;
        case 'minute': case 'minutes': case 'm': return n * 60_000;
        case 'hour':   case 'hours':   case 'h': return n * 3_600_000;
        case 'day':    case 'days':    case 'd': return n * 86_400_000;
        default: return 0;
    }
}

class MessageScheduler {
    constructor(getClient, log) {
        this.getClient = getClient;
        this.log = log || ((m) => console.log('[Messages]', m));
        this.timers = new Map();   // scheduledId -> Timeout
        this.intervals = new Map(); // recurringId  -> Interval
    }

    async _resolveTarget(client, targetId) {
        if (!client) throw new Error('Discord client not connected');
        const channel = await client.channels.fetch(targetId).catch(() => null);
        if (channel && typeof channel.send === 'function') return channel;
        const user = await client.users.fetch(targetId).catch(() => null);
        if (user && typeof user.send === 'function') return user;
        throw new Error(`Target ${targetId} not found (channel or user)`);
    }

    async _send(targetId, content) {
        const client = this.getClient();
        const target = await this._resolveTarget(client, targetId);
        await target.send(content);
    }

    list() {
        return load();
    }

    addScheduled({ targetId, message, runAt }) {
        if (!targetId || !message || !runAt) throw new Error('targetId, message, runAt required');
        const ts = new Date(runAt).getTime();
        if (!isFinite(ts)) throw new Error('Invalid runAt');

        const data = load();
        const entry = {
            id: uuidv4(),
            targetId: String(targetId),
            message: String(message),
            runAt: ts,
            createdAt: Date.now()
        };
        data.scheduled.push(entry);
        save(data);
        this._armScheduled(entry);
        this.log(`Scheduled message ${entry.id} for ${new Date(ts).toISOString()}`);
        return entry;
    }

    removeScheduled(id) {
        const data = load();
        data.scheduled = data.scheduled.filter(e => e.id !== id);
        save(data);
        const t = this.timers.get(id);
        if (t) { clearTimeout(t); this.timers.delete(id); }
    }

    addRecurring({ targetId, message, interval, unit }) {
        if (!targetId || !message) throw new Error('targetId, message required');
        const ms = unitToMs(interval, unit);
        if (ms < 1000) throw new Error('Interval must be at least 1 second');

        const data = load();
        const entry = {
            id: uuidv4(),
            targetId: String(targetId),
            message: String(message),
            interval: Number(interval),
            unit: String(unit || 'minute'),
            ms,
            createdAt: Date.now()
        };
        data.recurring.push(entry);
        save(data);
        this._armRecurring(entry);
        this.log(`Recurring message ${entry.id} every ${interval} ${unit}`);
        return entry;
    }

    removeRecurring(id) {
        const data = load();
        data.recurring = data.recurring.filter(e => e.id !== id);
        save(data);
        const i = this.intervals.get(id);
        if (i) { clearInterval(i); this.intervals.delete(id); }
    }

    _armScheduled(entry) {
        const delay = entry.runAt - Date.now();
        if (delay <= 0) {
            this._send(entry.targetId, entry.message)
                .then(() => this.log(`Sent scheduled ${entry.id}`))
                .catch(e => this.log(`Scheduled ${entry.id} failed: ${e.message}`))
                .finally(() => this.removeScheduled(entry.id));
            return;
        }
        const t = setTimeout(() => {
            this._send(entry.targetId, entry.message)
                .then(() => this.log(`Sent scheduled ${entry.id}`))
                .catch(e => this.log(`Scheduled ${entry.id} failed: ${e.message}`))
                .finally(() => this.removeScheduled(entry.id));
        }, Math.min(delay, 2_147_000_000));
        this.timers.set(entry.id, t);
    }

    _armRecurring(entry) {
        const i = setInterval(() => {
            this._send(entry.targetId, entry.message)
                .then(() => this.log(`Sent recurring ${entry.id}`))
                .catch(e => this.log(`Recurring ${entry.id} failed: ${e.message}`));
        }, entry.ms);
        this.intervals.set(entry.id, i);
    }

    initialize() {
        for (const [, t] of this.timers) clearTimeout(t);
        for (const [, i] of this.intervals) clearInterval(i);
        this.timers.clear();
        this.intervals.clear();

        const data = load();
        // Drop expired scheduled entries
        const now = Date.now();
        data.scheduled = data.scheduled.filter(e => e.runAt > now - 5000);
        save(data);

        for (const e of data.scheduled) this._armScheduled(e);
        for (const e of data.recurring) this._armRecurring(e);
        this.log(`Restored ${data.scheduled.length} scheduled, ${data.recurring.length} recurring`);
    }

    stop() {
        for (const [, t] of this.timers) clearTimeout(t);
        for (const [, i] of this.intervals) clearInterval(i);
        this.timers.clear();
        this.intervals.clear();
    }
}

module.exports = { MessageScheduler };
