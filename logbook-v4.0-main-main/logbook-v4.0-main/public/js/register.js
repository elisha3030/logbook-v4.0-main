// Student Registration Module — Identifies or registers students via REST API
import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately on page load
applyThemeFromStorage();

class RegistrationManager {
    constructor() {
        this.currentStudent = null;
        this.officeId = 'engineering-office'; // default, overridden by settings
        this.barcodeBuffer = '';
        this.lastBarcodeKeyTime = 0;
        this.systemSettings = {};
        this.offlineRegistry = new OfflineRegistry(); 
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
        }, 30000); 
    }

    async loadAndApplySettings() {
        try {
            this.systemSettings = await loadSystemSettings();
            const s = this.systemSettings;

            if (s.officeId) this.officeId = s.officeId;

            // Toggle year level field in registration form
            const yearLevelWrapper = document.getElementById('regYearLevel')?.closest('.space-y-2');
            if (yearLevelWrapper) {
                const enabled = s.yearLevelEnabled !== 'false';
                yearLevelWrapper.classList.toggle('hidden', !enabled);
                const select = document.getElementById('regYearLevel');
                if (select) select.required = enabled && s.yearLevelRequired !== 'false';
            }

        } catch (e) {
            console.warn('⚠️ Could not load system settings:', e.message);
        }
    }

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
        } catch { }
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
            toast.classList.add('bg-red-500/95');
        }

        container.appendChild(toast);
        lucide.createIcons();

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    setupEventListeners() {
        const regForm = document.getElementById('regForm');

        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const now = Date.now();
            if (now - this.lastBarcodeKeyTime > 100) this.barcodeBuffer = '';
            this.lastBarcodeKeyTime = now;

            if (e.key === 'Enter') {
                if (this.barcodeBuffer.length >= 4) {
                    console.log('📦 NFC Scan detected:', this.barcodeBuffer);
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

        window.addEventListener('online', () => {
            console.log('🌐 Back online! Requesting background sync...');
            fetch('/api/sync-now', { method: 'POST' }).catch(err => console.warn('Sync trigger failed:', err));
        });

        if (regForm) {
            regForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.registerStudent();
            });
        }
    }

    async lookupStudent(studentNumber) {
        if (!studentNumber) {
            this.showToast('Invalid card data.', 'error');
            return;
        }

        console.log('🔍 Looking up student:', studentNumber);

        try {
            const studentInfo = document.getElementById('studentInfo');
            if (studentInfo) {
                studentInfo.innerHTML = `
                    <div class="flex flex-col items-center justify-center py-20 animate-in fade-in duration-300">
                        <div class="relative w-12 h-12">
                            <div class="absolute inset-0 border-4 border-blue-100 rounded-full"></div>
                            <div class="absolute inset-0 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                        </div>
                        <p class="mt-6 text-sm font-black text-slate-400 uppercase tracking-widest">Searching Directory...</p>
                    </div>
                `;
            }

            const response = await fetch(`/api/students/${studentNumber}?officeId=${this.officeId}`);
            const data = await response.json();

            if (response.ok) {
                this.playBeep(true);
                this.currentStudent = data;
                this.displayStudentProfile(data);
                this.showToast('Student identified.', 'success');
            } else if (response.status === 404) {
                this.playBeep(false);
                this.showRegistrationForm(studentNumber);
            } else {
                throw new Error(data.error || 'Lookup failed');
            }

        } catch (error) {
            console.warn('❌ Lookup error:', error);
            this.showToast('Connection error. Try again.', 'error');
            this.resetPage();
        }
    }

    displayStudentProfile(student) {
        const studentInfo = document.getElementById('studentInfo');
        const regFormSection = document.getElementById('registrationForm');
        
        if (regFormSection) regFormSection.classList.add('hidden');
        if (!studentInfo) return;

        studentInfo.classList.remove('hidden');
        studentInfo.innerHTML = `
            <div class="bg-white dark:bg-slate-800 rounded-[2.5rem] shadow-xl border border-slate-200 dark:border-slate-700 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500 w-full max-w-2xl">
                <div class="bg-blue-600 px-8 py-6 flex items-center justify-between">
                    <div class="flex items-center gap-4">
                        <div class="bg-white/20 p-2.5 rounded-xl backdrop-blur-sm border border-white/20">
                            <i data-lucide="user-check" class="w-6 h-6 text-white"></i>
                        </div>
                        <h4 class="text-white font-black tracking-tight text-lg">Student Profile</h4>
                    </div>
                    <span class="text-white/70 text-[10px] font-black uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full border border-white/10">Registered</span>
                </div>
                <div class="p-8 flex flex-col items-center text-center gap-8">
                    <div class="w-32 h-32 rounded-[2.5rem] bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-300 dark:text-slate-500 border-4 border-slate-100 dark:border-slate-600 shadow-inner">
                        <i data-lucide="user" class="w-16 h-16"></i>
                    </div>
                    <div class="space-y-6 w-full">
                        <div>
                            <p class="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 dark:text-slate-300 mb-1">Full Name</p>
                            <h3 class="text-3xl font-black text-slate-900 dark:text-white leading-tight">${student.name}</h3>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-4">
                            <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Student ID</p>
                                <p class="font-bold text-slate-800 dark:text-white text-sm">${student.studentId || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">NFC UID</p>
                                <p class="font-bold text-slate-800 dark:text-white text-sm font-mono">${student.id || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Program</p>
                                <p class="font-bold text-slate-800 dark:text-white text-sm">${student.Course || student.course || 'N/A'}</p>
                            </div>
                            <div class="bg-slate-50 dark:bg-slate-700/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-700">
                                <p class="text-[9px] font-black uppercase tracking-widest text-slate-400 mb-1">Year Level</p>
                                <p class="font-bold text-slate-800 dark:text-white text-sm">${student['Year Level'] || student.yearLevel || 'N/A'}</p>
                            </div>
                        </div>

                        <button onclick="window.registerManager.resetPage()" 
                            class="w-full bg-slate-900 hover:bg-black text-white font-black py-4 rounded-2xl transition-all active:scale-95 flex items-center justify-center gap-2 mt-2">
                             <i data-lucide="refresh-cw" class="w-4 h-4"></i>
                             Scan Another Card
                        </button>
                    </div>
                </div>
            </div>
        `;
        lucide.createIcons();
    }

    showRegistrationForm(studentNumber) {
        const studentInfo = document.getElementById('studentInfo');
        if (studentInfo) studentInfo.classList.add('hidden');

        const regForm = document.getElementById('registrationForm');
        if (regForm) {
            regForm.classList.remove('hidden');
            document.getElementById('regStudentNumber').value = studentNumber;
            document.getElementById('regStudentNumberDisplay').textContent = studentNumber;
            document.getElementById('regFullName').focus();
        }

        lucide.createIcons();
    }

    async registerStudent() {
        const studentNumber = document.getElementById('regStudentNumber').value;
        const fullName = document.getElementById('regFullName').value;
        const studentId = document.getElementById('regStudentId').value;
        const course = document.getElementById('regCourse').value;
        const yearLevel = document.getElementById('regYearLevel').value;

        if (!fullName || !studentId || !course) {
            this.showToast('Required fields missing.', 'error');
            return;
        }

        const studentData = {
            barcode: studentNumber,
            name: fullName,
            studentId: studentId,
            Course: course,
            yearLevel: yearLevel
        };

        const btn = document.querySelector('#regForm button[type="submit"]');
        const originalHtml = btn.innerHTML;
        btn.disabled = true;
        btn.innerHTML = '<i class="lucide-loader-2 animate-spin w-5 h-5 mr-2"></i>Registering...';

        try {
            const response = await fetch('/api/students/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(studentData)
            });

            if (response.ok) {
                this.showToast('Student registered successfully!');
                const data = await response.json();
                this.displayStudentProfile({
                    id: studentNumber,
                    name: fullName,
                    studentId: studentId,
                    Course: course,
                    'Year Level': yearLevel
                });
            } else {
                throw new Error('Server error');
            }
        } catch (error) {
            console.warn('❌ Registration offline save:', error);
            this.offlineRegistry.queueRegistration(studentData);
            this.showToast('Saved offline. Will sync later.', 'warning');
            this.resetPage();
        } finally {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }

    resetPage() {
        const studentInfo = document.getElementById('studentInfo');
        if (studentInfo) {
            studentInfo.innerHTML = `
                <div class="text-center py-10 animate-in fade-in duration-500">
                    <div class="w-24 h-24 bg-blue-50 dark:bg-blue-900/20 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 shadow-inner border border-blue-100 dark:border-blue-800">
                        <i data-lucide="scan" class="w-12 h-12 text-blue-500"></i>
                    </div>
                    <p class="text-lg font-bold text-slate-500 dark:text-slate-300 mb-8 max-w-sm mx-auto leading-relaxed">
                        Waiting for card scan...<br>Scan the NFC chip to identify or register a student.
                    </p>
                    <div class="inline-flex items-center gap-3 px-6 py-3 bg-slate-800 text-white rounded-2xl font-black text-xs uppercase tracking-widest shadow-lg shadow-slate-300">
                        <div class="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                        Ready for Scanner Input
                    </div>
                </div>
            `;
            studentInfo.classList.remove('hidden');
        }

        document.getElementById('registrationForm')?.classList.add('hidden');
        
        // Clear inputs
        ['regFullName', 'regStudentId', 'regCourse', 'regYearLevel'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

        lucide.createIcons();
    }
}

// Global instance 
window.registerManager = new RegistrationManager();
