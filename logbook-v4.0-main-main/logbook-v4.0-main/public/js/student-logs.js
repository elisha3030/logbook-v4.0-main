import { loadSystemSettings, applyThemeFromStorage } from './settings.js';

// Apply saved theme immediately
applyThemeFromStorage();

class StudentKioskManager {
    constructor() {
        this.currentStudent = null;
        this.selectedActivity = null;
        this.selectedFaculty = null;
        this.barcodeBuffer = '';
        this.lastBarcodeKeyTime = 0;
        this.systemSettings = {};
        this.officeId = 'engineering-office'; // fallback
        this.init();
    }

    async init() {
        await this.loadAndApplySettings();
        this.setupEventListeners();
        this.setupLucide();
    }

    async loadAndApplySettings() {
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
        if (icon) {
            if (type === 'error') {
                icon.setAttribute('data-lucide', 'alert-circle');
                icon.classList.remove('text-emerald-400');
                icon.classList.add('text-red-400');
                toast.classList.remove('bg-slate-900/90');
                toast.classList.add('bg-red-500/95');
            } else if (type === 'warning') {
                icon.setAttribute('data-lucide', 'alert-triangle');
                icon.classList.remove('text-emerald-400');
                icon.classList.add('text-amber-400');
            }
        }

        container.appendChild(toast);
        if (window.lucide) window.lucide.createIcons();

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 4000);
    }

    setupEventListeners() {
        // Global Barcode/RFID Listener
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.ctrlKey || e.altKey || e.metaKey) return;

            const now = Date.now();
            if (now - this.lastBarcodeKeyTime > 100) this.barcodeBuffer = '';
            this.lastBarcodeKeyTime = now;

            if (e.key === 'Enter') {
                if (this.barcodeBuffer.length >= 4) {
                    console.log('📦 Scan detected:', this.barcodeBuffer);
                    const scannedValue = this.barcodeBuffer;
                    this.barcodeBuffer = '';
                    this.handleScan(scannedValue);
                } else {
                    this.barcodeBuffer = '';
                }
            } else if (e.key.length === 1) {
                this.barcodeBuffer += e.key;
            }
        });

        // Navigation & Action Buttons
        document.getElementById('cancelTimeOutBtn')?.addEventListener('click', () => this.resetUI());
        document.getElementById('cancelActivityBtn')?.addEventListener('click', () => this.resetUI());
        document.getElementById('backToActivityBtn')?.addEventListener('click', () => this.showDetailsPrompt());
        document.getElementById('switchStudentBtn')?.addEventListener('click', () => this.resetUI());
        document.getElementById('proceedToTransactionBtn')?.addEventListener('click', () => this.showActivitySelection());

        // Landing Selection Actions
        document.getElementById('viewHistoryLandingBtn')?.addEventListener('click', () => {
            if (this.currentStudent) this.showStudentHistory(this.currentStudent);
        });
        document.getElementById('startTransactionLandingBtn')?.addEventListener('click', () => {
            if (this.currentStudent) this.showActivitySelection();
        });
        document.getElementById('cancelLandingBtn')?.addEventListener('click', () => this.resetUI());
        document.getElementById('backFromHistoryBtn')?.addEventListener('click', () => {
            if (this.currentStudent) this.showLandingSelection(this.currentStudent);
        });

        // Close proof modal
        const closeBtn = document.getElementById('closeProofModal');
        const closeBtn2 = document.getElementById('closeProofModalBtn');
        const modal = document.getElementById('proofViewerModal');
        [closeBtn, closeBtn2].forEach(btn => {
            btn?.addEventListener('click', () => modal?.classList.add('hidden'));
        });
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) modal.classList.add('hidden');
        });

        document.getElementById('submitCustomActivityBtn')?.addEventListener('click', () => {
            const input = document.getElementById('customActivityInput');
            const customVal = input?.value.trim();
            if (!customVal) {
                this.showToast('Please specify your activity.', 'warning');
                return;
            }
            this.selectedActivity = customVal;
            this.showDetailsPrompt();
        });

        document.getElementById('customActivityInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') document.getElementById('submitCustomActivityBtn')?.click();
        });

        // Navigation: Details Step
        document.getElementById('backToActivityFromDetailsBtn')?.addEventListener('click', () => this.showActivitySelection());
        document.getElementById('skipDetailsBtn')?.addEventListener('click', () => this.submitDetails(''));

        document.getElementById('transactionDetailsSelect')?.addEventListener('change', (e) => {
            const input = document.getElementById('transactionDetailsInput');
            if (!input) return;
            if (e.target.value === 'Others') {
                input.classList.remove('hidden');
                input.focus();
            } else {
                input.classList.add('hidden');
            }
        });

        document.getElementById('submitDetailsBtn')?.addEventListener('click', () => {
            const select = document.getElementById('transactionDetailsSelect');
            const input = document.getElementById('transactionDetailsInput');
            let details = '';
            if (select && !select.classList.contains('hidden')) {
                details = select.value;
            }
            if ((details === 'Others' || !details) && input && !input.classList.contains('hidden')) {
                details = input.value;
            }

            if (!details && (!select || select.value !== '')) {
                this.showToast('Please specify a purpose.', 'warning');
                return;
            }
            this.submitDetails(details || '');
        });

        document.getElementById('transactionDetailsInput')?.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                document.getElementById('submitDetailsBtn')?.click();
            }
        });

        document.getElementById('ignoreTimeOutBtn')?.addEventListener('click', () => {
            this.showActivitySelection();
        });

        document.getElementById('confirmTimeOutBtn')?.addEventListener('click', () => {
            this.handleTimeOut();
        });

        // Manual Entry Form Flow
        document.getElementById('showManualFormBtn')?.addEventListener('click', () => {
            document.getElementById('manualEntryInitial')?.classList.add('hidden');
            document.getElementById('manualEntryForm')?.classList.remove('hidden');
            document.getElementById('manualName')?.focus();
        });

        document.getElementById('cancelManualBtn')?.addEventListener('click', () => {
            document.getElementById('manualEntryForm')?.classList.add('hidden');
            document.getElementById('manualEntryInitial')?.classList.remove('hidden');
            // Clear inputs
            ['manualName', 'manualId', 'manualProgram', 'manualYear'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        });

        document.getElementById('submitManualBtn')?.addEventListener('click', async () => {
            const name = document.getElementById('manualName')?.value.trim();
            const id = document.getElementById('manualId')?.value.trim();
            const program = document.getElementById('manualProgram')?.value.trim();
            const year = document.getElementById('manualYear')?.value.trim();

            if (!name || !id || !program || !year) {
                this.showToast('Please fill in all fields.', 'warning');
                return;
            }

            // Attempt to look up the student ID to link with registered info
            try {
                const response = await fetch(`/api/students/${id}?officeId=${this.officeId}`);
                if (response.ok) {
                    const student = await response.json();
                    this.currentStudent = student;
                    
                    // Show a welcoming toast if found
                    this.showToast(`Using registered profile for ${student.name}`);

                    // Use registered data but allow the session to proceed
                    // If they have active logs, we follow the scan logic
                    if (student.activeLogs && student.activeLogs.length > 0) {
                        this.showTimeOutPrompt(student);
                    } else {
                        this.showLandingSelection(student);
                    }
                    return;
                }
            } catch (error) {
                console.warn('Manual lookup check failed, proceeding with guest details:', error);
            }

            // Create a "virtual" student object from manual input (Fallback/Guest)
            const virtualStudent = {
                id: id, // Internal reference
                name: name,
                studentId: id, // Readable ID
                course: program,
                yearLevel: year,
                isManual: true,
                activeLogs: [] // Manual entries won't have active logs to resume
            };

            this.currentStudent = virtualStudent;
            this.showLandingSelection(virtualStudent); // Proceed to landing selection
        });

        // Add Enter key support for manual fields
        ['manualName', 'manualId', 'manualProgram', 'manualYear'].forEach(id => {
            document.getElementById(id)?.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') document.getElementById('submitManualBtn')?.click();
            });
        });
    }

    // handleManualId(id) was removed in favor of direct form handling

    async handleScan(id) {
        try {
            const response = await fetch(`/api/students/${id}?officeId=${this.officeId}`);
            if (!response.ok) {
                if (response.status === 404) {
                    this.showToast('Student not registered. Please see staff.', 'error');
                } else {
                    throw new Error('Lookup failed');
                }
                return;
            }

            const student = await response.json();
            this.currentStudent = student;
            this.playBeep(true);

            // Check for active sessions
            if (student.activeLogs && student.activeLogs.length > 0) {
                this.showTimeOutPrompt(student);
            } else {
                this.showLandingSelection(student); // Show landing selection
            }
        } catch (error) {
            console.error('Scan handling error:', error);
            this.showToast('Scanner error. Please try again.', 'error');
        }
    }

    playBeep(success = true) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.setValueAtTime(success ? 880 : 440, ctx.currentTime);
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch { }
    }

    hideAllScreens() {
        const screens = [
            'scanPrompt', 'manualEntryForm', 'landingSelection',
            'timeOutPrompt', 'activitySelection', 'otherActivitySection',
            'detailsSelection', 'facultySelection', 'logContent'
        ];
        screens.forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });
    }

    resetUI() {
        this.currentStudent = null;
        this.selectedActivity = null;
        this.selectedDetails = null;
        this.selectedFaculty = null;
        this.barcodeBuffer = '';

        this.hideAllScreens();
        
        // Show scan prompt only
        document.getElementById('scanPrompt')?.classList.remove('hidden');
        document.getElementById('manualEntryInitial')?.classList.remove('hidden');
        document.getElementById('manualEntryForm')?.classList.add('hidden');

        // Reset inputs
        const customInput = document.getElementById('customActivityInput');
        if (customInput) customInput.value = '';
        const detailsSelect = document.getElementById('transactionDetailsSelect');
        if (detailsSelect) detailsSelect.value = '';
        const detailsInput = document.getElementById('transactionDetailsInput');
        if (detailsInput) {
            detailsInput.value = '';
            detailsInput.classList.add('hidden');
        }

        const manualInput = document.getElementById('manualStudentId');
        if (manualInput) manualInput.value = '';

        this.setupLucide();
    }

    showLandingSelection(student) {
        this.hideAllScreens();

        const landing = document.getElementById('landingSelection');
        if (!landing) return;

        landing.classList.remove('hidden');
        const nameEl = document.getElementById('landingStudentName');
        if (nameEl) nameEl.textContent = student.name.split(' ')[0];

        this.setupLucide();
    }

    showTimeOutPrompt(student) {
        this.hideAllScreens();

        const prompt = document.getElementById('timeOutPrompt');
        if (!prompt) return;

        prompt.classList.remove('hidden');
        const nameEl = document.getElementById('timeOutStudentName');
        if (nameEl) nameEl.textContent = student.name.split(' ')[0];

        const confirmBtn = document.getElementById('confirmTimeOutBtn');
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.classList.remove('cursor-not-allowed', 'opacity-50');
            confirmBtn.classList.add('bg-[#FF2E36]', 'text-white', 'hover:-translate-y-1', 'active:scale-95');
            const subtext = document.getElementById('timeOutSubtext');
            if (subtext) subtext.textContent = 'Confirm your departure';
            document.getElementById('statusBadge')?.classList.add('hidden');
        }

        this.setupLucide();
    }

    async handleTimeOut() {
        if (!this.currentStudent || !this.currentStudent.activeLogs?.[0]) return;

        const log = this.currentStudent.activeLogs[0];
        try {
            const res = await fetch(`/api/logs/${log.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ officeId: this.officeId })
            });

            if (res.ok) {
                this.showToast('Successfully timed out. Thank you!', 'success');
                this.resetUI();
            } else {
                this.showToast('Failed to time out. Please see staff.', 'error');
            }
        } catch (e) {
            this.showToast('Network error during time out.', 'error');
        }
    }

    showStudentHistory(student) {
        this.hideAllScreens();

        const logContent = document.getElementById('logContent');
        if (!logContent) return;

        logContent.classList.remove('hidden');
        const nameEl = document.getElementById('studentName');
        if (nameEl) nameEl.textContent = student.name;
        const idEl = document.getElementById('studentIdDisplay');
        if (idEl) idEl.textContent = student.studentId || student.id;
        const progEl = document.getElementById('studentProgram');
        if (progEl) progEl.textContent = student.Course || student.course || 'N/A';

        this.fetchAndRenderLogs(student.id);
        this.setupLucide();
    }

    async fetchAndRenderLogs(studentNumber) {
        const tableBody = document.getElementById('studentTableBody');
        const noLogs = document.getElementById('noLogsMessage');
        if (!tableBody) return;

        tableBody.innerHTML = '';
        try {
            const res = await fetch(`/api/logs?studentNumber=${studentNumber}&limit=10`);
            const logs = await res.json();

            if (logs.length === 0) {
                noLogs?.classList.remove('hidden');
            } else {
                noLogs?.classList.add('hidden');
                logs.forEach(log => {
                    const row = document.createElement('tr');
                    const date = new Date(log.timeIn).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
                    const statusClass = log.timeOut ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
                    const statusText = log.timeOut ? 'Completed' : 'Active';

                    let proofAction = '';
                    if (log.proofImage) {
                        proofAction = `
                            <button onclick="window.kioskManager.viewProof('${log.proofImage}')" 
                                class="mt-2 inline-flex items-center gap-1.5 text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 px-3 py-1.5 rounded-full transition-all border border-violet-100 dark:border-violet-900/50">
                                <i data-lucide="image" class="w-3 h-3"></i> View Proof
                            </button>
                        `;
                    }

                    row.innerHTML = `
                        <td class="px-8 py-5 font-bold text-slate-500 dark:text-slate-400 text-xs">${date}</td>
                        <td class="px-6 py-5">
                            <span class="block font-black text-slate-800 dark:text-white text-sm leading-tight">${log.activity || '<span class="text-slate-400 font-normal italic">—</span>'}</span>
                            ${proofAction}
                        </td>
                        <td class="px-6 py-5 text-center">
                            <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${statusClass}">${statusText}</span>
                        </td>
                        <td class="px-8 py-5 text-right font-bold text-slate-500 dark:text-slate-300 text-xs">${log.staff || '---'}</td>
                    `;
                    tableBody.appendChild(row);
                });
            }
        } catch (e) {
            console.error('Failed to fetch logs:', e);
        }
    }

    showActivitySelection() {
        this.hideAllScreens();

        const activitySection = document.getElementById('activitySelection');
        if (!activitySection) return;

        activitySection.classList.remove('hidden');
        document.getElementById('otherActivitySection')?.classList.add('hidden');
        document.getElementById('activityGrid')?.classList.remove('hidden');

        const nameEl = document.getElementById('scannedStudentFirstName');
        if (nameEl) nameEl.textContent = this.currentStudent.name.split(' ')[0];

        this.renderActivities();
        this.setupLucide();
    }

    renderActivities() {
        const grid = document.getElementById('activityGrid');
        if (!grid) return;

        let activities = ['Enrollment Concern', 'Document Request', 'Financial Concern', 'Inquiry', 'Others'];
        if (this.systemSettings.activities) {
            try { activities = JSON.parse(this.systemSettings.activities); } catch { }
        }

        grid.innerHTML = activities.map(act => `
            <button onclick="window.kioskManager.selectActivity('${act}')"
                class="group bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-blue-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                <div class="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-900/30 text-blue-600 flex items-center justify-center group-hover:bg-blue-600 group-hover:text-white transition-all">
                    <i data-lucide="circle-dot" class="w-6 h-6"></i>
                </div>
                <p class="text-sm font-black text-slate-900 dark:text-white uppercase tracking-tight">${act}</p>
            </button>
        `).join('');
        this.setupLucide();
    }

    selectActivity(activity) {
        if (activity === 'Others') {
            document.getElementById('activityGrid')?.classList.add('hidden');
            const otherSection = document.getElementById('otherActivitySection');
            if (otherSection) {
                otherSection.classList.remove('hidden');
                otherSection.scrollIntoView({ behavior: 'smooth' });
                document.getElementById('customActivityInput')?.focus();
            }
            return;
        }
        this.selectedActivity = activity;
        this.showDetailsPrompt();
    }

    showDetailsPrompt() {
        this.hideAllScreens();

        const detailsSection = document.getElementById('detailsSelection');
        if (!detailsSection) return;

        detailsSection.classList.remove('hidden');

        const actNameEl = document.getElementById('detailsActivityName');
        if (actNameEl) actNameEl.textContent = this.selectedActivity;

        this.renderDetailsOptions();

        this.setupLucide();
    }

    renderDetailsOptions() {
        const select = document.getElementById('transactionDetailsSelect');
        const input = document.getElementById('transactionDetailsInput');
        if (!select || !input) return;

        const optionsMap = {
            'Enrollment Concern': ['Adding/Dropping of Subjects', 'Sectioning', 'Block Enrollment', 'Irregular Status', 'Overload Request', 'Others'],
            'Document Request': ['True Copy of Grades (TCG)', 'Certificate of Enrollment', 'Good Moral Character', 'Course Syllabus', 'Clearance', 'Others'],
            'Financial Concern': ['Promissory Note', 'Scholarship Inquiry', 'Tuition Fee Assessment', 'Refund', 'Others'],
            'Inquiry': ['Grade Follow-up', 'Schedule of Classes', 'Professor Availability', 'Event/Activity Details', 'Others'],
            'Others': ['Please specify']
        };

        const defaultOptions = ['General Consultation', 'Follow-up', 'Submission of Requirements', 'Others'];

        const options = optionsMap[this.selectedActivity] || defaultOptions;

        select.innerHTML = `<option value="" disabled selected>Select specific purpose...</option>` +
            options.map(opt => `<option value="${opt}">${opt}</option>`).join('');

        // Reset state
        select.classList.remove('hidden');
        input.classList.add('hidden');
        input.value = '';

        // If 'Others' is the only option, just show the input
        if (options.length === 1 && options[0] === 'Please specify') {
            select.classList.add('hidden');
            input.classList.remove('hidden');
            input.focus();
        }
    }

    submitDetails(details) {
        this.selectedDetails = details.trim();
        this.showFacultySelection();
    }

    showFacultySelection() {
        this.hideAllScreens();

        const facultySection = document.getElementById('facultySelection');
        if (!facultySection) return;

        facultySection.classList.remove('hidden');
        const actEl = document.getElementById('selectedActivityName');
        if (actEl) actEl.textContent = this.selectedActivity;
        this.renderFaculty();
        this.setupLucide();
    }

    escape(str) {
        return String(str || '').replace(/'/g, "\\'");
    }

    async renderFaculty() {
        const grid = document.getElementById('facultyGrid');
        if (!grid) return;

        grid.innerHTML = `
            <div class="col-span-full flex justify-center py-10">
                <div class="animate-spin rounded-full h-8 w-8 border-4 border-emerald-500 border-t-transparent"></div>
            </div>
        `;

        try {
            const res = await fetch('/api/faculty');
            const faculties = await res.json();

            if (!faculties || faculties.length === 0) {
                grid.innerHTML = '<p class="text-slate-400 font-bold col-span-full py-10 text-center">No faculty members registered.</p>';
            } else {
                grid.innerHTML = faculties.map(f => `
                    <button onclick="window.kioskManager.logVisit('${this.escape(f.name)}')"
                        class="group bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-emerald-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                        <div class="w-12 h-12 rounded-full overflow-hidden border-2 border-slate-100 flex-shrink-0">
                            ${f.photoURL ? `<img src="${f.photoURL}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-emerald-50 flex items-center justify-center text-emerald-500 font-bold">${(f.name || 'S').charAt(0).toUpperCase()}</div>`}
                        </div>
                        <div>
                            <p class="text-sm font-black text-slate-900 dark:text-white leading-tight truncate max-w-[150px]">${f.name}</p>
                            <p class="text-[9px] font-bold text-slate-400 uppercase mt-1">${f.position || 'Staff'}</p>
                        </div>
                    </button>
                `).join('');
            }

            // Add a "Generic/Other" option
            grid.innerHTML += `
                <button onclick="window.kioskManager.logVisit('General Staff')"
                    class="group bg-white dark:bg-slate-800 p-6 rounded-[2rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-slate-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-4 text-center">
                    <div class="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                        <i data-lucide="users" class="w-6 h-6"></i>
                    </div>
                    <p class="text-sm font-black text-slate-400 uppercase">Skip Selection</p>
                </button>
            `;

        } catch (e) {
            console.error('Faculty fetch error:', e);
            grid.innerHTML = '<p class="text-red-500 font-bold col-span-full py-10 text-center">Failed to load faculty list.</p>';
        }
        this.setupLucide();
    }

    async logVisit(facultyName) {
        this.selectedFaculty = facultyName;

        try {
            // Combine activity and details if provided
            let finalActivity = this.selectedActivity || 'General Visit';
            if (this.selectedDetails) {
                finalActivity += ` - ${this.selectedDetails}`;
            }

            const logData = {
                studentNumber: this.currentStudent.id,
                studentName: this.currentStudent.name,
                studentId: this.currentStudent.studentId || 'N/A',
                activity: finalActivity,
                staff: facultyName,
                yearLevel: this.currentStudent['Year Level'] || this.currentStudent.yearLevel || 'N/A',
                course: this.currentStudent.Course || this.currentStudent.course || 'N/A',
                date: new Date().toISOString().split('T')[0]
            };

            const response = await fetch('/api/logs', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logData, officeId: this.officeId })
            });

            if (response.ok) {
                this.showToast(`Visit logged: ${finalActivity}`);
                this.showStudentHistory(this.currentStudent);
            } else {
                throw new Error('Log failed');
            }
        } catch (e) {
            this.showToast('Failed to log visit. Please see staff.', 'error');
        }
    }

    viewProof(url) {
        const modal = document.getElementById('proofViewerModal');
        const img = document.getElementById('proofImageElement');
        if (modal && img) {
            img.src = url;
            modal.classList.remove('hidden');
            this.setupLucide();
        }
    }
}

// Global instance for inline event handlers
window.kioskManager = new StudentKioskManager();
