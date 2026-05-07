const { ClientQuest } = require('./client');

class QuestManagerBridge {
    constructor(token, onPresenceChange) {
        this.token = token.replace('Bot ', '');
        this.onPresenceChange = onPresenceChange || null;
        this.client = new ClientQuest(this.token);
        this.client.connect().catch(err => this.log(`Gateway Error: ${err.message}`));

        this.globalLogs = [];
        this.activeManager = null;
        this.isRunning = false;
        this.currentQuestInfo = null;
    }

    log(msg) {
        const time = new Date().toLocaleTimeString();
        const line = (typeof msg === 'string' && msg.startsWith('[')) ? msg : `[${time}] ${msg}`;
        this.globalLogs.push(line);
        if (this.globalLogs.length > 500) this.globalLogs.shift();
        console.log('[Quest]', line);
    }

    clearLogs() {
        this.globalLogs = [];
        this.log('Logs cleared.');
    }

    // Fetch available quests — returns array of { id, name, game, appId, type, completed, expired }
    async fetchQuests() {
        const manager = await this.client.fetchQuests();
        this.activeManager = manager;
        manager.setLogger((msg) => this.log(msg));
        return manager.list().map(q => ({
            id: q.id,
            name: q.config.messages?.quest_name || q.config.application?.name || q.id,
            game: q.config.application?.name || null,
            appId: q.config.application?.id || null,
            completed: q.isCompleted(),
            expired: q.isExpired(),
            type: (() => {
                const cfg = q.config.task_config || q.config.task_config_v2;
                return cfg?.tasks ? Object.keys(cfg.tasks)[0] : 'UNKNOWN';
            })(),
        }));
    }

    // Start all valid quests ONE AT A TIME (sequential)
    async startAll() {
        if (this.isRunning) { this.log('Already running.'); return; }
        this.isRunning = true;
        this.log('Starting Quest Protocol...');
        try {
            const manager = await this.client.fetchQuests();
            this.activeManager = manager;
            manager.setLogger((msg) => this.log(msg));
            const validQuests = manager.filterQuestsValid();
            this.log(`Found ${validQuests.length} valid quest(s).`);
            if (validQuests.length === 0) { this.log('No quests to do.'); return; }

            // ONE AT A TIME
            for (const q of validQuests) {
                if (manager.stopped) break;
                await this._runQuest(manager, q);
            }
            this.log('All quests finished.');
        } catch (error) {
            this.log(`Critical Error: ${error.message}`);
        } finally {
            this.isRunning = false;
            this.currentQuestInfo = null;
            this.activeManager = null;
        }
    }

    // Start a single quest by ID
    async startOne(questId) {
        if (this.isRunning) { this.log('Already running.'); return; }
        this.isRunning = true;
        this.log(`Starting quest ${questId}...`);
        try {
            let manager = this.activeManager;
            if (!manager) {
                manager = await this.client.fetchQuests();
                this.activeManager = manager;
                manager.setLogger((msg) => this.log(msg));
            }
            const quest = manager.get(questId);
            if (!quest) { this.log(`Quest ${questId} not found.`); return; }
            if (quest.isCompleted()) { this.log('Quest already completed.'); return; }
            if (quest.isExpired()) { this.log('Quest has expired.'); return; }
            await this._runQuest(manager, quest);
            this.log('Quest finished.');
        } catch (error) {
            this.log(`Error: ${error.message}`);
        } finally {
            this.isRunning = false;
            this.currentQuestInfo = null;
            this.activeManager = null;
        }
    }

    async _runQuest(manager, quest) {
        const appName = quest.config.messages?.quest_name || quest.config.application?.name || quest.id;
        const appId = quest.config.application?.id || null;
        this.currentQuestInfo = { id: quest.id, name: appName, appId };

        // Set Discord presence: Playing [game] while quest runs
        if (this.onPresenceChange && appId) {
            try { await this.onPresenceChange({ name: appName, appId, start: Date.now() }); }
            catch (e) { this.log(`Presence set error: ${e.message}`); }
        }

        try {
            await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
            await manager.doingQuest(quest);
        } catch (e) {
            if (e.message !== 'Stopped') this.log(`Quest error: ${e.message}`);
        } finally {
            this.currentQuestInfo = null;
            // Restore original presence after quest finishes
            if (this.onPresenceChange) {
                try { await this.onPresenceChange(null); }
                catch (e) { this.log(`Presence restore error: ${e.message}`); }
            }
        }
    }

    stopAll() {
        if (this.activeManager) {
            this.activeManager.stopAll();
            this.log('Stopping all quests...');
        } else {
            this.log('Nothing to stop.');
        }
        this.isRunning = false;
    }
}

module.exports = QuestManagerBridge;
