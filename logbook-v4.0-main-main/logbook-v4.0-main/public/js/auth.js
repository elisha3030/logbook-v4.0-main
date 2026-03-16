// Register Service Worker for PWA/Offline support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then(reg => console.log('🚀 Service Worker registered:', reg.scope))
            .catch(err => console.warn('❌ Service Worker registration failed:', err));
    });
}

/**
 * auth.js — Offline-first Authentication Module
 *
 * Login priority:
 *   1. POST /api/auth/login  → server checks SQLite PBKDF2 hash  (works 100% offline)
 *   2. If server says needsFirebaseAuth → Firebase SDK (first-time / no local cache)
 *      → on success: cache creds + create server session via /api/auth/firebase-login
 *   3. If network is completely down → legacy sessionStorage offline session
 *
 * Session is maintained by an HttpOnly cookie (SQLite-backed express-session).
 * onAuthStateChanged is replaced by a single GET /api/auth/session call on load.
 */

import { auth } from './firebase.js';

// Firebase Auth SDK imports — only used as an online fallback for first-time login
let signInWithEmailAndPassword = null;
let signOutFirebase = null;
let getIdToken = null;

// Lazy-load Firebase Auth SDK functions only if needed (avoids blocking offline startup)
async function loadFirebaseAuthFns() {
    if (signInWithEmailAndPassword) return; // already loaded
    try {
        const mod = await import('https://www.gstatic.com/firebasejs/12.10.0/firebase-auth.js');
        signInWithEmailAndPassword = mod.signInWithEmailAndPassword;
        signOutFirebase = mod.signOut;
        getIdToken = mod.getIdToken ?? ((user) => user.getIdToken());
    } catch (err) {
        console.warn('⚠️ Firebase Auth SDK unavailable (offline):', err.message);
    }
}

class AuthManager {
    constructor() {
        this.currentUser = null;
        this.syncStatus = { cloudReachable: true, pendingLogs: 0, pendingStudents: 0 };
        this.init();
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const template = document.getElementById('toastTemplate');

        if (!container || !template) {
            console.error('Toast elements not found');
            alert(message);
            return;
        }

        const toast = template.content.cloneNode(true).querySelector('.toast-item');
        const messageEl = toast.querySelector('.toast-message');
        const iconContainer = toast.querySelector('.toast-icon-container');
        const icon = toast.querySelector('.toast-icon');

        messageEl.textContent = message;

        if (type === 'error') {
            iconContainer.classList.replace('bg-white/10', 'bg-red-500/20');
            icon.classList.replace('text-emerald-400', 'text-red-400');
            icon.setAttribute('data-lucide', 'alert-circle');
        }

        container.appendChild(toast);
        if (window.lucide) window.lucide.createIcons();

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    async init() {
        // Check session via REST API (SQLite-backed — works offline once the server
        // has issued a session cookie previously).
        try {
            const res = await fetch('/api/auth/session');
            const data = await res.json();
            if (data.authenticated && data.user) {
                this.currentUser = data.user;
                console.log('✅ Active server session for:', data.user.email);
                // Sync theme from DB so it always overrides any stale localStorage value
                this._syncThemeFromDB();
                this.handleAuthenticatedUser(data.user);
                this.setupFormListeners();
                return;
            }
        } catch (_) {
            console.warn('⚠️ Could not reach /api/auth/session — checking offline fallback.');
        }

        // Legacy offline session fallback (sessionStorage) — for network-down scenarios
        const offlineSession = sessionStorage.getItem('offlineSession');
        if (offlineSession) {
            try {
                const session = JSON.parse(offlineSession);
                if (session && session.email) {
                    this.currentUser = session;
                    console.log('🔓 Offline session fallback active for:', session.email);
                    this.handleAuthenticatedUser(session);
                    this.setupFormListeners();
                    return;
                }
            } catch (_) { sessionStorage.removeItem('offlineSession'); }
        }

        console.log('❌ No active session — unauthenticated');
        this.handleUnauthenticatedUser();
        this.setupFormListeners();
    }

    // Fetch theme from DB and apply it — ensures DB always wins over stale localStorage
    _syncThemeFromDB() {
        fetch('/api/settings')
            .then(r => r.json())
            .then(settings => {
                const mode = settings.appearanceMode || 'light';
                document.documentElement.classList.toggle('dark', mode === 'dark');
                localStorage.setItem('logbook-theme', mode);
            })
            .catch(() => { /* offline — keep whatever localStorage says */ });
    }

    setupFormListeners() {
        const loginForm = document.getElementById('loginForm');
        const logoutBtn = document.getElementById('logoutBtn');

        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.handleLogin();
            });
        }

        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => this.handleLogout());
        }
    }

    async handleLogin() {
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;
        const spinner = document.getElementById('loginSpinner');
        const errorEl = document.getElementById('loginError');

        if (spinner) spinner.classList.remove('hidden');
        if (errorEl) errorEl.classList.add('hidden');

        try {
            // ── Step 1: Try server-side login (SQLite PBKDF2 cache — works offline) ──
            const loginRes = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const loginData = await loginRes.json();

            if (loginRes.ok && loginData.success) {
                // Server created a session — we're done.
                console.log('✅ Local auth success:', email);
                window.location.href = 'portal.html';
                return;
            }

            if (!loginData.needsFirebaseAuth) {
                // Hard error from server (wrong password, no cached creds offline, etc.)
                this._showLoginError(errorEl, loginData.error || 'Login failed.');
                return;
            }

            // ── Step 2: No local cache — authenticate via Firebase SDK (online only) ──
            console.log('ℹ️  No local cache — falling back to Firebase Auth SDK...');
            await loadFirebaseAuthFns();

            if (!signInWithEmailAndPassword || !auth) {
                this._showLoginError(errorEl, 'Cannot reach authentication server. Check your connection.');
                return;
            }

            const credential = await signInWithEmailAndPassword(auth, email, password);
            const user = credential.user;
            const idToken = await user.getIdToken();

            console.log('✅ Firebase Auth success for', email, '— caching credentials...');

            // Cache hashed credentials so future logins work offline
            await fetch('/api/auth/cache-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });

            // Create a server session backed by the verified Firebase ID token
            const sessionRes = await fetch('/api/auth/firebase-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, idToken })
            });
            const sessionData = await sessionRes.json();

            if (!sessionRes.ok || !sessionData.success) {
                this._showLoginError(errorEl, sessionData.error || 'Session creation failed.');
                return;
            }

            console.log('✅ Server session created — redirecting...');
            window.location.href = 'portal.html';

        } catch (error) {
            console.error('❌ Login error:', error);

            // Network completely down — grant a temporary offline session
            const networkDown = !navigator.onLine ||
                (error.code && ['auth/network-request-failed', 'auth/internal-error'].includes(error.code)) ||
                error.message?.includes('fetch');

            if (networkDown) {
                console.warn('⚠️ Network down — granting offline session for', email);
                sessionStorage.setItem('offlineSession', JSON.stringify({ email }));
                window.location.href = 'portal.html';
                return;
            }

            let msg = 'Login failed. Please try again.';
            switch (error.code) {
                case 'auth/user-not-found': msg = 'No account found with this email.'; break;
                case 'auth/wrong-password': msg = 'Incorrect password.'; break;
                case 'auth/invalid-email': msg = 'Invalid email address.'; break;
                case 'auth/user-disabled': msg = 'Account has been disabled.'; break;
                case 'auth/too-many-requests': msg = 'Too many failed attempts. Try again later.'; break;
                case 'auth/invalid-credential': msg = 'Invalid email or password.'; break;
                default: msg = error.message || msg;
            }
            this._showLoginError(errorEl, msg);
            this.showToast(msg, 'error');
        } finally {
            if (spinner) spinner.classList.add('hidden');
        }
    }

    _showLoginError(errorEl, message) {
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        }
        this.showToast(message, 'error');
    }

    async handleLogout() {
        try {
            // Destroy the server session first (SQLite-backed)
            await fetch('/api/auth/logout', { method: 'POST' });
        } catch (_) { /* server may be restarting */ }

        // Also sign out of Firebase Auth SDK in the background (best-effort)
        try {
            if (auth && signOutFirebase) {
                await signOutFirebase(auth);
            } else if (auth) {
                await loadFirebaseAuthFns();
                if (signOutFirebase) await signOutFirebase(auth);
            }
        } catch (_) { /* non-critical — Firebase may be offline */ }

        sessionStorage.removeItem('offlineSession');
        console.log('✅ Logged out');
        window.location.href = 'index.html';
    }

    handleAuthenticatedUser(user) {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        if (currentPage === 'index.html' || currentPage === '') {
            window.location.href = 'portal.html';
            return;
        }
        this.updateAuthenticatedUI(user);
    }

    handleUnauthenticatedUser() {
        const currentPage = window.location.pathname.split('/').pop() || 'index.html';
        if (currentPage !== 'index.html' && currentPage !== '') {
            window.location.href = 'index.html';
        }
    }

    updateAuthenticatedUI(user) {
        document.querySelectorAll('.user-email').forEach(el => {
            el.textContent = user.email;
        });
        document.querySelectorAll('.auth-only').forEach(el => {
            el.classList.remove('hidden');
        });
        document.querySelectorAll('.no-auth-only').forEach(el => {
            el.classList.add('hidden');
        });
    }

    /** Returns the currently-authenticated user object (email) or null. */
    getCurrentUser() {
        if (this.currentUser) return this.currentUser;

        // Legacy offline session fallback
        try {
            const session = JSON.parse(sessionStorage.getItem('offlineSession') || 'null');
            if (session && session.email) return session;
        } catch (_) { /* malformed */ }

        return null;
    }

    isAuthenticated() {
        return this.getCurrentUser() !== null;
    }
}

window.authManager = new AuthManager();
