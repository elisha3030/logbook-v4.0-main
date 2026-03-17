import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately
applyThemeFromStorage();

class VisitorKioskManager {
    constructor() {
        this.visitorName = '';
        this.visitorOrganization = '';
        this.visitorContact = '';
        this.selectedPurpose = '';
        this.selectedFaculty = '';
        this.officeId = 'engineering-office'; // default
        this.systemSettings = {};
        this.offlineRegistry = new OfflineRegistry();
        this.activeVisitors = [];
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        this.setupLucide();
        this.showStep('visitorInfoStep');
    }

    async loadSettings() {
        try {
            this.systemSettings = await loadSystemSettings();
            if (this.systemSettings.officeId) this.officeId = this.systemSettings.officeId;
        } catch (e) {
            console.warn('⚠️ Could not load system settings:', e.message);
        }
    }

    setupLucide() {
        if (window.lucide) {
            window.lucide.createIcons();
        }
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const template = document.getElementById('toastTemplate');
        if (!container || !template) return;

        const toast = template.content.cloneNode(true).firstElementChild;
        const msgEl = toast.querySelector('.toast-message');
        if (msgEl) msgEl.textContent = message;

        const icon = toast.querySelector('.toast-icon');
        if (icon && type === 'error') {
            icon.setAttribute('data-lucide', 'alert-circle');
            icon.classList.remove('text-violet-400');
            icon.classList.add('text-red-400');
            toast.classList.remove('bg-slate-900/90');
            toast.classList.add('bg-red-500/95');
        }

        container.appendChild(toast);
        this.setupLucide();

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    setupEventListeners() {
        // Arrival Step 1 -> Step 2
        document.getElementById('toPurposeBtn')?.addEventListener('click', () => {
            this.visitorName = document.getElementById('visitorName')?.value.trim();
            this.visitorOrganization = document.getElementById('visitorOrganization')?.value.trim();
            this.visitorContact = document.getElementById('visitorContact')?.value.trim();

            if (!this.visitorName) {
                this.showToast('Please enter your full name.', 'error');
                return;
            }
            this.showStep('purposeStep');
            this.renderPurposes();
        });

        // Back Buttons
        document.getElementById('backToInfoBtn')?.addEventListener('click', () => this.showStep('visitorInfoStep'));
        document.getElementById('backToPurposeBtn')?.addEventListener('click', () => this.showStep('purposeStep'));
    }

    showStep(stepId) {
        ['visitorInfoStep', 'purposeStep', 'facultyStep', 'completionStep'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
        document.getElementById(stepId)?.classList.remove('hidden');
        this.setupLucide();
    }

                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${v.activity || 'Visit'}</p>
                        </div>
                        <div class="mt-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-[10px] font-black uppercase text-slate-400 group-hover:bg-violet-500 group-hover:text-white transition-all">
                            Log Out
                        </div>
                    </button>
                `).join('');
            }
        } catch (e) {
            console.error('Fetch active visitors error:', e);
            grid.innerHTML = '<p class="text-red-500 font-bold col-span-full py-10 text-center">Error loading visitors.</p>';
        }
        this.setupLucide();
    }

    async checkoutVisitor(logId, name) {
        try {
            const res = await fetch(`/api/logs/${logId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' }
            });

            if (res.ok) {
                this.showToast(`Log out successful for ${name}!`);
                this.fetchActiveVisitors(); // Refresh the list
            } else {
                throw new Error('Checkout failed');
            }
        } catch (e) {
            console.error('Checkout error:', e);
            this.showToast('Failed to log out. Please ask staff for assistance.', 'error');
        }
    }

    renderPurposes() {
        const grid = document.getElementById('purposeGrid');
        if (!grid) return;

        let purposes = ['Meeting / Consultation', 'Delivery / Courier', 'Maintenance / Contractor', 'Department Tour', 'Other'];

        grid.innerHTML = purposes.map(p => `
            <button onclick="window.kioskManager.selectPurpose('${p.replace(/'/g, "\\'")}')"
                class="group bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-violet-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                <div class="w-14 h-14 rounded-2xl bg-violet-50 dark:bg-violet-900/30 text-violet-600 flex items-center justify-center group-hover:bg-violet-600 group-hover:text-white transition-all">
                    <i data-lucide="circle-dot" class="w-8 h-8"></i>
                </div>
                <p class="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">${p}</p>
            </button>
        `).join('');

        this.setupLucide();
    }

    selectPurpose(purpose) {
        this.selectedPurpose = purpose;
        const display = document.getElementById('selectedPurposeDisplay');
        if (display) display.textContent = purpose;
        this.showStep('facultyStep');
        this.renderFaculty();
    }

    async renderFaculty() {
        const grid = document.getElementById('facultyGrid');
        if (!grid) return;

        grid.innerHTML = `
            <div class="col-span-full flex justify-center py-10">
                <div class="animate-spin rounded-full h-8 w-8 border-4 border-violet-500 border-t-transparent"></div>
            </div>
        `;

        try {
            const res = await fetch('/api/faculty');
            const faculties = await res.json();

            if (!faculties || faculties.length === 0) {
                grid.innerHTML = '<p class="text-slate-400 font-bold col-span-full py-10 text-center">No faculty members registered.</p>';
            } else {
                grid.innerHTML = faculties.map(f => `
                    <button onclick="window.kioskManager.submitVisit('${f.name.replace(/'/g, "\\'")}')"
                        class="group bg-white dark:bg-slate-800 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-violet-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                        <div class="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-100 flex-shrink-0">
                            ${f.photoURL ? `<img src="${f.photoURL}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-violet-50 flex items-center justify-center text-violet-500 font-bold text-xl">${(f.name || 'S').charAt(0).toUpperCase()}</div>`}
                        </div>
                        <div>
                            <p class="text-base font-black text-slate-900 dark:text-white leading-tight">${f.name}</p>
                            <p class="text-[10px] font-bold text-slate-400 uppercase mt-1">${f.position || 'Faculty'}</p>
                        </div>
                    </button>
                `).join('');
            }

            // Simple option to skip faculty selection
            grid.innerHTML += `
                <button onclick="window.kioskManager.submitVisit('General Staff')"
                    class="group bg-white dark:bg-slate-800 p-6 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-slate-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                    <div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <i data-lucide="users" class="w-8 h-8"></i>
                    </div>
                    <div>
                        <p class="text-base font-black text-slate-400 uppercase">Skip</p>
                        <p class="text-[10px] font-bold text-slate-400 uppercase mt-1">Visit General Staff</p>
                    </div>
                </button>
            `;

        } catch (e) {
            console.error('Faculty fetch error:', e);
            grid.innerHTML = '<p class="text-red-500 font-bold col-span-full py-10 text-center">Failed to load faculty list.</p>';
        }

        this.setupLucide();
    }

    async submitVisit(facultyName) {
        this.selectedFaculty = facultyName;

        const visitData = {
            logData: {
                studentNumber: 'VISITOR_VISIT',
                studentName: this.visitorName,
                studentId: this.visitorOrganization || 'Visitor', // Use organization as ID if provided
                activity: `[Visitor] ${this.selectedPurpose}`,
                staff: this.selectedFaculty,
                yearLevel: this.visitorContact || 'N/A', // Store contact in yearLevel field
                course: this.visitorOrganization || 'Guest',
                date: new Date().toISOString().split('T')[0],
                staffEmail: ''
            },
            officeId: this.officeId
        };

        try {
            const response = await fetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(visitData)
            });

            if (response.ok) {
                document.getElementById('completionTitle').textContent = 'Visit Recorded!';
                document.getElementById('completionMessage').textContent = 'Thank you for visiting the Engineering Department. Please proceed to the waiting area.';
                this.showStep('completionStep');
            } else {
                throw new Error('Log failed');
            }
        } catch (e) {
            console.warn('❌ Visit log failed, queuing offline:', e);
            this.offlineRegistry.queueLog(visitData);
            document.getElementById('completionTitle').textContent = 'Visit Recorded!';
            document.getElementById('completionMessage').textContent = 'Visit saved offline. Thank you!';
            this.showStep('completionStep');
            this.showToast('Offline mode active.', 'warning');
        }
    }
}

window.kioskManager = new VisitorKioskManager();
