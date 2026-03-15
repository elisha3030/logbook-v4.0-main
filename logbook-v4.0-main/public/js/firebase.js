/**
 * firebase.js — Auth-only Firebase client module (offline-first build)
 *
 * All data (logs, students, settings) flows through the Express REST API backed
 * by SQLite. Firebase is used ONLY for:
 *   1. First-time online credential verification (signInWithEmailAndPassword)
 *   2. Supplying an ID-token so the server can create a verified session
 *      (POST /api/auth/firebase-login)
 *
 * Firestore is intentionally NOT initialised on the client — every read/write
 * goes through /api/* endpoints so the app works fully offline.
 */

console.log('🔧 Initializing Firebase Auth (offline-first mode)...');

// Unregister any stale service workers
if ('serviceWorker' in navigator) {
    try {
        const registrations = await navigator.serviceWorker.getRegistrations();
        for (const reg of registrations) {
            await reg.unregister();
            console.log('🧹 Unregistered stale service worker:', reg.scope);
        }
    } catch (_) { /* non-critical */ }
}

let app = null;
let auth = null;
let firebaseConfig = {};

try {
    // Fetch Firebase config from backend (only the keys needed for Auth)
    const response = await fetch('/api/config');
    firebaseConfig = await response.json();
    console.log('✅ Firebase config loaded:', firebaseConfig.projectId);

    const FB_APP_URL = 'https://www.gstatic.com/firebasejs/12.10.0/firebase-app.js';
    const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js';

    const { initializeApp } = await import(FB_APP_URL);
    const {
        getAuth,
        initializeAuth,
        browserLocalPersistence,
        connectAuthEmulator
    } = await import(FB_AUTH_URL);

    app = initializeApp(firebaseConfig);
    console.log('✅ Firebase app initialized');

    // Initialise Auth with local persistence so the SDK remembers the user
    // across refreshes (used only as a fallback for first-time online login).
    try {
        auth = initializeAuth(app, { persistence: browserLocalPersistence });
        console.log('✅ Firebase Auth initialised');
    } catch (e) {
        console.warn('⚠️ initializeAuth failed, falling back to getAuth:', e.message);
        auth = getAuth(app);
    }

    if (firebaseConfig.authEmulatorHost) {
        connectAuthEmulator(auth, `http://${firebaseConfig.authEmulatorHost}`);
        console.log('🔧 Connected to Auth Emulator');
    }
} catch (err) {
    console.warn('⚠️ Firebase Auth could not be initialised (offline or misconfigured):', err.message);
    console.log('ℹ️  App will operate in fully-offline mode using cached credentials.');
}

// NOTE: `db` (Firestore) is intentionally not exported. All data access uses
// the /api/* REST endpoints which read from SQLite locally.
window.firebaseAuth = auth;
window.firebaseApp  = { app, auth, config: firebaseConfig };

export { app, auth, firebaseConfig };
export default { app, auth, firebaseConfig };



