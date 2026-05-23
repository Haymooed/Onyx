'use strict';

let db = null;
let initialized = false;

function getDb() {
    if (initialized) return db;
    initialized = true;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (!projectId || !clientEmail || !privateKey) return null;

    try {
        const admin = require('firebase-admin');
        if (!admin.apps.length) {
            admin.initializeApp({
                credential: admin.credential.cert({
                    projectId,
                    clientEmail,
                    privateKey: privateKey.replace(/\\n/g, '\n')
                })
            });
        }
        db = admin.firestore();
        console.log('[Firebase] Firestore connected');
        return db;
    } catch (e) {
        console.error('[Firebase] Init error:', e.message);
        return null;
    }
}

module.exports = { getDb };
