import { loadSystemSettings, applyThemeFromStorage } from './settings.js';

// Apply saved theme immediately
applyThemeFromStorage();

class HistoryManager {
    constructor() {
        this.allEntries = [];
        this.filteredEntries = [];
        this.currentPage = 1;
        this.entriesPerPage = 10; // Add this line
        this.officeId = 'engineering-office';
        this.init();
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const template = document.getElementById('toastTemplate');

        if (!container || !template) {
            console.error('Toast elements not found');
            alert(message); // Fallback
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

        // Animation and cleanup
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    init() {
        if (!document.getElementById('historyTableBody')) return;
        this.setupEventListeners();
        this.loadHistory();
    }

    setupEventListeners() {
        const filterForm = document.getElementById('historyFilterForm');
        const resetBtn = document.getElementById('resetHistoryFilters');
        const exportBtn = document.getElementById('exportHistoryBtn');

        if (filterForm) {
            filterForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.loadHistory();
            });
        }

        if (resetBtn) {
            resetBtn.addEventListener('click', () => {
                filterForm.reset();
                this.loadHistory();
            });
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportHistory());
        }

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
    }

    async loadHistory() {
        try {
            const tableBody = document.getElementById('historyTableBody');
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-8 py-32 text-center">
                        <div class="flex flex-col items-center justify-center">
                            <div class="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-6"></div>
                            <p class="font-black text-slate-400 uppercase tracking-widest text-xs">Fetching Firebase Data...</p>
                        </div>
                    </td>
                </tr>
            `;

            // Get filter values
            const startDateVal = document.getElementById('startDate').value;
            const endDateVal = document.getElementById('endDate').value;
            const activityVal = document.getElementById('activityFilter').value;
            const searchVal = document.getElementById('historySearch').value.toLowerCase();
            const yearLevelVal = document.getElementById('yearLevelFilter').value;
            const visitorTypeVal = document.getElementById('visitorTypeFilter').value;

            // Base query: Fetch logs from the local backend database
            const response = await fetch(`/api/logs?officeId=${this.officeId}`);
            if (!response.ok) throw new Error('Failed to fetch logs from local server');

            const fetchedLogs = await response.json();

            // Perform filtering client-side
            this.allEntries = fetchedLogs.filter(entry => {
                // Date Filtering
                let matchesDate = true;
                if (startDateVal || endDateVal) {
                    const entryDate = new Date(entry.timeIn);

                    if (startDateVal) {
                        const start = new Date(startDateVal);
                        start.setHours(0, 0, 0, 0);
                        if (entryDate < start) matchesDate = false;
                    }
                    if (endDateVal) {
                        const end = new Date(endDateVal);
                        end.setHours(23, 59, 59, 999);
                        if (entryDate > end) matchesDate = false;
                    }
                }

                // Activity Filtering
                const predefinedActivities = ['enrollment concern', 'document request', 'financial concern', 'inquiry'];
                let matchesActivity = true;
                if (activityVal) {
                    if (activityVal.toLowerCase() === 'others') {
                        matchesActivity = entry.activity &&
                            !predefinedActivities.includes(entry.activity.toLowerCase());
                    } else {
                        matchesActivity = entry.activity === activityVal;
                    }
                }

                // Year Level Filtering
                const matchesYear = !yearLevelVal || entry.yearLevel === yearLevelVal || entry['Year Level'] === yearLevelVal;

                // Visitor Type Filtering
                let matchesVisitorType = true;
                if (visitorTypeVal) {
                    const sn = (entry.studentNumber || '').toUpperCase();
                    const act = (entry.activity || '');
                    const isParent = sn === 'PARENT_VISIT' || act.startsWith('[Parent]');
                    const isEmployee = sn === 'EMPLOYEE_LOG' || act.startsWith('[Employee]');
                    const isVisitor = sn === 'VISITOR_VISIT' || act.startsWith('[Visitor]');
                    const isStudent = !isParent && !isEmployee && !isVisitor;

                    switch (visitorTypeVal) {
                        case 'parent':   matchesVisitorType = isParent;   break;
                        case 'employee': matchesVisitorType = isEmployee; break;
                        case 'visitor':  matchesVisitorType = isVisitor;  break;
                        case 'student':  matchesVisitorType = isStudent;  break;
                    }
                }

                // Search filtering (Name, ID, Number)
                const matchesSearch = !searchVal ||
                    (entry.studentName && entry.studentName.toLowerCase().includes(searchVal)) ||
                    (entry.studentNumber && entry.studentNumber.toLowerCase().includes(searchVal)) ||
                    (entry.studentId && entry.studentId.toLowerCase().includes(searchVal));

                return matchesDate && matchesActivity && matchesYear && matchesVisitorType && matchesSearch;
            });

            this.filteredEntries = [...this.allEntries];
            this.currentPage = 1;
            this.displayHistory();

        } catch (error) {
            console.error('❌ Firebase History Load Error:', error);
            document.getElementById('historyTableBody').innerHTML = `
                <tr>
                    <td colspan="5" class="px-8 py-32 text-center text-red-500 font-bold">
                        <i data-lucide="alert-circle" class="w-12 h-12 mx-auto mb-4"></i>
                        <p>Failed to load data from Firebase.</p>
                        <p class="text-xs font-mono mt-2 text-red-400">${error.message}</p>
                    </td>
                </tr>
            `;
            if (window.lucide) lucide.createIcons();
        }
    }

    displayHistory() {
        const tableBody = document.getElementById('historyTableBody');
        const startIndex = (this.currentPage - 1) * this.entriesPerPage;
        const endIndex = startIndex + this.entriesPerPage;
        const pageEntries = this.filteredEntries.slice(startIndex, endIndex);

        if (pageEntries.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="5" class="px-8 py-32 text-center">
                        <div class="bg-slate-50 dark:bg-slate-700 rounded-3xl p-12 inline-block">
                            <i data-lucide="database-zap" class="w-12 h-12 text-slate-300 mx-auto mb-4"></i>
                            <h3 class="text-slate-900 dark:text-white font-black text-lg">No records found</h3>
                            <p class="text-slate-400 font-bold text-sm">Try adjusting your search or filters</p>
                        </div>
                    </td>
                </tr>
            `;
            this.updatePagination();
            return;
        }

        tableBody.innerHTML = pageEntries.map(entry => {
            const duration = this.calculateDuration(entry.timeIn, entry.timeOut);
            return `
            <tr class="hover:bg-slate-50/50 dark:hover:bg-slate-700/50 transition-colors group">
                <td class="px-8 py-6">
                    <p class="font-bold text-slate-700 dark:text-slate-300 leading-none mb-1">${this.formatDate(entry.timeIn)}</p>
                    <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest">${this.formatTime(entry.timeIn)}</p>
                </td>
                <td class="px-8 py-6">
                    <div class="flex items-center gap-4">
                        <div class="w-10 h-10 rounded-2xl bg-slate-100 flex items-center justify-center text-slate-500 font-black text-xs border border-white shadow-sm">
                            ${(entry.studentName || '?').charAt(0)}
                        </div>
                        <div>
                            <p class="font-black text-slate-900 dark:text-white leading-none mb-1.5">${entry.studentName || 'Unknown Student'}</p>
                            <p class="text-[10px] font-mono text-slate-400 uppercase tracking-widest">${entry.studentNumber || 'No NFC Chip'}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-6 font-bold text-slate-600 text-xs text-center">
                    ${(entry.studentNumber === 'PARENT_VISIT' || entry.studentNumber === 'EMPLOYEE_LOG' || entry.studentNumber === 'VISITOR_VISIT' || (entry.activity && (entry.activity.startsWith('[Parent]') || entry.activity.startsWith('[Employee]') || entry.activity.startsWith('[Visitor]')))) 
                        ? '---' 
                        : (entry.yearLevel || entry['Year Level'] || '---')}
                </td>
                <td class="px-6 py-6">
                    <div class="space-y-1">
                        <span class="px-3 py-1 text-[10px] font-black rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-white border border-blue-100 dark:border-blue-900/20 uppercase tracking-widest leading-none">
                            ${entry.activity || 'N/A'}
                        </span>
                        ${entry.proofImage ? `
                            <button onclick="historyManager.viewProof('${entry.proofImage}')" 
                                class="flex items-center gap-1.5 text-[10px] font-bold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 px-3 py-1.5 rounded-full transition-all border border-violet-100 dark:border-violet-900/50 mt-1.5">
                                <i data-lucide="file-check" class="w-3 h-3"></i> View Proof
                            </button>
                        ` : ''}
                    </div>
                </td>
                <td class="px-6 py-6 text-center">
                    ${duration
                    ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black border border-slate-100 dark:border-slate-600">
                          <i data-lucide="hourglass" class="w-3 h-3"></i>
                          ${duration}
                       </span>`
                    : '<span class="text-slate-300 dark:text-slate-600">---</span>'
                }
                </td>
                <td class="px-6 py-6 text-center">
                    ${entry.timeOut
                    ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-400 text-[9px] font-black uppercase tracking-widest border border-slate-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-slate-300"></div> Completed
                           </span>`
                    : `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-600 text-[9px] font-black uppercase tracking-widest border border-emerald-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div> Active Visit
                           </span>`
                }
                </td>
                <td class="px-8 py-6 text-right">
                    <p class="text-xs font-bold text-slate-600">${(entry.staffEmail || 'system').split('@')[0]}</p>
                </td>
            </tr>
        `;
        }).join('');

        this.updatePagination();
    }

    updatePagination() {
        const pagination = document.getElementById('historyPagination');
        const totalPages = Math.ceil(this.filteredEntries.length / this.entriesPerPage);

        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let html = `<li><button class="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-30" ${this.currentPage === 1 ? 'disabled' : ''} onclick="historyManager.goToPage(${this.currentPage - 1})">Prev</button></li>`;

        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.currentPage - 1 && i <= this.currentPage + 1)) {
                html += `<li><button class="w-10 h-10 flex items-center justify-center rounded-xl font-black text-xs ${i === this.currentPage ? 'bg-blue-600 text-white shadow-lg' : 'bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50'}" onclick="historyManager.goToPage(${i})">${i}</button></li>`;
            } else if (i === this.currentPage - 2 || i === this.currentPage + 2) {
                html += `<li><span class="text-slate-300 font-black">...</span></li>`;
            }
        }

        html += `<li><button class="px-5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-xs font-black uppercase tracking-widest text-slate-500 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-30" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="historyManager.goToPage(${this.currentPage + 1})">Next</button></li>`;

        pagination.innerHTML = html;
        if (window.lucide) lucide.createIcons();
    }

    goToPage(page) {
        this.currentPage = page;
        this.displayHistory();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    async exportHistory() {
        if (this.filteredEntries.length === 0) {
            this.showToast('No records to export');
            return;
        }

        const headers = ['Date', 'Time In', 'Time Out', 'Duration', 'Name', 'NFC Number', 'ID Number', 'Year Level', 'Activity', 'Visited Staff', 'Officer'];
        const rows = this.filteredEntries.map(e => [
            this.formatDate(e.timeIn),
            this.formatTime(e.timeIn),
            e.timeOut ? this.formatTime(e.timeOut) : '---',
            this.calculateDuration(e.timeIn, e.timeOut) || '---',
            e.studentName,
            e.studentNumber,
            e.studentId || 'N/A',
            e.yearLevel || e['Year Level'] || 'N/A',
            e.activity,
            e.staff || 'N/A',
            e.staffEmail || 'N/A'
        ]);

        const csv = [headers, ...rows]
            .map(r => r.map(f => `"${String(f).replace(/"/g, '""')}"`).join(','))
            .join('\n');

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logbook_audit_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }

    formatDate(ts) {
        if (!ts) return 'N/A';
        const d = new Date(ts);
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    formatTime(ts) {
        if (!ts) return 'N/A';
        const d = new Date(ts);
        return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
    }
    calculateDuration(timeIn, timeOut) {
        if (!timeIn || !timeOut) return null;

        const start = this.getTimestamp(timeIn);
        const end = this.getTimestamp(timeOut);

        if (!start || !end) return null;

        const diffMs = end - start;
        if (diffMs < 0) return null;

        const diffMins = Math.floor(diffMs / (1000 * 60));
        const hours = Math.floor(diffMins / 60);
        const mins = diffMins % 60;

        if (hours > 0) {
            return `${hours}h ${mins}m`;
        }
        return `${mins}m`;
    }

    getTimestamp(timeValue) {
        if (!timeValue) return null;
        if (typeof timeValue === 'object' && timeValue._seconds !== undefined) {
            return timeValue._seconds * 1000;
        }
        if (timeValue.toDate) {
            return timeValue.toDate().getTime();
        }
        const d = new Date(timeValue);
        return isNaN(d) ? null : d.getTime();
    }

    viewProof(url) {
        const modal = document.getElementById('proofViewerModal');
        const img = document.getElementById('proofImageElement');
        const iframe = document.getElementById('proofPdfElement');
        if (modal) {
            if (url.toLowerCase().endsWith('.pdf')) {
                if (img) img.classList.add('hidden');
                if (iframe) {
                    iframe.src = url;
                    iframe.classList.remove('hidden');
                }
            } else {
                if (iframe) iframe.classList.add('hidden');
                if (img) {
                    img.src = url;
                    img.classList.remove('hidden');
                }
            }
            modal.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
        }
    }
}

window.historyManager = new HistoryManager();
