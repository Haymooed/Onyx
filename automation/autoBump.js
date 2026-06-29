'use strict';

const fs = require('fs');
const path = require('path');
const DISBOARD_ID = '302050872383242240';
const PERSISTENCE_PATH = path.join(__dirname, '..', 'data', 'persistence.json');

class AutoBump {
    constructor() {
        this.enabled = false;
        this.log = [];
        this.nextBumpAt = null;
        this.timer = null;
        this._listener = null;
        this._client = null;
        this._lastChannelId = null;
    }

    _loadPersistence() {
        try {
            if (fs.existsSync(PERSISTENCE_PATH)) {
                const data = JSON.parse(fs.readFileSync(PERSISTENCE_PATH, 'utf8'));
                return data.autoBump || {};
            }
        } catch (e) {
            console.error('[AutoBump] Load persistence error:', e.message);
        }
        return {};
    }

    _savePersistence(data) {
        try {
            let fullData = {};
            if (fs.existsSync(PERSISTENCE_PATH)) {
                fullData = JSON.parse(fs.readFileSync(PERSISTENCE_PATH, 'utf8'));
            }
            fullData.autoBump = {
                ...fullData.autoBump,
                ...data
            };
            fs.writeFileSync(PERSISTENCE_PATH, JSON.stringify(fullData, null, 2));
        } catch (e) {
            console.error('[AutoBump] Save persistence error:', e.message);
        }
    }

    attach(client) {
        this._client = client;

        // Restore state
        const saved = this._loadPersistence();
        if (saved.lastChannelId) this._lastChannelId = saved.lastChannelId;
        if (saved.enabled !== undefined) this.enabled = saved.enabled;

        this._listener = (message) => {
            if (!this.enabled) return;
            if (message.author?.id !== DISBOARD_ID) return;

            const embedDesc = (message.embeds?.[0]?.description || '').toLowerCase();
            const content = (message.content || '').toLowerCase();
            const combined = embedDesc + content;

            const isBumpSuccess = combined.includes('bump done') ||
                combined.includes('bumped') ||
                combined.includes('you just bumped') ||
                combined.includes('check it on disboard');

            if (!isBumpSuccess) return;

            // Track the channel for next bump
            this._lastChannelId = message.channel?.id;
            this._savePersistence({ lastChannelId: this._lastChannelId });
            this._scheduleBump(this._lastChannelId);

            const time = new Date().toLocaleTimeString();
            this.log.unshift({ time, message: 'Bump detected — next in 2h', type: 'info' });
            if (this.log.length > 50) this.log.length = 50;
        };
        client.on('messageCreate', this._listener);

        // If it was enabled and we have a channel, ensure it's scheduled or check if we missed it
        if (this.enabled && this._lastChannelId) {
            const savedNextBump = saved.nextBumpAt ? new Date(saved.nextBumpAt) : null;
            const now = new Date();
            
            if (savedNextBump && savedNextBump > now) {
                const delay = savedNextBump.getTime() - now.getTime();
                this._scheduleBump(this._lastChannelId, delay);
                console.log(`[AutoBump] Restored bump schedule: next in ${Math.round(delay/60000)}m`);
            } else {
                // If we missed it or no nextBumpAt, schedule for now or soon
                this._scheduleBump(this._lastChannelId, 5000); 
                console.log('[AutoBump] Restored state: scheduling immediate bump check');
            }
        }
    }

    _scheduleBump(channelId, delayMs = 2 * 60 * 60 * 1000) {
        if (this.timer) clearTimeout(this.timer);
        
        const bumpAt = new Date(Date.now() + delayMs);
        this.nextBumpAt = bumpAt.toISOString();
        this._savePersistence({ nextBumpAt: this.nextBumpAt, enabled: this.enabled });

        this.timer = setTimeout(async () => {
            if (!this.enabled) return;
            await this._doBump(channelId);
        }, delayMs);
    }

    async _doBump(channelId) {
        if (!this._client) return;
        const time = new Date().toLocaleTimeString();
        try {
            const channel = this._client.channels.cache.get(channelId);
            if (!channel) throw new Error('Channel not found');
            try {
                await channel.sendSlash(DISBOARD_ID, 'bump');
            } catch {
                await channel.send('!d bump');
            }
            this.nextBumpAt = null;
            this._savePersistence({ nextBumpAt: null });
            this.log.unshift({ time, message: 'Bump sent!', type: 'success' });
            if (this.log.length > 50) this.log.length = 50;
            
            // Re-schedule for 2 hours later
            this._scheduleBump(channelId);
        } catch (err) {
            this.log.unshift({ time, message: `Bump failed: ${err.message}`, type: 'error' });
            if (this.log.length > 50) this.log.length = 50;
            // Retry in 5 minutes on failure
            this._scheduleBump(channelId, 5 * 60 * 1000);
        }
    }

    async forceNow(channelId, client) {
        if (client) this._client = client;
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.nextBumpAt = null;
        const targetId = channelId || this._lastChannelId;
        if (!targetId) return 'No channel ID provided';
        
        if (channelId) {
            this._lastChannelId = channelId;
            this._savePersistence({ lastChannelId: this._lastChannelId });
        }
        
        await this._doBump(targetId);
        return 'Bump attempted';
    }

    updateEnabled(enabled) {
        this.enabled = enabled;
        this._savePersistence({ enabled: this.enabled });
        if (!enabled && this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
            this.nextBumpAt = null;
            this._savePersistence({ nextBumpAt: null });
        } else if (enabled && this._lastChannelId && !this.timer) {
            this._scheduleBump(this._lastChannelId, 5000);
        }
    }

    detach() {
        if (this._client && this._listener) {
            this._client.removeListener('messageCreate', this._listener);
        }
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this._listener = null;
        this._client = null;
    }
}

module.exports = new AutoBump();
