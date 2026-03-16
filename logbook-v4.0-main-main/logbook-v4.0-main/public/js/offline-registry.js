/**
 * Offline Registry Utility
 * Manages a local queue of student registrations and logs when the server is unreachable.
 */

export default class OfflineRegistry {
    constructor() {
        this.REG_KEY = 'logbook_offline_registrations';
        this.LOG_KEY = 'logbook_offline_logs';
        this.isSyncing = false;
    }

    /**
     * Store a registration record locally
     */
    queueRegistration(data) {
        const queue = this.getQueue(this.REG_KEY);
        const existingIdx = queue.findIndex(item => item.barcode === data.barcode);
        if (existingIdx !== -1) queue[existingIdx] = { ...data, timestamp: Date.now() };
        else queue.push({ ...data, timestamp: Date.now() });
        localStorage.setItem(this.REG_KEY, JSON.stringify(queue));
        console.log(`📦 Queued offline registration: ${data.barcode}`);
    }

    /**
     * Store a visit log locally
     */
    queueLog(data) {
        const queue = this.getQueue(this.LOG_KEY);
        queue.push({ ...data, timestamp: Date.now() });
        localStorage.setItem(this.LOG_KEY, JSON.stringify(queue));
        console.log(`📦 Queued offline visit log for ${data.studentNumber}`);
    }

    getQueue(key) {
        try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch (e) { return []; }
    }

    async sync() {
        if (this.isSyncing) return 0;
        this.isSyncing = true;
        let syncedCount = 0;

        // Sync Students First
        const regQueue = this.getQueue(this.REG_KEY);
        if (regQueue.length > 0) {
            const remainingReg = [];
            for (const item of regQueue) {
                try {
                    const res = await fetch('/api/students/register', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item)
                    });
                    if (res.ok) syncedCount++;
                    else remainingReg.push(item);
                } catch (e) { remainingReg.push(item); break; }
            }
            localStorage.setItem(this.REG_KEY, JSON.stringify(remainingReg));
        }

        // Sync Logs
        const logQueue = this.getQueue(this.LOG_KEY);
        if (logQueue.length > 0) {
            const remainingLogs = [];
            for (const item of logQueue) {
                try {
                    const res = await fetch('/api/logs', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(item)
                    });
                    if (res.ok) syncedCount++;
                    else remainingLogs.push(item);
                } catch (e) { remainingLogs.push(item); break; }
            }
            localStorage.setItem(this.LOG_KEY, JSON.stringify(remainingLogs));
        }

        this.isSyncing = false;
        return syncedCount;
    }

    hasPending() {
        return this.getQueue(this.REG_KEY).length > 0 || this.getQueue(this.LOG_KEY).length > 0;
    }
}
