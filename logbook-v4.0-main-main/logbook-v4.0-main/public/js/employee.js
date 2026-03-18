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
        this.showStep('employeeInfoStep');
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
        ['employeeInfoStep', 'purposeStep', 'completionStep'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
        document.getElementById(stepId)?.classList.remove('hidden');
        this.setupLucide();
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
            // Check for existing active log first
            const checkRes = await fetch(`/api/logs?officeId=${this.officeId}`);
            if (checkRes.ok) {
                const logs = await checkRes.json();
                const activeLog = logs.find(l => 
                    l.studentNumber === 'EMPLOYEE_LOG' && 
                    l.studentName?.toLowerCase() === this.employeeName.toLowerCase() && 
                    !l.timeOut
                );
                
                if (activeLog) {
                    this.showToast('You are already clocked in!', 'warning');
                    document.getElementById('completionTitle').textContent = 'Already Clocked In';
                    document.getElementById('completionMessage').textContent = `You already have an active session started at ${new Date(activeLog.timeIn).toLocaleTimeString()}. Please clock out from the Faculty Hub when finished.`;
                    this.showStep('completionStep');
                    return;
                }
            }

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
