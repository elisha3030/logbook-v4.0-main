import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately
applyThemeFromStorage();

class EmployeeKioskManager {
    constructor() {
        this.employeeName = '';
        this.employeeType = 'Faculty';
        this.selectedPurpose = '';
        this.officeId = 'engineering-office'; // default
        this.systemSettings = {};
        this.offlineRegistry = new OfflineRegistry();
        this.activeEmployees = [];
        this.init();
    }

    async init() {
        await this.loadSettings();
        this.setupEventListeners();
        this.setupLucide();
        this.showStep('modeSelectionStep');
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
            icon.classList.remove('text-slate-200');
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
        // Mode Selection
        document.getElementById('modeArrivalBtn')?.addEventListener('click', () => {
            this.showStep('employeeInfoStep');
        });

        document.getElementById('modeDepartureBtn')?.addEventListener('click', () => {
            this.showStep('checkoutStep');
            this.fetchActiveEmployees();
        });

        // Employee Type Toggle
        const btnFaculty = document.getElementById('typeFacultyBtn');
        const btnNonFaculty = document.getElementById('typeNonFacultyBtn');
        const hiddenType = document.getElementById('employeeType');

        btnFaculty?.addEventListener('click', () => {
            hiddenType.value = 'Faculty';
            btnFaculty.classList.add('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900', 'border-slate-900', 'dark:border-slate-100');
            btnFaculty.classList.remove('bg-slate-50', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-300', 'border-slate-200', 'dark:border-slate-600');

            btnNonFaculty.classList.remove('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900', 'border-slate-900', 'dark:border-slate-100');
            btnNonFaculty.classList.add('bg-slate-50', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-300', 'border-slate-200', 'dark:border-slate-600');
        });

        btnNonFaculty?.addEventListener('click', () => {
            hiddenType.value = 'Non-Faculty';
            btnNonFaculty.classList.add('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900', 'border-slate-900', 'dark:border-slate-100');
            btnNonFaculty.classList.remove('bg-slate-50', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-300', 'border-slate-200', 'dark:border-slate-600');

            btnFaculty.classList.remove('active', 'bg-slate-900', 'dark:bg-slate-100', 'text-white', 'dark:text-slate-900', 'border-slate-900', 'dark:border-slate-100');
            btnFaculty.classList.add('bg-slate-50', 'dark:bg-slate-700', 'text-slate-500', 'dark:text-slate-300', 'border-slate-200', 'dark:border-slate-600');
        });

        // Arrival Step 1 -> Step 2
        document.getElementById('toPurposeBtn')?.addEventListener('click', () => {
            this.employeeName = document.getElementById('employeeName')?.value.trim();
            this.employeeType = document.getElementById('employeeType')?.value;

            if (!this.employeeName) {
                this.showToast('Please enter your full name.', 'error');
                return;
            }
            this.showStep('purposeStep');
            this.renderPurposes();
        });

        // Back Buttons
        document.getElementById('backToModeFromInfoBtn')?.addEventListener('click', () => this.showStep('modeSelectionStep'));
        document.getElementById('backToModeFromCheckoutBtn')?.addEventListener('click', () => this.showStep('modeSelectionStep'));
        document.getElementById('backToInfoBtn')?.addEventListener('click', () => {
            document.getElementById('customPurposeContainer')?.classList.add('hidden');
            document.getElementById('purposeGrid')?.classList.remove('hidden');
            this.showStep('employeeInfoStep');
        });

        // Submit Custom Purpose
        document.getElementById('submitCustomPurposeBtn')?.addEventListener('click', () => {
            const customInput = document.getElementById('customPurposeInput');
            const val = customInput?.value.trim();
            if(!val) {
                this.showToast('Please specify your activity.', 'error');
                return;
            }
            this.submitLog(val);
        });
    }

    showStep(stepId) {
        ['modeSelectionStep', 'employeeInfoStep', 'checkoutStep', 'purposeStep', 'completionStep'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
        document.getElementById(stepId)?.classList.remove('hidden');
        this.setupLucide();
    }

    async fetchActiveEmployees() {
        const grid = document.getElementById('activeEmployeesGrid');
        if (!grid) return;

        grid.innerHTML = `
            <div class="col-span-full flex justify-center py-10">
                <div class="animate-spin rounded-full h-8 w-8 border-4 border-slate-400 border-t-transparent"></div>
            </div>
        `;

        try {
            const res = await fetch(`/api/logs?officeId=${this.officeId}`);
            const allLogs = await res.json();

            // Filter for employees that are currently clocked in
            this.activeEmployees = allLogs.filter(log =>
                log.studentNumber === 'EMPLOYEE_LOG' &&
                !log.timeOut
            );

            if (this.activeEmployees.length === 0) {
                grid.innerHTML = `
                    <div class="col-span-full py-20 text-center animate-in zoom-in duration-300">
                        <div class="w-16 h-16 bg-slate-50 dark:bg-slate-700 rounded-full flex items-center justify-center mx-auto mb-4 text-slate-300">
                            <i data-lucide="user-square" class="w-8 h-8"></i>
                        </div>
                        <p class="text-slate-400 font-bold">No active employees clocked in.</p>
                        <p class="text-xs text-slate-400 mt-1">If you haven't clocked in yet, please go back and select 'Arriving'.</p>
                    </div>
                `;
            } else {
                grid.innerHTML = this.activeEmployees.map(e => `
                    <button onclick="window.kioskManager.checkoutEmployee('${e.id}', '${e.studentName.replace(/'/g, "\\'")}')"
                        class="group bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-slate-900 dark:hover:border-white hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                        <div class="w-16 h-16 rounded-full bg-slate-50 dark:bg-slate-700 flex items-center justify-center text-slate-400 group-hover:bg-slate-900 group-hover:text-white dark:group-hover:bg-white dark:group-hover:text-slate-900 transition-all">
                            <i data-lucide="user" class="w-8 h-8"></i>
                        </div>
                        <div class="space-y-1">
                            <p class="text-lg font-black text-slate-900 dark:text-white leading-tight">${e.studentName}</p>
                            <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest">${e.activity}</p>
                        </div>
                        <div class="mt-2 px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-700 text-[10px] font-black uppercase text-slate-400 group-hover:bg-slate-900 dark:group-hover:bg-slate-200 group-hover:text-white dark:group-hover:text-slate-900 transition-all">
                            Log Out
                        </div>
                    </button>
                `).join('');
            }
        } catch (e) {
            console.error('Fetch active employees error:', e);
            grid.innerHTML = '<p class="text-red-500 font-bold col-span-full py-10 text-center">Error loading employees.</p>';
        }
        this.setupLucide();
    }

    async checkoutEmployee(logId, name) {
        try {
            const res = await fetch(`/api/logs/${logId}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' }
            });

            if (res.ok) {
                this.showToast(`Log out successful for ${name}!`);
                this.fetchActiveEmployees(); // Refresh the list without leaving the page
            } else {
                throw new Error('Checkout failed');
            }
        } catch (e) {
            console.error('Checkout error:', e);
            this.showToast('Failed to log out. Please try again.', 'error');
        }
    }

    renderPurposes() {
        const grid = document.getElementById('purposeGrid');
        if (!grid) return;

        // Updated logbook terminology
        let purposes = ['Class/Lecture', 'Meeting', 'Research', 'Consultation', 'Official Business', 'Other'];

        grid.innerHTML = purposes.map(p => {
            if (p === 'Other') {
                return `
                    <button onclick="window.kioskManager.showCustomPurpose()"
                        class="group bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-slate-900 dark:hover:border-white hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                        <div class="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center group-hover:bg-slate-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-slate-900 transition-all">
                            <i data-lucide="more-horizontal" class="w-8 h-8"></i>
                        </div>
                        <p class="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">${p}</p>
                    </button>
                `;
            } else {
                return `
                    <button onclick="window.kioskManager.submitLog('${p.replace(/'/g, "\\'")}')"
                        class="group bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-slate-900 dark:hover:border-white hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                        <div class="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 flex items-center justify-center group-hover:bg-slate-900 dark:group-hover:bg-white group-hover:text-white dark:group-hover:text-slate-900 transition-all">
                            <i data-lucide="circle-dot" class="w-8 h-8"></i>
                        </div>
                        <p class="text-lg font-black text-slate-900 dark:text-white uppercase tracking-tight">${p}</p>
                    </button>
                `;
            }
        }).join('');

        this.setupLucide();
    }

    showCustomPurpose() {
        document.getElementById('purposeGrid')?.classList.add('hidden');
        const customContainer = document.getElementById('customPurposeContainer');
        if (customContainer) {
            customContainer.classList.remove('hidden');
            const input = document.getElementById('customPurposeInput');
            if (input) {
                input.value = '';
                input.focus();
            }
        }
    }

    async submitLog(purpose) {
        this.selectedPurpose = purpose;

        const visitData = {
            logData: {
                studentNumber: 'EMPLOYEE_LOG', // Identifier for backend/filtering
                studentName: this.employeeName,
                studentId: this.employeeType, // "Faculty" or "Non-Faculty"
                activity: `[Employee] ${this.selectedPurpose}`,
                staff: 'Self',
                yearLevel: 'N/A',
                course: this.employeeType,
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
                document.getElementById('completionTitle').textContent = 'Clocked In!';
                document.getElementById('completionMessage').textContent = `You have been successfully clocked in for ${this.selectedPurpose}.`;
                this.showStep('completionStep');
            } else {
                throw new Error('Log failed');
            }
        } catch (e) {
            console.warn('❌ Employee log failed, queuing offline:', e);
            this.offlineRegistry.queueLog(visitData);
            document.getElementById('completionTitle').textContent = 'Clocked In!';
            document.getElementById('completionMessage').textContent = 'Log saved offline. Thank you!';
            this.showStep('completionStep');
            this.showToast('Offline mode active.', 'warning');
        }
    }
}

window.kioskManager = new EmployeeKioskManager();
