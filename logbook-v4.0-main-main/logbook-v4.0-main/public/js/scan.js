// Scanner Module — offline-first, all data via REST API
import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately on page load
applyThemeFromStorage();

class ScannerManager {
    constructor() {
        this.isScanning = false;
        this.currentStudent = null;
        this.currentLogId = null;
        this.activeLogEntries = []; // Store multiple active logs
        this.officeId = 'engineering-office'; // default, overridden by settings
        this.rfidBuffer = '';
        this.barcodeBuffer = '';
        this.lastBarcodeKeyTime = 0;
        this.rfidTimeout = null;
        this.systemSettings = {};
        this.offlineRegistry = new OfflineRegistry(); // Initialize OfflineRegistry
        this.init();
    }

    async init() {
        await this.loadAndApplySettings();
        this.setupEventListeners();

        // Start heartbeat for offline sync
        setInterval(() => {
            this.offlineRegistry.sync().then(synced => {
                if (synced > 0) {
                    this.showToast(`Synced ${synced} offline registration(s)!`, 'success');
                }
            });
        }, 30000); // Check every 30 seconds
    }

    // Load system settings and apply them to the scanner
    async loadAndApplySettings() {
        try {
            this.systemSettings = await loadSystemSettings();
            const s = this.systemSettings;

            // 1. Override officeId from settings
            if (s.officeId) this.officeId = s.officeId;

            // 2. Populate activity dropdown from settings
            const activitySelect = document.getElementById('logActivity');
            if (activitySelect && s.activities) {
                let activities = [];
                try { activities = JSON.parse(s.activities); } catch { }
                if (activities.length > 0) {
                    activitySelect.innerHTML = '<option value="">Select Activity</option>' +
                        activities.map(a => `<option value="${a}">${a}</option>`).join('');
                }
            }

            // 2b. Populate staff dropdown from /api/faculty
            const staffSelect = document.getElementById('logStaff');
            if (staffSelect) {
                try {
                    const res = await fetch('/api/faculty');
                    const faculties = await res.json();
                    if (faculties.length > 0) {
                        staffSelect.innerHTML = '<option value="">Select Staff</option>' +
                            faculties.map(f => `<option value="${f.name}">${f.name}</option>`).join('');
                    }
                } catch (e) {
                    console.warn('⚠️ Could not load faculty list:', e.message);
                }
            }

            // 3. Toggle year level field in registration form
            const yearLevelWrapper = document.getElementById('regYearLevel')?.closest('.space-y-2');
            if (yearLevelWrapper) {
                const enabled = s.yearLevelEnabled !== 'false';
                yearLevelWrapper.classList.toggle('hidden', !enabled);
                const select = document.getElementById('regYearLevel');
                if (select) select.required = enabled && s.yearLevelRequired !== 'false';
            }

            // 4. Apply session timeout if configured
            const timeoutMinutes = parseInt(s.sessionTimeoutMinutes || '0', 10);
            if (timeoutMinutes > 0) this._startSessionTimeout(timeoutMinutes);

        } catch (e) {
            console.warn('⚠️ Could not load system settings:', e.message);
        }
    }

    // Play a short beep using the Web Audio API
    playBeep(success = true) {
        if (this.systemSettings.audioFeedback === 'false') return;
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const oscillator = ctx.createOscillator();
            const gainNode = ctx.createGain();
            oscillator.connect(gainNode);
            gainNode.connect(ctx.destination);
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(success ? 880 : 440, ctx.currentTime);
            gainNode.gain.setValueAtTime(0.3, ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            oscillator.start(ctx.currentTime);
            oscillator.stop(ctx.currentTime + 0.15);
        } catch { /* audio not supported */ }
    }

    // Session timeout: auto-logout after inactivity
    _startSessionTimeout(minutes) {
        let timer;
        const reset = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                if (window.authManager) {
                    window.authManager.handleLogout?.();
                } else {
                    window.location.href = 'index.html';
                }
            }, minutes * 60 * 1000);
        };
        ['mousemove', 'keydown', 'click', 'touchstart'].forEach(evt => window.addEventListener(evt, reset));
        reset();
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const template = document.getElementById('toastTemplate');
        if (!container || !template) return;

        const toast = template.content.cloneNode(true).firstElementChild;
        toast.querySelector('.toast-message').textContent = message;

        const icon = toast.querySelector('.toast-icon');
        if (type === 'error') {
            icon.setAttribute('data-lucide', 'alert-circle');
            icon.classList.remove('text-emerald-400');
            icon.classList.add('text-red-400');
            toast.classList.remove('bg-slate-900/90');
            toast.classList.add('bg-red-500/95'); // Slightly more visible red for errors
        }

        container.appendChild(toast);
        lucide.createIcons();

        // Remove toast after 4 seconds
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    setupEventListeners() {
        const scanIdBtn = document.getElementById('scanIdBtn');
        const stopScanBtn = document.getElementById('stopScanBtn');
        const regForm = document.getElementById('regForm');
        const logVisitForm = document.getElementById('logVisitForm');
        const logActivity = document.getElementById('logActivity');
        const otherActivityContainer = document.getElementById('otherActivityContainer');
        const logOutBtn = document.getElementById('logOutBtn');
        const timeOutAllBtn = document.getElementById('timeOutAllBtn');

        if (timeOutAllBtn) {
            timeOutAllBtn.addEventListener('click', () => {
                this.timeOutAll();
            });
        }

        // Global Barcode Listener for Automatic Scanning
        window.addEventListener('keydown', (e) => {
            // Ignore if focus is in an input field or textarea
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            // Ignore modifier keys
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const now = Date.now();

            // Rapid Scan Detection: If the delay is too long (>100ms), it's probably not a high-speed scanner
            if (now - this.lastBarcodeKeyTime > 100) {
                this.barcodeBuffer = '';
            }
            this.lastBarcodeKeyTime = now;

            if (e.key === 'Enter') {
                if (this.barcodeBuffer.length >= 4) { // Minimum length for a barcode
                    console.log('📦 Automatic Scan detected:', this.barcodeBuffer);
                    const scannedValue = this.barcodeBuffer;
                    this.barcodeBuffer = '';
                    this.lookupStudent(scannedValue);
                } else {
                    this.barcodeBuffer = '';
                }
            } else if (e.key.length === 1) {
                this.barcodeBuffer += e.key;
            }
        });

        // Instantly trigger a sync when the browser detects internet connection
        window.addEventListener('online', () => {
            console.log('🌐 Back online! Requesting instant background sync...');
            fetch('/api/sync-now', { method: 'POST' }).catch(err => console.warn('Sync trigger failed:', err));
        });

        if (regForm) {
            regForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.registerAndLogVisit();
            });
        }

        if (logVisitForm) {
            logVisitForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.logVisit();
            });
        }

        if (logActivity && otherActivityContainer) {
            logActivity.addEventListener('change', () => {
                if (logActivity.value === 'Others') {
                    otherActivityContainer.classList.remove('hidden');
                    document.getElementById('otherActivityInput').required = true;
                } else {
                    otherActivityContainer.classList.add('hidden');
                    document.getElementById('otherActivityInput').required = false;
                }
            });
        }

        if (logOutBtn) {
            logOutBtn.addEventListener('click', () => {
                this.logTimeOut();
            });
        }
    }





    async lookupStudent(studentNumber) {
        if (!studentNumber) {
            this.showToast('Please enter a valid NFC Chip Number', 'error');
            return;
        }

        console.log('🔍 Looking up student:', studentNumber);

        const startTime = performance.now();

        try {
            // "Sneaky Fast" UI: Only show loading if it takes more than 100ms
            const loadingTimeout = setTimeout(() => {
                const studentInfo = document.getElementById('studentInfo');
                if (studentInfo && studentInfo.innerHTML.includes('Ready')) {
                    studentInfo.innerHTML = `
                        <div class="flex flex-col items-center justify-center py-20 animate-in fade-in duration-300">
                            <div class="relative w-12 h-12">
                                <div class="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                                <div class="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                            </div>
                            <p class="mt-6 text-sm font-black text-slate-400 uppercase tracking-widest">Searching...</p>
                        </div>
                    `;
                }
            }, 150);

            // Add AbortController for fast timeout (2500ms) to allow backend fallback to fail gracefully
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            // Query backend for student (pass officeId for active session check)
            // The backend handles hitting the local SQLite cache instantly
            const response = await fetch(`/api/students/${studentNumber}?officeId=${this.officeId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);
            clearTimeout(loadingTimeout);

            const data = await response.json();
            const endTime = performance.now();
            console.log(`⏱️ Lookup for ${studentNumber} took ${(endTime - startTime).toFixed(2)}ms`);

            if (response.ok) {
                // Student found
                const student = data;
                console.log('✅ Student data found:', student);

                this.playBeep(true); // Audio feedback: success

                this.currentStudent = { ...student };
                this.activeLogEntries = student.activeLogs || [];

                // CHECKOUT LOGIC: If active sessions exist, show the granular prompt
                if (this.activeLogEntries.length > 0) {
                    console.log(`🔄 ${this.activeLogEntries.length} active session(s) found, showing prompt`);
                    this.displayCheckoutPrompt(this.currentStudent);
                } else if (this.systemSettings.autoSubmit === 'true') {
                    // Auto-submit: log the visit using the first available activity
                    let activities = [];
                    try { activities = JSON.parse(this.systemSettings.activities || '[]'); } catch { }
                    const defaultActivity = activities[0] || 'Inquiry';
                    this.currentStudent = { ...student };
                    const autoLogData = {
                        studentNumber: student.id,
                        studentName: student.name,
                        studentId: student.studentId || 'N/A',
                        activity: defaultActivity,
                        staff: '',
                        yearLevel: student['Year Level'] || student.yearLevel || 'N/A',
                        course: student.Course || student.course || 'N/A',
                        date: new Date().toISOString().split('T')[0],
                        staffEmail: window.authManager?.getCurrentUser?.()?.email || ''
                    };
                    try {
                        const autoRes = await fetch('/api/logs', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ logData: autoLogData, officeId: this.officeId })
                        });
                        const autoResult = await autoRes.json();
                        if (!autoRes.ok) throw new Error(autoResult.error);
                        this.currentLogId = autoResult.id;
                        this.showToast(`Auto log-in: ${student.name}`);
                        this.resetPage();
                    } catch (e) {
                        this.showToast('Auto-submit failed, showing form', 'error');
                        this.showVisitForm();
                    }
                } else {
                    // Regular check-in flow
                    this.showVisitForm();
                }
            } else if (response.status === 404) {
                // Student not found, show registration form
                this.playBeep(false); // Audio feedback: not found
                console.log('❌ Student not found, showing registration form');
                this.showRegistrationForm(studentNumber);
            }

        } catch (error) {
            console.warn('❌ Student lookup error (might be offline):', error);
            this.playBeep(false); // Audio feedback: error

            // Any error during lookup in a production environment should offer the "safety net": offline registration.
            // This handles server downtime, network loss, CORS issues, etc.
            const studentInfo = document.getElementById('studentInfo');
            if (studentInfo) {
                studentInfo.innerHTML = `
                <div class="alert alert-warning mx-auto max-w-sm mt-10 p-8 bg-amber-50 dark:bg-amber-900/20 text-amber-900 dark:text-amber-400 rounded-[2.5rem] border border-amber-200 dark:border-amber-800 shadow-xl text-center">
                    <div class="bg-amber-100 dark:bg-amber-800 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-6">
                        <i data-lucide="wifi-off" class="w-8 h-8 text-amber-600"></i>
                    </div>
                    <strong>Server Unreachable</strong>
                    <p class="text-sm mt-3 font-medium opacity-80">We can't reach the local server, but you can still register this student offline.</p>
                    <button id="registerOfflineBtn" class="mt-6 w-full bg-amber-600 text-white font-black py-4 rounded-2xl shadow-lg shadow-amber-900/20 active:scale-95 transition-all flex items-center justify-center gap-2">
                        <i data-lucide="user-plus" class="w-4 h-4"></i>
                        Register Offline
                    </button>
                    <p class="text-[10px] mt-4 font-bold uppercase tracking-widest opacity-50">Barcode: ${studentNumber}</p>
                </div>
            `;
                lucide.createIcons();
                document.getElementById('registerOfflineBtn').addEventListener('click', () => {
                    this.showRegistrationForm(studentNumber);
                    // Add a hint to the reg form that we are in offline mode
                    const regHeader = document.querySelector('#registrationForm h5');
                    if (regHeader) regHeader.innerHTML += ' <span class="text-amber-600 text-xs font-black bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100">OFFLINE</span>';
                });
            } else {
                this.showToast('Unable to reach server for lookup.', 'error');
            }
        }
    }

    displayStudentInfo(student) {
        const studentInfo = document.getElementById('studentInfo');
        studentInfo.innerHTML = `
            <div class="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div class="bg-emerald-500 px-8 py-6 flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div class="bg-white/20 p-2.5 rounded-xl backdrop-blur-sm border border-white/20">
                            <i data-lucide="user-check" class="w-6 h-6 text-white"></i>
                        </div>
                        <h4 class="text-white font-black tracking-tight">Student Identified</h4>
                    </div>
                </div>
                <div class="p-8 flex flex-col md:flex-row items-center gap-8">
                    <div class="w-24 h-24 rounded-3xl bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-500 border-2 border-slate-100 dark:border-slate-600 flex-shrink-0">
                        <i data-lucide="user" class="w-12 h-12"></i>
                    </div>
                    <div class="text-center md:text-left space-y-4 flex-grow">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300 mb-1">Student Name</p>
                            <h3 class="text-2xl font-black text-slate-900 dark:text-white leading-none">${student.name}</h3>
                        </div>
                        <div class="flex flex-wrap gap-3 justify-center md:justify-start">
                            <div class="bg-blue-50 dark:bg-blue-900/30 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-700">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 mb-0.5">NFC Chip</p>
                                <p class="font-bold text-slate-700 dark:text-slate-100 text-xs">${student.id || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-600">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 mb-0.5">Student ID</p>
                                <p class="font-bold text-slate-700 dark:text-slate-100 text-xs">${student.studentId || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-600">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 mb-0.5">Program</p>
                                <p class="font-bold text-slate-700 dark:text-slate-100 text-xs">${student.Course || student.course || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700 px-4 py-2 rounded-xl border border-slate-100 dark:border-slate-600">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 mb-0.5">Year</p>
                                <p class="font-bold text-slate-700 dark:text-slate-100 text-xs">${student['Year Level'] || student.yearLevel || 'N/A'}</p>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    displayCheckoutPrompt(student) {
        // Hide other forms
        document.getElementById('registrationForm').classList.add('hidden');
        document.getElementById('visitForm').classList.add('hidden');

        // Render the explicit checkout UI inside studentInfo
        const studentInfo = document.getElementById('studentInfo');
        studentInfo.classList.remove('hidden');

        studentInfo.innerHTML = `
            <div class="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-300">
                <div class="bg-[#FF2E36] px-8 py-8 flex items-center gap-6">
                    <div class="bg-white/20 p-4 rounded-3xl backdrop-blur-sm border border-white/10 flex items-center justify-center">
                        <i data-lucide="clock" class="w-8 h-8 text-white"></i>
                    </div>
                    <div>
                        <h3 class="text-white text-2xl font-black tracking-tight drop-shadow-sm">Active Session Found</h3>
                        <p class="text-white/90 text-[10px] font-black uppercase tracking-[0.2em] mt-1 drop-shadow-sm">LOG OUT REQUIRED</p>
                    </div>
                </div>

                <div class="p-8 md:p-10 space-y-8">
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-6 pb-6 border-b border-slate-50 dark:border-slate-700">
                        <div class="space-y-2">
                            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 ml-1">Student ID Number</label>
                            <input type="text" readonly value="${student.studentId || student.id || 'N/A'}"
                                class="block w-full border-none rounded-xl px-4 py-3 bg-slate-50 dark:bg-slate-700 font-mono font-bold text-slate-500 dark:text-slate-200 outline-none italic leading-none">
                        </div>
                        <div class="space-y-2">
                            <label class="block text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-300 ml-1">Student Name</label>
                            <input type="text" readonly value="${student.name || 'N/A'}"
                                class="block w-full border-none rounded-xl px-4 py-3 bg-slate-50 dark:bg-slate-700 font-bold text-slate-800 dark:text-white outline-none leading-none">
                        </div>
                    </div>

                    <div class="space-y-4">
                        <label class="block text-sm font-black text-slate-900 dark:text-white ml-1 flex items-center gap-2">
                            <i data-lucide="log-out" class="w-4 h-4 text-red-500"></i>
                            Select and verify activities to log out:
                        </label>
                        
                        <div class="space-y-3 mt-4">
                            ${this.activeLogEntries.map((log, idx) => `
                                <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-700 group/item hover:border-blue-200 transition-all">
                                    <div class="flex flex-col">
                                        <span class="text-xs font-black text-slate-400 uppercase tracking-widest leading-none mb-1">${log.activity || 'Visit'}</span>
                                        <span class="text-sm font-bold text-slate-700 dark:text-slate-200">${new Date(log.timeIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                    </div>
                                    <div class="flex bg-slate-200 dark:bg-slate-600 p-1 rounded-xl">
                                        <button onclick="window.scannerManager.updateLogStatusLocal(${idx}, 'pending')" 
                                            class="status-toggle-${idx} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${log.status === 'pending' ? 'bg-white dark:bg-slate-500 text-slate-900 dark:text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
                                            id="pending-btn-${idx}">
                                            Pending
                                        </button>
                                        <button onclick="window.scannerManager.updateLogStatusLocal(${idx}, 'complete')" 
                                            class="status-toggle-${idx} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${log.status === 'complete' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700'}"
                                            id="complete-btn-${idx}">
                                            Complete
                                        </button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <button id="explicitCheckoutBtn"
                        class="w-full bg-[#0F172A] hover:bg-black text-white font-black py-4.5 px-10 rounded-2xl shadow-xl shadow-slate-200 transition-all flex items-center justify-center gap-3 transform hover:-translate-y-1 active:scale-95 text-lg mt-4 leading-none">
                        <i data-lucide="check-circle" class="w-6 h-6 text-[#FF2E36]"></i>
                        Confirm & Log Out
                    </button>
                </div>
            </div>
            `;
        lucide.createIcons();

        // Attach event listener to the native button
        document.getElementById('explicitCheckoutBtn').addEventListener('click', () => {
            this.confirmMultiLogTimeout();
        });
    }

    // Helper to toggle status locally in the list
    async updateLogStatusLocal(index, newStatus) {
        if (!this.activeLogEntries[index]) return;
        this.activeLogEntries[index].status = newStatus;

        // Update UI toggles immediately
        const pendingBtn = document.getElementById(`pending-btn-${index}`);
        const completeBtn = document.getElementById(`complete-btn-${index}`);

        if (newStatus === 'pending') {
            pendingBtn.className = `status-toggle-${index} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-white dark:bg-slate-500 text-slate-900 dark:text-white shadow-sm`;
            completeBtn.className = `status-toggle-${index} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-slate-500 hover:text-slate-700`;
        } else {
            pendingBtn.className = `status-toggle-${index} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all text-slate-500 hover:text-slate-700`;
            completeBtn.className = `status-toggle-${index} px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all bg-emerald-500 text-white shadow-sm`;

            // AUTO-CHECKOUT: If marked as complete, trigger the timeout API immediately
            console.log(`🚀 Auto-checkout triggered for activity: ${this.activeLogEntries[index].activity}`);
            await this.confirmLogTimeout(index);
        }
    }

    // New helper to checkout a single log entry automatically
    async confirmLogTimeout(index) {
        const log = this.activeLogEntries[index];
        if (!log) return;

        try {
            const response = await fetch(`/api/logs/${log.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ officeId: this.officeId })
            });

            if (!response.ok) throw new Error('Failed to log out');

            this.showToast(`Checked out: ${log.activity || 'Activity'}`);

            // Remove the log from local entries so it disappears from UI
            this.activeLogEntries.splice(index, 1);

            // If no more active logs, reset the page
            if (this.activeLogEntries.length === 0) {
                this.resetPage();
            } else {
                // Re-render the prompt with remaining logs
                this.displayCheckoutPrompt(this.currentStudent);
            }

        } catch (error) {
            console.error('❌ Auto checkout failed:', error);
            this.showToast('Failed to log out session.', 'error');
        }
    }

    async confirmMultiLogTimeout() {
        const toComplete = this.activeLogEntries.filter(l => l.status === 'complete');

        if (toComplete.length === 0) {
            this.showToast('No activities marked as complete.', 'warning');
            return;
        }

        const btn = document.getElementById('explicitCheckoutBtn');
        const originalText = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="lucide-loader-2 animate-spin w-5 h-5 mr-2"></i>Processing...';

        try {
            // Process each completed log
            const results = await Promise.all(toComplete.map(log =>
                fetch(`/api/logs/${log.id}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ officeId: this.officeId })
                }).then(res => res.json())
            ));

            this.showToast(`Successfully logged out ${toComplete.length} activity/ies.`);
            this.resetPage();

        } catch (error) {
            console.error('❌ Selective log out failed:', error);
            this.showToast('Failed to log out selected sessions.', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }

    showRegistrationForm(studentNumber) {
        // Hide other forms
        const visitForm = document.getElementById('visitForm');
        if (visitForm) visitForm.classList.add('hidden');

        const studentInfo = document.getElementById('studentInfo');
        if (studentInfo) studentInfo.classList.add('hidden');

        // Show registration form
        const regForm = document.getElementById('registrationForm');
        if (regForm) regForm.classList.remove('hidden');

        // Pre-fill student number
        document.getElementById('regStudentNumber').value = studentNumber;
        document.getElementById('regStudentNumberDisplay').textContent = studentNumber;

        lucide.createIcons();

        // Scroll to registration form
        document.getElementById('registrationForm').scrollIntoView({ behavior: 'smooth' });
    }

    showVisitForm() {
        // Hide other forms safely
        const regForm = document.getElementById('registrationForm');
        if (regForm) regForm.classList.add('hidden');

        const timeOutSection = document.getElementById('timeOutSection');
        if (timeOutSection) timeOutSection.classList.add('hidden');

        // Hide the empty-state studentInfo card (we show the visitForm card instead)
        const studentInfo = document.getElementById('studentInfo');
        if (studentInfo) studentInfo.classList.add('hidden');

        // Show visit form
        const visitForm = document.getElementById('visitForm');
        if (visitForm) visitForm.classList.remove('hidden');

        // Auto-fill student ID and name fields
        const studentIdInput = document.getElementById('foundStudentId');
        const studentNameInput = document.getElementById('foundStudentName');
        if (studentIdInput && this.currentStudent) {
            studentIdInput.value = this.currentStudent.studentId || this.currentStudent.id;
            studentNameInput.value = this.currentStudent.name;
        }

        lucide.createIcons();

        // Scroll to visit form
        document.getElementById('visitForm').scrollIntoView({ behavior: 'smooth' });
    }

    async registerAndLogVisit() {
        const studentNumber = document.getElementById('regStudentNumber').value;
        const fullName = document.getElementById('regFullName').value;
        const studentId = document.getElementById('regStudentId').value;
        const course = document.getElementById('regCourse').value;
        const yearLevel = document.getElementById('regYearLevel').value;

        if (!studentNumber || !fullName || !studentId || !course || !yearLevel) {
            this.showToast('Please fill in all required fields', 'error');
            return;
        }

        const studentData = {
            barcode: studentNumber,
            name: fullName,
            studentId: studentId,
            Course: course,
            yearLevel: yearLevel
        };

        try {
            // Register student only via backend API (no visit log yet)
            const response = await fetch('/api/students/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(studentData)
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to register');

            // Set current student so the visit form can use it
            this.currentStudent = {
                id: studentNumber,
                name: fullName,
                studentId: studentId,
                Course: course,
                'Year Level': yearLevel
            };

            // Show the visit form (same flow as existing student)
            this.showVisitForm();

        } catch (error) {
            console.warn('❌ Registration failed, saving to offline queue:', error);

            // Save to offline queue!
            this.offlineRegistry.queueRegistration(studentData);

            this.showToast('Server unavailable. Registration saved offline and will sync later.', 'warning');

            // Show the "Success" view anyway so the user can continue
            this.currentStudent = studentData;
            this.showVisitForm();

            // Hint on the visit form
            const visitHeader = document.querySelector('#visitForm h5');
            if (visitHeader) visitHeader.innerHTML += ' <span class="text-amber-600 text-[10px] font-black bg-amber-50 px-2 py-0.5 rounded-lg border border-amber-100 ml-2">PENDING SYNC</span>';
        }
    }

    async logVisit() {
        let activity = document.getElementById('logActivity').value;
        const otherActivity = document.getElementById('otherActivityInput').value;
        const staff = document.getElementById('logStaff').value;

        if (activity === 'Others' && otherActivity) {
            activity = otherActivity;
        }

        if (!activity) {
            this.showToast('Please select or specify an activity', 'error');
            return;
        }

        try {
            // Log visit via backend API
            const response = await fetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    logData: {
                        studentNumber: this.currentStudent.id,
                        studentName: this.currentStudent.name,
                        studentId: this.currentStudent.studentId || 'N/A',
                        activity: activity,
                        staff: staff,
                        yearLevel: this.currentStudent['Year Level'] || this.currentStudent.yearLevel || 'N/A',
                        course: this.currentStudent.Course || this.currentStudent.course || 'N/A',
                        date: new Date().toISOString().split('T')[0],
                        staffEmail: window.authManager?.getCurrentUser?.()?.email || ''
                    },
                    officeId: this.officeId
                })
            });

            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to log visit');

            this.currentLogId = result.id;

            // Show success message and reset page because explicit timeout section is gone
            this.showToast('Visit logged successfully!');
            this.resetPage();

        } catch (error) {
            console.warn('❌ Visit log failed, queuing offline:', error);

            // Queue locally
            const logData = {
                logData: {
                    studentNumber: this.currentStudent.id,
                    studentName: this.currentStudent.name,
                    studentId: this.currentStudent.studentId || 'N/A',
                    activity: activity,
                    staff: staff,
                    yearLevel: this.currentStudent['Year Level'] || this.currentStudent.yearLevel || 'N/A',
                    course: this.currentStudent.Course || this.currentStudent.course || 'N/A',
                    date: new Date().toISOString().split('T')[0],
                    staffEmail: window.authManager?.getCurrentUser?.()?.email || ''
                },
                officeId: this.officeId
            };
            this.offlineRegistry.queueLog(logData);

            this.showToast('Server unavailable. Visit saved offline and will sync later.', 'warning');

            // Reset page or show success
            this.resetPage();
        }
    }

    // This is now handled by the backend API calls above
    async saveVisitLog(activity) {
        console.warn('saveVisitLog is deprecated, use API endpoints directly');
    }

    showTimeOutSection() {
        // Hide other forms
        document.getElementById('registrationForm').classList.add('hidden');
        document.getElementById('visitForm').classList.add('hidden');

        // Show time out section
        document.getElementById('timeOutSection').classList.remove('hidden');
        document.getElementById('loggedInStudent').textContent = this.currentStudent.name;
    }

    async logTimeOut() {
        if (!this.currentLogId) {
            this.showToast('No active visit found', 'error');
            return;
        }

        try {
            // Update the log document with timeOut via API
            const response = await fetch(`/api/logs/${this.currentLogId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ officeId: this.officeId })
            });

            if (!response.ok) throw new Error('Failed to log time out');

            console.log('✅ Time out logged successfully');
            this.showToast('Time out logged successfully!');
            this.resetPage();

        } catch (error) {
            console.error('❌ Error logging time out:', error);
            this.showToast('Error logging time out. Please try again.', 'error');
        }
    }

    async timeOutAll() {
        const confirmed = confirm('Log out ALL currently active sessions?\nThis will close every open visit log.');
        if (!confirmed) return;

        const btn = document.getElementById('timeOutAllBtn');
        if (btn) btn.disabled = true;

        try {
            const response = await fetch('/api/logs/clear-active', { method: 'DELETE' });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || 'Failed to time out all');

            const count = result.cleared ?? 0;
            this.showToast(count > 0 ? `Checked out ${count} active session${count !== 1 ? 's' : ''}.` : 'No active sessions to close.');

            // If we just closed the student currently on screen, reset to ready state
            if (this.currentLogId) this.resetPage();
        } catch (error) {
            console.error('❌ Error timing out all:', error); // Reverted to original error message for timeOutAll
            this.showToast('Failed to time out all sessions. Please try again.', 'error'); // Reverted to original toast for timeOutAll
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = originalText; }
        }
    }

    stopScanning() {
        this.isScanning = false;
        console.log('⏹️ Scanner stopped');
    }

    resetPage() {
        // Reset student info
        document.getElementById('studentInfo').innerHTML = `
            <div class="bg-white dark:bg-slate-800 border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-[3rem] p-20 text-center transition-all hover:border-blue-200 hover:bg-blue-50/5 group shadow-sm">
                <div class="relative w-32 h-32 mx-auto mb-10">
                    <div class="absolute inset-0 bg-blue-100 dark:bg-blue-900/40 rounded-full animate-ping opacity-20"></div>
                    <div class="relative bg-blue-50 dark:bg-blue-900/30 w-32 h-32 rounded-full flex items-center justify-center transition-all group-hover:scale-105 group-hover:bg-white dark:group-hover:bg-slate-700 group-hover:shadow-xl">
                        <i data-lucide="scan" class="w-14 h-14 text-blue-500"></i>
                    </div>
                </div>
                <h3 class="text-3xl font-black text-slate-900 dark:text-white mb-4 tracking-tight">System Ready</h3>
                <p class="text-lg font-bold text-slate-500 dark:text-slate-300 mb-8 max-w-sm mx-auto leading-relaxed">Waiting for student...<br/>Simply scan the NFC chip to log in, and tap again to log out.</p>
                
                <div class="inline-flex items-center gap-3 px-6 py-3 bg-slate-900 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-slate-200">
                    <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    Waiting for Scanner Input...
                </div>
            </div>
        `;
        lucide.createIcons();

        // Hide all forms
        const timeOutSection = document.getElementById('timeOutSection');
        if (timeOutSection) timeOutSection.classList.add('hidden');

        const regForm = document.getElementById('registrationForm');
        if (regForm) regForm.classList.add('hidden');

        const visitForm = document.getElementById('visitForm');
        if (visitForm) visitForm.classList.add('hidden');

        const studentInfo = document.getElementById('studentInfo');
        if (studentInfo) studentInfo.classList.remove('hidden');

        // Reset forms
        document.getElementById('regForm').reset();
        document.getElementById('logVisitForm').reset();

        // Clear current student and log
        this.currentStudent = null;
        this.currentLogId = null;
    }
}

// Initialize scanner manager
window.scannerManager = new ScannerManager();
