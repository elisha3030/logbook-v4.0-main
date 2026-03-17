// Logs Management Module — offline-first, all data via REST API
import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately
applyThemeFromStorage();

class LogsManager {
    constructor() {
        this.entries = [];
        this.currentPage = 1;
        this.entriesPerPage = 10;
        this.filteredEntries = [];
        this.officeId = 'engineering-office'; // overridden by settings
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

    async init() {
        // Load settings first
        this.systemSettings = {};
        try {
            const settings = await loadSystemSettings();
            this.systemSettings = settings;
            if (settings.officeId) this.officeId = settings.officeId;

            // Apply office name to dashboard header
            if (settings.officeName) {
                const subtitle = document.querySelector('.text-slate-500.font-medium');
                if (subtitle) subtitle.textContent = `Monitoring ${settings.officeName} traffic & logs`;

                // Update sidebar name
                const sidebarName = document.getElementById('sidebarOfficeName');
                if (sidebarName) sidebarName.innerHTML = settings.officeName + '<span class="text-blue-500">.</span>';

                // Update document title
                document.title = `${settings.officeName} - Dashboard`;
            }
        } catch (e) { /* proceed with defaults */ }

        // Only initialize if we're on the dashboard page
        if (window.location.pathname.includes('dashboard.html') || document.getElementById('entriesTableBody')) {
            this.setupEventListeners();
            this.loadEntries();
            this.updateStats();
        } else {
            console.log('📊 LogsManager: Not on dashboard page, skipping initialization');
        }
    }

    setupEventListeners() {
        const searchInput = document.getElementById('searchInput');
        const activityFilter = document.getElementById('activityFilter');
        const dateFilter = document.getElementById('dateFilter');
        const visitorTypeFilter = document.getElementById('visitorTypeFilter');
        const insightTimeFilter = document.getElementById('insightTimeFilter');
        const exportBtn = document.getElementById('exportBtn');
        const refreshBtn = document.getElementById('refreshBtn');
        const printBtn = document.getElementById('printBtn');
        const generateReportBtn = document.getElementById('generateReportBtn');
        const deleteEntryBtn = document.getElementById('deleteEntryBtn');

        if (searchInput) {
            searchInput.addEventListener('input', () => this.filterEntries());
        }

        if (activityFilter) {
            activityFilter.addEventListener('change', () => this.filterEntries());
        }

        if (dateFilter) {
            dateFilter.addEventListener('change', () => this.filterEntries());
        }

        if (visitorTypeFilter) {
            visitorTypeFilter.addEventListener('change', () => this.filterEntries());
        }

        if (insightTimeFilter) {
            insightTimeFilter.addEventListener('change', () => this.updateInsights());
        }

        if (exportBtn) {
            exportBtn.addEventListener('click', () => this.exportToCSV());
        }

        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                this.loadEntries();
                this.updateStats();
            });
        }

        if (printBtn) {
            printBtn.addEventListener('click', () => this.printReport());
        }

        if (generateReportBtn) {
            generateReportBtn.addEventListener('click', () => this.generatePDFReport());
        }

        if (deleteEntryBtn) {
            deleteEntryBtn.addEventListener('click', () => this.deleteCurrentEntry());
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

    async loadEntries() {
        try {
            const entriesTableBody = document.getElementById('entriesTableBody');

            // Check if we're on the dashboard page
            if (!entriesTableBody) {
                console.log('📊 Not on dashboard page, skipping entries load');
                return;
            }

            entriesTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-12 text-center bg-white dark:bg-slate-800">
                        <div class="flex flex-col items-center justify-center">
                            <div class="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent mb-4"></div>
                            <p class="font-medium text-slate-500">Loading entries...</p>
                        </div>
                    </td>
                </tr>
            `;

            // Fetch entries from the backend API
            const response = await fetch(`/api/logs?officeId=${this.officeId}`);
            const data = await response.json();

            if (!response.ok) throw new Error(data.error || 'Failed to fetch logs');

            this.entries = data.map(entry => {
                // Backend already provides id and data
                // Convert timestamp strings to readable dates if they aren't already
                if (entry.timeIn && typeof entry.timeIn === 'object' && entry.timeIn._seconds) {
                    // Handle Firestore timestamp objects if they come through raw
                    entry.timestamp = new Date(entry.timeIn._seconds * 1000).toISOString();
                } else if (entry.timeIn) {
                    entry.timestamp = new Date(entry.timeIn).toISOString();
                }

                if (entry.timeOut) {
                    const timeOutDate = (entry.timeOut._seconds)
                        ? new Date(entry.timeOut._seconds * 1000)
                        : new Date(entry.timeOut);
                    entry.timeOutFormatted = timeOutDate.toLocaleTimeString();
                }
                return entry;
            });

            this.filteredEntries = [...this.entries];
            this.filterEntries(); // Correctly apply filters after loading
            this.updateStats();
            this.updateInsights();

        } catch (error) {
            console.error('❌ Error loading entries:', error);
            const entriesTableBody = document.getElementById('entriesTableBody');
            entriesTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-12 text-center bg-white dark:bg-slate-800">
                        <div class="p-4 rounded-xl bg-red-50 border border-red-100 text-red-600 inline-block mx-auto">
                            <i data-lucide="alert-circle" class="w-6 h-6 mx-auto mb-2"></i>
                            <strong class="block">Error loading entries</strong>
                            <p class="text-sm mt-1">Please try refreshing the page.</p>
                        </div>
                    </td>
                </tr>
            `;
            lucide.createIcons();
        }
    }

    filterEntries() {
        const searchInput = document.getElementById('searchInput');
        const activityFilter = document.getElementById('activityFilter');
        const dateFilter = document.getElementById('dateFilter');
        const visitorTypeFilter = document.getElementById('visitorTypeFilter');

        const searchTerm = searchInput ? searchInput.value.toLowerCase() : '';
        const activityValue = activityFilter ? activityFilter.value : '';
        const dateValue = dateFilter ? dateFilter.value : '';
        const visitorTypeValue = visitorTypeFilter ? visitorTypeFilter.value : '';

        // Predefined activity values (must match what's in the scan form dropdown)
        let predefinedActivities = ['Enrollment Concern', 'Document Request', 'Financial Concern', 'Inquiry'];
        if (this.systemSettings && this.systemSettings.activities) {
            try {
                const parsed = JSON.parse(this.systemSettings.activities);
                if (Array.isArray(parsed) && parsed.length > 0) predefinedActivities = parsed;
            } catch { }
        }

        this.filteredEntries = this.entries.filter(entry => {
            // Search filter
            const matchesSearch = !searchTerm ||
                (entry.studentName && entry.studentName.toLowerCase().includes(searchTerm)) ||
                (entry.studentNumber && entry.studentNumber.toLowerCase().includes(searchTerm));

            // Activity filter — "Others" catches any custom/non-predefined activity
            let matchesActivity = true;
            if (activityValue) {
                if (activityValue.toLowerCase() === 'others') {
                    const matchedActivity = predefinedActivities.find(a => a.toLowerCase() === (entry.activity || '').toLowerCase());
                    matchesActivity = entry.activity && !matchedActivity;
                } else {
                    matchesActivity = entry.activity &&
                        entry.activity.toLowerCase() === activityValue.toLowerCase();
                }
            }

            // Date filter
            let matchesDate = true;
            if (dateValue) {
                // Parse date accurately disregarding timezones (YYYY-MM-DD local)
                const entryDateStr = entry.date || entry.timestamp.split('T')[0] || '';
                const nowStr = new Date().toLocaleDateString('en-CA'); // 'en-CA' prints YYYY-MM-DD locally

                switch (dateValue) {
                    case 'today':
                        matchesDate = entryDateStr === nowStr;
                        break;
                    case 'week':
                        const entryD = new Date(entryDateStr);
                        const todayD = new Date(nowStr);
                        const weekAgoD = new Date(todayD.getTime() - 7 * 24 * 60 * 60 * 1000);
                        matchesDate = entryD >= weekAgoD && entryD <= todayD;
                        break;
                    case 'month':
                        const entryDM = new Date(entryDateStr);
                        const todayDM = new Date(nowStr);
                        const monthAgoD = new Date(todayDM.getTime() - 30 * 24 * 60 * 60 * 1000);
                        matchesDate = entryDM >= monthAgoD && entryDM <= todayDM;
                        break;
                }
            }


            // Visitor type filter
            let matchesVisitorType = true;
            if (visitorTypeValue) {
                const sn = (entry.studentNumber || '').toUpperCase();
                const act = (entry.activity || '');
                const isParent = sn === 'PARENT_VISIT' || act.startsWith('[Parent]');
                const isEmployee = sn === 'EMPLOYEE_LOG' || act.startsWith('[Employee]');
                const isVisitor = sn === 'VISITOR_VISIT' || act.startsWith('[Visitor]');
                const isStudent = !isParent && !isEmployee && !isVisitor;

                switch (visitorTypeValue) {
                    case 'parent':   matchesVisitorType = isParent;   break;
                    case 'employee': matchesVisitorType = isEmployee; break;
                    case 'visitor':  matchesVisitorType = isVisitor;  break;
                    case 'student':  matchesVisitorType = isStudent;  break;
                    default:         matchesVisitorType = true;
                }
            }

            return matchesSearch && matchesActivity && matchesDate && matchesVisitorType;
        });

        this.currentPage = 1;
        this.displayEntries();
        this.updateInsights();
    }

    displayEntries() {
        const entriesTableBody = document.getElementById('entriesTableBody');
        const startIndex = (this.currentPage - 1) * this.entriesPerPage;
        const endIndex = startIndex + this.entriesPerPage;
        const pageEntries = this.filteredEntries.slice(startIndex, endIndex);

        if (pageEntries.length === 0) {
            entriesTableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="px-6 py-12 text-center bg-white dark:bg-slate-800">
                        <div class="p-4 rounded-xl bg-blue-50 border border-blue-100 text-blue-600 inline-block mx-auto">
                            <i data-lucide="info" class="w-6 h-6 mx-auto mb-2"></i>
                            <strong class="block">No entries found</strong>
                            <p class="text-sm mt-1">Try adjusting your filters or add new entries.</p>
                        </div>
                    </td>
                </tr>
            `;
            lucide.createIcons();
            return;
        }

        entriesTableBody.innerHTML = pageEntries.map(entry => {
            let displayName = entry.studentName || '---';
            let displaySubname = entry.studentNumber || '---';
            let initial = displayName.charAt(0);

            // Format parent names correctly
            if (entry.studentNumber === 'PARENT_VISIT' || (entry.activity && entry.activity.startsWith('[Parent]'))) {
                const parts = entry.studentName.match(/^(.*?)(?:\s*\(\s*Visiting:\s*(.*?)\s*\))?$/);
                if (parts) {
                    displayName = parts[1].trim();
                    initial = displayName.charAt(0);
                    if (parts[2]) {
                        displaySubname = `Visting: ${parts[2].trim()}`;
                    } else {
                        displaySubname = 'Parent Visit';
                    }
                }
            }

            const duration = this.calculateDuration(entry.timeIn, entry.timeOut);

            return `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition-colors group">
                <td class="px-8 py-5">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-500 font-bold text-xs border border-white shadow-sm flex-shrink-0">
                            ${initial}
                        </div>
                        <div>
                            <p class="font-bold text-slate-900 dark:text-white leading-none mb-1">${displayName}</p>
                            <p class="text-[10px] font-mono text-slate-400 uppercase tracking-wider">${displaySubname}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-5 font-bold text-slate-600 dark:text-slate-400 text-xs text-center">
                    ${(entry.studentNumber === 'PARENT_VISIT' || entry.studentNumber === 'EMPLOYEE_LOG' || entry.studentNumber === 'VISITOR_VISIT' || (entry.activity && (entry.activity.startsWith('[Parent]') || entry.activity.startsWith('[Employee]') || entry.activity.startsWith('[Visitor]')))) 
                        ? '---' 
                        : (entry.yearLevel || entry['Year Level'] || '---')}
                </td>
                <td class="px-6 py-5">
                    <div class="space-y-1">
                        <div class="flex items-center gap-1.5">
                            <span class="px-2 py-0.5 text-[10px] font-black rounded-lg bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 border border-blue-100 dark:border-blue-900/20 uppercase tracking-wider">
                                ${entry.activity}
                            </span>
                        </div>
                        <p class="text-[10px] font-bold text-slate-400 flex items-center gap-1">
                            <i data-lucide="clock" class="w-2.5 h-2.5"></i>
                            ${this.formatDateTime(entry.timestamp)}
                        </p>
                    </div>
                </td>
                <td class="px-6 py-5 text-center">
                    ${duration
                    ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-slate-50 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[10px] font-black border border-slate-100 dark:border-slate-600">
                          <i data-lucide="hourglass" class="w-3 h-3"></i>
                          ${duration}
                       </span>`
                    : '<span class="text-slate-300 dark:text-slate-600">---</span>'
                }
                </td>
                <td class="px-6 py-5 text-center">
                    ${entry.timeOutFormatted
                    ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wider border border-slate-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-slate-400"></div> Checked Out
                           </span>`
                    : (entry.status === 'pending' || entry.status === 'in-service')
                        ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-600 text-[10px] font-black uppercase tracking-wider border border-amber-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div> PENDING
                           </span>`
                        : `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-black uppercase tracking-wider border border-emerald-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Complete
                           </span>`
                }
                </td>
                <td class="px-8 py-5 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <button class="w-10 h-10 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-400 hover:text-blue-600 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-900/5 transition-all group-hover:scale-105" onclick="logsManager.viewEntry('${entry.id}')">
                            <i data-lucide="eye" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `;
        }).join('');
        lucide.createIcons();

        this.updatePagination();
    }

    updatePagination() {
        const pagination = document.getElementById('pagination');
        const totalPages = Math.ceil(this.filteredEntries.length / this.entriesPerPage);

        if (totalPages <= 1) {
            pagination.innerHTML = '';
            return;
        }

        let paginationHTML = '';

        // Previous button
        paginationHTML += `
            <li>
                <button class="px-4 py-2 text-sm font-bold rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
                        ${this.currentPage === 1 ? 'disabled' : ''} onclick="logsManager.goToPage(${this.currentPage - 1})">
                    Previous
                </button>
            </li>
        `;

        // Page numbers
        for (let i = 1; i <= totalPages; i++) {
            if (i === 1 || i === totalPages || (i >= this.currentPage - 1 && i <= this.currentPage + 1)) {
                paginationHTML += `
                    <li>
                    <button class="w-10 h-10 flex items-center justify-center text-sm font-bold rounded-xl border transition-all 
                                 ${i === this.currentPage ? 'bg-blue-600 border-blue-600 text-white shadow-lg shadow-blue-100' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50'}" 
                            onclick="logsManager.goToPage(${i})">${i}</button>
                </li>
            `;
            } else if (i === this.currentPage - 2 || i === this.currentPage + 2) {
                paginationHTML += `
                    <li>
                    <span class="w-10 h-10 flex items-center justify-center text-slate-400 font-bold">...</span>
                </li>
            `;
            }
        }

        // Next button
        paginationHTML += `
            <li>
                <button class="px-4 py-2 text-sm font-bold rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all" 
                        ${this.currentPage === totalPages ? 'disabled' : ''} onclick="logsManager.goToPage(${this.currentPage + 1})">
                    Next
                </button>
            </li>
        `;

        pagination.innerHTML = paginationHTML;
    }

    goToPage(page) {
        const totalPages = Math.ceil(this.filteredEntries.length / this.entriesPerPage);
        if (page >= 1 && page <= totalPages) {
            this.currentPage = page;
            this.displayEntries();
        }
        return false; // Prevent default link behavior
    }

    async updateStats() {
        try {
            // Check if we're on the dashboard page
            const todayCountEl = document.getElementById('todayCount');
            const activeCountEl = document.getElementById('activeCount');
            const pendingCountEl = document.getElementById('pendingCount');
            const monthCountEl = document.getElementById('monthCount');

            if (!todayCountEl && !activeCountEl && !pendingCountEl && !monthCountEl) {
                return;
            }

            const nowStr = new Date().toLocaleDateString('en-CA');
            const todayD = new Date(nowStr);
            const monthAgoD = new Date(todayD.getTime() - 30 * 24 * 60 * 60 * 1000);

            let todayCount = 0;
            let activeCount = 0;
            let pendingCount = 0;
            let monthCount = 0;

            this.entries.forEach(entry => {
                const entryDateStr = entry.date || entry.timestamp.split('T')[0] || '';
                const entryD = new Date(entryDateStr);

                if (entryDateStr === nowStr) {
                    todayCount++;
                }
                if (!entry.timeOutFormatted) {
                    activeCount++;
                    if (entry.status === 'pending' || entry.status === 'in-service') {
                        pendingCount++;
                    }
                }
                if (entryD >= monthAgoD && entryD <= todayD) {
                    monthCount++;
                }
            });

            // Update UI
            if (todayCountEl) todayCountEl.textContent = todayCount;
            if (activeCountEl) activeCountEl.textContent = activeCount;
            if (pendingCountEl) pendingCountEl.textContent = pendingCount;
            if (monthCountEl) monthCountEl.textContent = monthCount;

        } catch (error) {
            console.error('❌ Error updating stats:', error);
        }
    }

    updateInsights() {
        const activityDistributionEl = document.getElementById('activityDistribution');
        const insightTimeFilter = document.getElementById('insightTimeFilter');
        if (!activityDistributionEl) return;

        let predefinedActivities = ['Enrollment Concern', 'Document Request', 'Financial Concern', 'Inquiry'];
        if (this.systemSettings && this.systemSettings.activities) {
            try {
                const parsed = JSON.parse(this.systemSettings.activities);
                if (Array.isArray(parsed) && parsed.length > 0) predefinedActivities = parsed;
            } catch { }
        }

        const activityCounts = {};
        predefinedActivities.forEach(act => activityCounts[act] = 0);
        activityCounts['Others'] = 0;

        // Determine timeframe
        const timeValue = insightTimeFilter ? insightTimeFilter.value : 'all';
        const now = new Date();

        let validEntries = this.entries;

        if (timeValue !== 'all') {
            const nowStr = new Date().toLocaleDateString('en-CA');
            const todayD = new Date(nowStr);

            validEntries = this.entries.filter(entry => {
                const entryDateStr = entry.date || entry.timestamp.split('T')[0] || '';

                if (timeValue === 'today') {
                    return entryDateStr === nowStr;
                } else if (timeValue === 'week') {
                    const entryD = new Date(entryDateStr);
                    const weekAgoD = new Date(todayD.getTime() - 7 * 24 * 60 * 60 * 1000);
                    return entryD >= weekAgoD && entryD <= todayD;
                } else if (timeValue === 'month') {
                    const entryD = new Date(entryDateStr);
                    const monthAgoD = new Date(todayD.getTime() - 30 * 24 * 60 * 60 * 1000);
                    return entryD >= monthAgoD && entryD <= todayD;
                }
                return true;
            });
        }

        // Group entries by activity, bucketing custom ones under "Others"
        validEntries.forEach(entry => {
            const actLower = entry.activity?.toLowerCase() || '';
            const matchedKey = predefinedActivities.find(a => a.toLowerCase() === actLower);

            if (matchedKey) {
                activityCounts[matchedKey] += 1;
            } else {
                activityCounts['Others'] += 1;
            }
        });

        const total = validEntries.length;
        if (total === 0) {
            activityDistributionEl.innerHTML = `<div class="text-center text-xs text-slate-400 py-10 italic">No data to display</div>`;
            return;
        }
        const sortedActivities = Object.entries(activityCounts)
            .filter(([act, count]) => count > 0 || predefinedActivities.includes(act))
            .sort((a, b) => b[1] - a[1]);

        const colors = ['bg-orange-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600', 'bg-indigo-600'];

        activityDistributionEl.innerHTML = sortedActivities.map(([activity, count], index) => {
            const percentage = Math.round((count / total) * 100);
            const color = colors[index % colors.length];
            return `
                <div class="space-y-2">
                    <div class="flex items-center justify-between text-[11px] font-black uppercase tracking-wider">
                        <span class="text-slate-600 dark:text-slate-300">${activity}</span>
                        <span class="text-slate-400 text-right">${percentage}% <span class="text-slate-300 font-medium ml-1">(${count} logs)</span></span>
                    </div>
                    <div class="h-2 w-full bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                        <div class="${color} h-full rounded-full" style="width: ${percentage}%"></div>
                    </div>
            `;
        }).join('');
    }

    async completeEntry(entryId) {
        return this.updateEntryStatus(entryId, 'complete');
    }

    async updateEntryStatus(entryId, newStatus) {
        try {
            console.log(`🔄 Updating entry ${entryId} to status: ${newStatus}`);

            const response = await fetch(`/api/logs/${entryId}/status`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    status: newStatus,
                    staffName: window.authManager?.getCurrentUser?.()?.displayName || ''
                })
            });

            if (!response.ok) throw new Error('Failed to update entry status');

            this.showToast(`Status updated to ${newStatus}.`);

            // Reload logs and update UI
            await this.loadEntries();
            this.updateStats();

            // Refresh modal if open
            if (this.currentEntryId === entryId) {
                this.viewEntry(entryId);
            }

        } catch (error) {
            console.error('❌ Error updating entry status:', error);
            this.showToast('Error updating status. Please try again.', 'error');
        }
    }

    viewEntry(entryId) {
        console.log('🔍 Viewing entry:', entryId);
        const entry = this.entries.find(e => e.id === entryId);
        if (!entry) {
            console.error('❌ Entry not found:', entryId);
            return;
        }

        console.log('✅ Entry found:', entry);

        const entryDetails = document.getElementById('entryDetails');
        if (!entryDetails) {
            console.error('❌ Entry details element not found');
            return;
        }

        const statusBadge = entry.timeOutFormatted
            ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-500 text-[10px] font-black uppercase tracking-wider border border-slate-200">
                 <div class="w-1.5 h-1.5 rounded-full bg-slate-400"></div> Checked Out
               </span>`
            : (entry.status === 'pending' || entry.status === 'in-service')
                ? `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-600 text-[10px] font-black uppercase tracking-wider border border-amber-200 animate-bounce">
                         <div class="w-1.5 h-1.5 rounded-full bg-amber-500"></div> Pending Verification
                       </span>`
                : `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-100 text-emerald-600 text-[10px] font-black uppercase tracking-wider border border-emerald-200">
                         <div class="w-1.5 h-1.5 rounded-full bg-emerald-500"></div> Complete
                       </span>`;

        const duration = this.calculateDuration(entry.timeIn, entry.timeOut);

        entryDetails.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div class="space-y-4">
                    <div class="flex items-center justify-between">
                        <h6 class="text-xs font-black uppercase tracking-widest text-slate-400">Student Information</h6>
                        ${statusBadge}
                    </div>
                    <div class="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl border border-slate-100 dark:border-slate-600">
                        <p class="text-sm text-slate-500 mb-1">Full Name</p>
                        <p class="font-bold text-slate-900 dark:text-white">${entry.studentName}</p>
                    </div>
                    ${!(entry.studentNumber === 'PARENT_VISIT' || entry.studentNumber === 'EMPLOYEE_LOG' || entry.studentNumber === 'VISITOR_VISIT' || (entry.activity && (entry.activity.startsWith('[Parent]') || entry.activity.startsWith('[Employee]') || entry.activity.startsWith('[Visitor]')))) 
                        ? `<div class="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl border border-slate-100 dark:border-slate-600">
                                <p class="text-sm text-slate-500 mb-1">Student ID Number</p>
                                <p class="font-bold text-slate-900 dark:text-white">${entry.studentId || 'N/A'}</p>
                           </div>`
                        : ''
                    }
                    ${!(entry.studentNumber === 'PARENT_VISIT' || entry.studentNumber === 'EMPLOYEE_LOG' || entry.studentNumber === 'VISITOR_VISIT' || (entry.activity && (entry.activity.startsWith('[Parent]') || entry.activity.startsWith('[Employee]') || entry.activity.startsWith('[Visitor]')))) 
                        ? `<div class="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl border border-slate-100 dark:border-slate-600">
                                <p class="text-sm text-slate-500 mb-1">NFC Chip Number</p>
                                <p class="font-mono font-bold text-slate-900 dark:text-white">${entry.studentNumber}</p>
                           </div>`
                        : ''
                    }
                </div>
                <div class="space-y-4">
                    <h6 class="text-xs font-black uppercase tracking-widest text-slate-400">Visit Details</h6>
                    <div class="bg-blue-50 dark:bg-blue-900/30 p-4 rounded-xl border border-blue-100 dark:border-blue-900/20">
                        <p class="text-sm text-blue-600 dark:text-blue-400 mb-1">Activity</p>
                        <div class="flex items-center justify-between">
                            <p class="font-extrabold text-blue-800 dark:text-white">${entry.activity}</p>
                            ${duration ? `<span class="px-2 py-0.5 rounded-lg bg-blue-100 dark:bg-blue-800 text-blue-800 dark:text-blue-100 text-[10px] font-black uppercase tracking-widest border border-blue-200 dark:border-blue-700">Duration: ${duration}</span>` : ''}
                        </div>
                    </div>
                    <div class="bg-slate-50 dark:bg-slate-700 p-4 rounded-xl border border-slate-100 dark:border-slate-600">
                        <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Assigned Staff</p>
                        <p class="font-bold text-slate-900 dark:text-white">${entry.staff || '---'}</p>
                    </div>
                    <div class="grid grid-cols-2 gap-3">
                        <div class="bg-slate-50 dark:bg-slate-700 p-3 rounded-xl border border-slate-100 dark:border-slate-600">
                            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Time In</p>
                            <p class="text-xs font-bold text-emerald-600">${this.formatTime(entry.timeIn)}</p>
                        </div>
                        <div class="bg-slate-50 dark:bg-slate-700 p-3 rounded-xl border border-slate-100 dark:border-slate-600">
                            <p class="text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1">Time Out</p>
                            <p class="text-xs font-bold text-slate-900 dark:text-white">${entry.timeOutFormatted || 'Still Active'}</p>
                        </div>
                    </div>

                    ${entry.proofImage ? `
                        <button class="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-violet-600 text-white shadow-lg shadow-violet-900/20 hover:bg-violet-700 transition-all font-black uppercase tracking-widest text-xs" onclick="logsManager.viewProof('${entry.proofImage}')">
                            <i data-lucide="image" class="w-4 h-4"></i>
                            View Photo
                        </button>
                    ` : ''}

                    ${!entry.timeOutFormatted && entry.status === 'pending'
                ? `<button class="w-full h-12 flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white shadow-lg shadow-emerald-900/20 hover:bg-emerald-700 transition-all font-black uppercase tracking-widest text-xs" onclick="logsManager.completeEntry('${entry.id}')">
                                <i data-lucide="check" class="w-4 h-4"></i>
                                Mark Activity as Done
                            </button>`
                : ''
            }
                </div>
            </div>
        `;
        lucide.createIcons();

        // Store current entry ID for deletion
        this.currentEntryId = entryId;

        // Show modal (Tailwind manual toggle)
        const modal = document.getElementById('entryModal');
        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    viewProof(url) {
        const modal = document.getElementById('proofViewerModal');
        const img = document.getElementById('proofImageElement');
        if (modal && img) {
            img.src = url;
            modal.classList.remove('hidden');
            if (window.lucide) window.lucide.createIcons();
        }
    }

    async deleteCurrentEntry() {
        if (!this.currentEntryId) return;

        if (!confirm('Are you sure you want to delete this entry? This action cannot be undone.')) {
            return;
        }

        try {
            // Delete from backend API
            const response = await fetch(`/api/logs/${this.currentEntryId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ officeId: this.officeId })
            });

            if (!response.ok) throw new Error('Failed to delete entry');

            // Remove from local array
            this.entries = this.entries.filter(e => e.id !== this.currentEntryId);
            this.filteredEntries = this.filteredEntries.filter(e => e.id !== this.currentEntryId);

            // Close modal (Tailwind manual toggle)
            const modal = document.getElementById('entryModal');
            modal.classList.add('hidden');
            modal.classList.remove('flex');

            this.displayEntries();
            this.updateStats();

            console.log('✅ Entry deleted successfully');

        } catch (error) {
            console.error('❌ Error deleting entry:', error);
            this.showToast('Error deleting entry. Please try again.');
        }
    }

    exportToCSV() {
        if (this.filteredEntries.length === 0) {
            this.showToast('No entries to export');
            return;
        }

        // Create CSV content
        const headers = ['Student Name', 'Student Number', 'Activity', 'Visited Staff', 'Time In', 'Time Out', 'Duration', 'Date', 'Logged By'];
        const rows = this.filteredEntries.map(entry => [
            entry.studentName,
            entry.studentNumber,
            entry.activity,
            entry.staff || 'N/A',
            this.formatTime(entry.timeIn),
            entry.timeOutFormatted || 'Still Active',
            this.calculateDuration(entry.timeIn, entry.timeOut) || '---',
            entry.date || 'N/A',
            entry.staffEmail
        ]);

        const csvContent = [headers, ...rows]
            .map(row => row.map(field => `"${field}"`).join(','))
            .join('\n');

        // Create download link
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `logbook_entries_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    printReport() {
        const printContent = `
            <html>
                <head>
                    <title>Logbook Report</title>
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20px; }
                        h1 { text-align: center; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .stats { display: flex; justify-content: space-around; margin-bottom: 30px; }
                        .stat-box { text-align: center; padding: 10px; border: 1px solid #ddd; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>📔 Logbook System Report</h1>
                        <p>Generated on: ${new Date().toLocaleString()}</p>
                    </div>
                    
                    <div class="stats">
                        <div class="stat-box">
                            <h3>${document.getElementById('todayCount').textContent}</h3>
                            <p>Daily Traffic</p>
                        </div>
                        <div class="stat-box">
                            <h3>${document.getElementById('activeCount').textContent}</h3>
                            <p>Active Now</p>
                        </div>
                        <div class="stat-box">
                            <h3>${document.getElementById('weekCount').textContent}</h3>
                            <p>This Week</p>
                        </div>
                    </div>
                    
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 15%">Timestamp</th>
                                <th style="width: 15%">Student Name</th>
                                <th style="width: 15%">Activity</th>
                                <th style="width: 15%">Staff</th>
                                <th style="width: 10%">Time In</th>
                                <th style="width: 10%">Time Out</th>
                                <th style="width: 10%">Date</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${this.filteredEntries.map(entry => `
                                <tr>
                                    <td>${this.formatDateTime(entry.timestamp)}</td>
                                    <td>${entry.studentName}</td>
                                    <td>${entry.activity}</td>
                                    <td>${entry.staff || 'N/A'}</td>
                                    <td>${this.formatTime(entry.timeIn)}</td>
                                    <td>${entry.timeOutFormatted || 'Still Active'}</td>
                                    <td>${entry.date || 'N/A'}</td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </body>
            </html>
        `;

        const printWindow = window.open('', '_blank');
        printWindow.document.write(printContent);
        printWindow.document.close();
        printWindow.print();
    }

    formatDateTime(timestamp) {
        const date = new Date(timestamp);
        return date.toLocaleString('en-PH', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
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

    formatTime(timeValue) {
        if (!timeValue) return 'N/A';

        // Firestore Admin SDK REST response: { _seconds, _nanoseconds }
        if (typeof timeValue === 'object' && timeValue._seconds !== undefined) {
            return new Date(timeValue._seconds * 1000).toLocaleTimeString('en-PH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }

        // Firestore client SDK Timestamp object
        if (timeValue.toDate) {
            return timeValue.toDate().toLocaleTimeString('en-PH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }

        // ISO string or other date string
        if (typeof timeValue === 'string') {
            const d = new Date(timeValue);
            if (!isNaN(d)) {
                return d.toLocaleTimeString('en-PH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
        }

        return 'N/A';
    }

    async generatePDFReport() {
        const reportTimeFilter = document.getElementById('reportTimeFilter');
        const timeValue = reportTimeFilter ? reportTimeFilter.value : 'all';
        const now = new Date();

        let reportEntries = this.entries;
        let timeframeText = 'Complete History';
        let reportTitle = 'Complete Logbook Report';

        if (timeValue !== 'all') {
            reportEntries = this.entries.filter(entry => {
                const entryDate = new Date(entry.timestamp);
                if (timeValue === 'today') {
                    return entryDate.toDateString() === now.toDateString();
                } else if (timeValue === 'week') {
                    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                    return entryDate >= weekAgo;
                } else if (timeValue === 'month') {
                    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                    return entryDate >= monthAgo;
                }
                return true;
            });

            if (timeValue === 'today') {
                timeframeText = 'Daily Report (Today)';
                reportTitle = 'Daily Logbook Report';
            } else if (timeValue === 'week') {
                timeframeText = 'Weekly Report (Last 7 Days)';
                reportTitle = 'Weekly Logbook Report';
            } else if (timeValue === 'month') {
                timeframeText = 'Monthly Report (Last 30 Days)';
                reportTitle = 'Monthly Logbook Report';
            }
        }

        if (reportEntries.length === 0) {
            this.showToast('No logged data available for ' + timeframeText, 'error');
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const timestamp = new Date().toLocaleDateString('en-PH', {
            year: 'numeric', month: 'long', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Background / Branding
        doc.setFillColor(15, 23, 42); // slate-900
        doc.rect(0, 0, 210, 40, 'F');

        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont('helvetica', 'bold');
        doc.text(reportTitle, 15, 25);

        doc.setFontSize(10);
        doc.setTextColor(148, 163, 184); // slate-400
        const officeName = (this.systemSettings && this.systemSettings.officeName) || 'Engineering Office';
        const schoolName = (this.systemSettings && this.systemSettings.schoolName) ? `${this.systemSettings.schoolName} • ` : '';
        doc.text(`${schoolName}${officeName} • Generated on ${timestamp}`, 15, 33);

        // Stats Box
        doc.setDrawColor(226, 232, 240); // slate-200
        doc.setLineWidth(0.5);
        doc.line(15, 50, 195, 50);

        doc.setTextColor(30, 41, 59); // slate-800
        doc.setFontSize(12);
        doc.text(`${timeframeText} Insights`, 15, 60);

        const activeNow = reportEntries.filter(e => !e.timeOutFormatted).length;
        const stats = [
            `Total Entries: ${reportEntries.length} logs`,
            `Currently Active: ${activeNow} visitors`
        ];

        doc.setFontSize(10);
        doc.setTextColor(71, 85, 105); // slate-600
        stats.forEach((stat, i) => {
            doc.text(stat, 15 + (i * 70), 70);
        });

        // Table
        const headers = [['Date', 'Visitor Name', 'Activity', 'Staff', 'NFC Chip', 'In/Out']];
        const data = reportEntries.map(entry => {
            let displayName = entry.studentName;
            const duration = this.calculateDuration(entry.timeIn, entry.timeOut);
            if (entry.studentNumber === 'PARENT_VISIT' || (entry.activity && entry.activity.startsWith('[Parent]'))) {
                const m = (entry.studentName || '').match(/^(.*?)(?:\s*\(\s*Visiting:\s*(.*?)\s*\))?$/);
                if (m) {
                    const parentName = m[1].trim();
                    displayName = m[2] ? `${parentName} : ${m[2].trim()}` : parentName;
                }
            }

            return [
                entry.date || 'N/A',
                displayName,
                (entry.activity || '—').replace('[Parent] ', '').replace('[Visitor] ', ''),
                entry.staff || 'N/A',
                (entry.studentNumber === 'PARENT_VISIT' || entry.studentNumber === 'VISITOR_VISIT')
                    ? (entry.studentId || (entry.studentNumber === 'PARENT_VISIT' ? 'Parent' : 'Visitor'))
                    : (entry.studentNumber || '—'),
                `${this.formatTime(entry.timeIn)} - ${entry.timeOutFormatted || 'Active'} ${duration ? `(${duration})` : ''}`
            ];
        });

        doc.autoTable({
            startY: 80,
            head: headers,
            body: data,
            theme: 'striped',
            headStyles: {
                fillColor: [37, 99, 235], // blue-600
                textColor: 255,
                fontSize: 10,
                fontStyle: 'bold'
            },
            bodyStyles: {
                fontSize: 9,
                textColor: [51, 65, 85] // slate-700
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252] // slate-50
            },
            margin: { top: 80, left: 15, right: 15 }
        });

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(148, 163, 184);
            doc.text(`Page ${i} of ${pageCount}`, 195, 285, { align: 'right' });
            doc.text('© 2026 Logbook Management System • Confidential Engineering Records', 15, 285);
        }

        doc.save(`Logbook_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    }
}

// Initialize logs manager
window.logsManager = new LogsManager();
