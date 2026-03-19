/**
 * faculty.js
 * Manages the Faculty Hub page.
 * Reads ?staff=Name from the URL, fetches pending logs, and lets faculty
 * mark individual student sessions as completed.
 */

const params = new URLSearchParams(window.location.search);
const staffName = params.get('staff');
let officeId = 'engineering-office'; // default, overridden by settings

// Helper to normalize names (lowercase, single space only, trimmed)
const normalize = (s) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

import { loadSystemSettings } from './settings.js';

let autoRefreshTimer = null;
let activeClockInLogId = null;

// ----------------------------------------------------------------
// Toast
// ----------------------------------------------------------------
function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const template = document.getElementById('toastTemplate');
    if (!container || !template) return;
    const toast = template.content.cloneNode(true).firstElementChild;
    toast.querySelector('.toast-message').textContent = message;
    const icon = toast.querySelector('.toast-icon');
    if (type === 'error') {
        icon.setAttribute('data-lucide', 'alert-circle');
        icon.classList.replace('text-emerald-400', 'text-red-400');
    }
    container.appendChild(toast);
    lucide.createIcons();
    setTimeout(() => { toast.classList.add('fade-out'); setTimeout(() => toast.remove(), 400); }, 4000);
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------
function escape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(ms) {
    if (ms < 0) ms = 0;
    const totalMin = Math.round(ms / 60000);
    if (totalMin < 1) return '< 1m';
    if (totalMin < 60) return `${totalMin}m`;
    const hrs = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    return `${hrs}h ${mins}m`;
}

function viewProof(url) {
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

// Make globally available for onclick
window.viewProof = viewProof;

// ----------------------------------------------------------------
// Employee Clock-out (Faculty Mode)
// ----------------------------------------------------------------
async function checkClockInStatus() {
    if (!staffName) return;
    try {
        const res = await fetch(`/api/logs?officeId=${officeId}`);
        const logs = await res.json();
        
        // Find if this staff member has an active EMPLOYEE_LOG session
        const activeLog = logs.find(log => 
            log.studentNumber === 'EMPLOYEE_LOG' && 
            normalize(log.studentName) === normalize(staffName) && 
            !log.timeOut
        );

        const btn = document.getElementById('clockOutBtn');
        if (activeLog) {
            activeClockInLogId = activeLog.id;
            btn?.classList.remove('hidden');
        } else {
            activeClockInLogId = null;
            btn?.classList.add('hidden');
        }
    } catch (e) {
        console.error('⚠️ Error checking clock-in status:', e);
    }
}

async function handleClockOut() {
    if (!staffName) return;

    const btn = document.getElementById('clockOutBtn');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i data-lucide="loader" class="w-4 h-4 animate-spin"></i> Processing…`;
        if (window.lucide) window.lucide.createIcons();
    }

    try {
        // Fetch current logs to find all active ones for this staff
        const res = await fetch(`/api/logs?officeId=${officeId}`);
        if (!res.ok) throw new Error('Failed to fetch logs');
        const logs = await res.json();
        
        const activeLogs = logs.filter(log => 
            log.studentNumber === 'EMPLOYEE_LOG' && 
            normalize(log.studentName) === normalize(staffName) && 
            !log.timeOut
        );

        if (activeLogs.length === 0) {
            showToast('No active clock-in found.');
            if (btn) btn.classList.add('hidden');
            return;
        }

        // Process all active logs
        let successCount = 0;
        for (const log of activeLogs) {
            const patchRes = await fetch(`/api/logs/${log.id}/complete`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ staffName: staffName })
            });
            if (patchRes.ok) successCount++;
        }

        if (successCount > 0) {
            showToast(`You have clocked out successfully (${successCount} session${successCount > 1 ? 's' : ''}).`);
            activeClockInLogId = null;
            if (btn) btn.classList.add('hidden');
            // Refresh hub data
            renderQueue();
            renderSummary();
            // Refresh status check
            await checkClockInStatus();
        } else {
            throw new Error('Clock-out failed');
        }
    } catch (error) {
        console.error('❌ Clock-out error:', error);
        showToast('Error during clock-out. Please try again.', 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<i data-lucide="clock" class="w-4 h-4"></i> Clock Out`;
            if (window.lucide) window.lucide.createIcons();
        }
    }
}

// ----------------------------------------------------------------
// Individual Staff Sign Out (Administrative)
// ----------------------------------------------------------------
async function logOutStaff(logId) {
    if (!confirm('Sign out this faculty member?')) return;
    
    try {
        const res = await fetch(`/api/logs/${logId}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staffName: staffName || 'Dr. Mariciel Teogangco' })
        });
        
        if (res.ok) {
            showToast('Staff member signed out successfully.');
            if (typeof renderQueue === 'function') renderQueue();
            if (typeof renderSummary === 'function') renderSummary();
        } else {
            throw new Error('Sign out failed');
        }
    } catch (e) {
        console.error('Staff sign out error:', e);
        showToast('Failed to sign out staff.', 'error');
    }
}
window.logOutStaff = logOutStaff; // Expose globally for inline onclick

// ----------------------------------------------------------------
// Faculty Selection Grid (for No Staff state)
// ----------------------------------------------------------------
async function renderFacultySelection() {
    const grid = document.getElementById('facultySelectionGrid');
    if (!grid) return;

    grid.innerHTML = `
        <div class="col-span-full flex justify-center py-10">
            <div class="animate-spin rounded-full h-8 w-8 border-4 border-blue-500 border-t-transparent"></div>
        </div>
    `;

    try {
        const res = await fetch('/api/faculty');
        const faculties = await res.json();

        if (faculties.length === 0) {
            grid.innerHTML = '<p class="text-slate-400 font-bold col-span-full py-10 text-center">No faculty members found. Please check system settings.</p>';
        } else {
            grid.innerHTML = faculties.map(f => `
                <a href="faculty.html?staff=${encodeURIComponent(f.name)}"
                   class="group bg-white dark:bg-slate-800 p-8 rounded-[2.5rem] border border-slate-200 dark:border-slate-700 shadow-xl shadow-slate-200/50 hover:border-blue-500 hover:-translate-y-1 transition-all flex flex-col items-center gap-5 text-center w-full max-w-sm">
                    <div class="w-16 h-16 rounded-full overflow-hidden border-2 border-slate-100 flex-shrink-0">
                        ${f.photoURL ? `<img src="${f.photoURL}" class="w-full h-full object-cover">` : `<div class="w-full h-full bg-blue-50 flex items-center justify-center text-blue-500 font-black text-xl">${(f.name || 'S').charAt(0).toUpperCase()}</div>`}
                    </div>
                    <div>
                        <p class="text-lg font-black text-slate-900 dark:text-white leading-tight">${escape(f.name)}</p>
                        <p class="text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">${escape(f.position || 'Faculty')}</p>
                    </div>
                    <div class="mt-2 px-6 py-2 rounded-full bg-slate-50 dark:bg-slate-700 text-[10px] font-black uppercase tracking-widest text-slate-400 group-hover:bg-blue-600 group-hover:text-white transition-all">
                        Enter Hub
                    </div>
                </a>
            `).join('');
        }
    } catch (e) {
        console.error('Faculty selection fetch error:', e);
        grid.innerHTML = '<p class="text-red-500 font-bold col-span-full py-10 text-center">Failed to load faculty list.</p>';
    }
    lucide.createIcons();
}

// ----------------------------------------------------------------
// Fetch students from /api/logs filtered by staff
// ----------------------------------------------------------------
async function fetchQueue() {
    try {
        const res = await fetch(`/api/logs?officeId=${officeId}`);
        const allLogs = await res.json();

        const today = new Date().toLocaleDateString('en-CA');

        // --- GENERAL EMPLOYEE MONITORING ---
        // Grab all active employee logs across the entire system, ignoring the current staffName
        const staffPresence = allLogs.filter(l => 
            l.studentNumber === 'EMPLOYEE_LOG' && 
            l.timeOut === null && 
            l.status !== 'completed'
        );

        // --- STUDENT QUEUE FOR CURRENT FACULTY ---
        // Filter student logs assigned specifically to this faculty
        const pending = allLogs.filter(l =>
            l.studentNumber !== 'EMPLOYEE_LOG' &&
            normalize(l.staff) === normalize(staffName) &&
            l.timeOut === null &&
            l.status !== 'completed'
        );

        const completed = allLogs.filter(l =>
            l.studentNumber !== 'EMPLOYEE_LOG' &&
            normalize(l.staff) === normalize(staffName) &&
            l.status === 'completed' &&
            (l.date === today || (l.timeIn && l.timeIn.startsWith(today)))
        );

        return { pending, completed, staffPresence, all: [...pending, ...completed] };
    } catch (e) {
        console.error('⚠️ Error fetching queue:', e);
        return { pending: [], completed: [], staffPresence: [], all: [] };
    }
}

// ----------------------------------------------------------------
// Render table
// ----------------------------------------------------------------
async function renderQueue() {
    const tbody = document.getElementById('queueTableBody');
    if (!tbody) return;

    const { pending, completed, staffPresence, all } = await fetchQueue();
    const now = new Date();

    // Update stats
    document.getElementById('statPending').textContent = pending.length;
    document.getElementById('statCompleted').textContent = completed.length;
    document.getElementById('statTotal').textContent = all.length;

    const lastRefreshedEl = document.getElementById('lastRefreshed');
    if (lastRefreshedEl) {
        lastRefreshedEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
    }

    // ── Staff Presence Monitor ──
    // Render Staff Presence (Employee Monitoring)
    // Now visible to all faculty as general monitoring
    const staffPresenceSection = document.getElementById('staffPresenceSection');
    const staffPresenceBody = document.getElementById('staffPresenceTableBody');
    
    if (staffPresenceSection && staffPresenceBody) {
        staffPresenceSection.classList.remove('hidden');
        
        if (staffPresence.length > 0) {
            staffPresenceBody.innerHTML = staffPresence.map(log => {
                const checkIn = new Date(log.timeIn);
                const onSiteMs = now - checkIn;
                return `
                    <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors">
                        <td class="px-8 py-5">
                            <div class="flex items-center gap-3">
                                <div class="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-black flex-shrink-0">
                                    ${escape((log.studentName || 'S')[0]).toUpperCase()}
                                </div>
                                <p class="font-bold text-slate-800 dark:text-white text-sm leading-none">${escape(log.studentName || '—')}</p>
                            </div>
                        </td>
                        <td class="px-6 py-5 underline decoration-slate-200 underline-offset-4 decoration-dotted">
                            <p class="text-xs font-bold text-slate-500 dark:text-slate-400">${escape(log.studentId || 'Faculty')}</p>
                        </td>
                        <td class="px-6 py-5 text-sm font-semibold text-slate-700 dark:text-slate-200">
                            ${escape(log.activity || '—')}
                        </td>
                        <td class="px-6 py-5 text-center text-sm font-black text-blue-500">
                            ${formatDuration(onSiteMs)}
                        </td>
                        <td class="px-6 py-5 text-center">
                             <span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider border border-blue-200">
                                <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div> On-Site
                             </span>
                        </td>
                        <td class="px-8 py-5 text-right">
                            <button onclick="logOutStaff('${escape(log.id)}')" 
                                class="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100 dark:bg-red-900/20 dark:border-red-800/50 dark:text-red-400 font-bold text-xs">
                                <i data-lucide="log-out" class="w-3.5 h-3.5"></i>
                                <span>Sign Out</span>
                            </button>
                        </td>
                    </tr>
                `;
            }).join('');
            } else {
                staffPresenceBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="px-8 py-16 text-center">
                            <div class="flex flex-col items-center justify-center">
                                <div class="bg-blue-50 dark:bg-blue-900/30 w-12 h-12 rounded-2xl flex items-center justify-center mb-3">
                                    <i data-lucide="shield-check" class="w-6 h-6 text-blue-400"></i>
                                </div>
                                <p class="text-slate-400 text-xs font-black uppercase tracking-widest">No faculty members checked in</p>
                            </div>
                        </td>
                    </tr>
                `;
            }
            if (window.lucide) window.lucide.createIcons();
    }

    // ── Student Queue ──
    const queueCard = document.getElementById('queueCard');
    if (queueCard) {
        if (staffName === 'Employee Hub') {
            queueCard.classList.add('hidden');
        } else {
            queueCard.classList.remove('hidden');
        }
    }

    if (all.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="5" class="px-8 py-20 text-center">
                    <div class="flex flex-col items-center justify-center">
                        <div class="w-16 h-16 bg-slate-100 dark:bg-slate-700 rounded-2xl flex items-center justify-center mb-4">
                            <i data-lucide="inbox" class="w-8 h-8 text-slate-400"></i>
                        </div>
                        <p class="text-slate-500 dark:text-slate-400 font-bold">No students in queue today</p>
                        <p class="text-slate-400 text-xs mt-1">Students assigned to you will appear here when they check in.</p>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
        return;
    }

    // Sort: pending first, then completed
    const sorted = [...pending, ...completed];

    tbody.innerHTML = sorted.map(log => {
        const isPending = !log.timeOut && log.status !== 'completed' && log.status !== 'in-service';
        const isInService = !log.timeOut && log.status === 'in-service';
        const isCompleted = log.status === 'completed';

        let statusBadge = '';
        if (isPending) {
            statusBadge = `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 px-3 py-1.5 rounded-full">
                   <span class="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse"></span>Waiting
               </span>`;
        } else if (isInService) {
            statusBadge = `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-3 py-1.5 rounded-full">
                   <i data-lucide="loader" class="w-3 h-3 animate-spin text-blue-500"></i>In Service
               </span>`;
        } else {
            statusBadge = `<span class="inline-flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-full">
                   <i data-lucide="check" class="w-3 h-3"></i>Done
               </span>`;
        }

        // Duration Calculation
        let durationHtml = '';
        const checkIn = new Date(log.timeIn);

        if (isCompleted) {
            const waitMs = (log.serviceStartTime ? new Date(log.serviceStartTime) : new Date(log.timeOut)) - checkIn;
            const serviceMs = log.serviceStartTime ? (new Date(log.timeOut) - new Date(log.serviceStartTime)) : 0;
            durationHtml = `
                <div class="text-[10px] space-y-0.5">
                    <p class="text-amber-500 font-bold whitespace-nowrap">Wait: ${formatDuration(waitMs)}</p>
                    <p class="text-blue-500 font-bold whitespace-nowrap">Svc: ${formatDuration(serviceMs)}</p>
                </div>
            `;
        } else if (isInService) {
            const waitMs = new Date(log.serviceStartTime) - checkIn;
            const serviceMs = now - new Date(log.serviceStartTime);
            durationHtml = `
                <div class="text-[10px] space-y-0.5">
                    <p class="text-emerald-500 font-bold whitespace-nowrap">Wait: ${formatDuration(waitMs)}</p>
                    <p class="text-blue-500 font-black whitespace-nowrap animate-pulse">Svc: ${formatDuration(serviceMs)}...</p>
                </div>
            `;
        } else {
            const waitMs = now - checkIn;
            durationHtml = `
                <div class="text-[10px]">
                    <p class="text-amber-600 font-black whitespace-nowrap animate-pulse">Wait: ${formatDuration(waitMs)}...</p>
                </div>
            `;
        }

        let actionBtn = '';
        if (log.studentNumber === 'EMPLOYEE_LOG') {
            actionBtn = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-50 text-blue-600 text-[10px] font-black uppercase tracking-wider border border-blue-200">
                             <div class="w-1.5 h-1.5 rounded-full bg-blue-500"></div> On-Site
                           </span>`;
        } else if (isPending) {
            actionBtn = `<button onclick="startService('${escape(log.id)}')"
                   class="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-2 ml-auto shadow-sm shadow-blue-500/20">
                   <i data-lucide="play" class="w-3.5 h-3.5"></i> Start Service
               </button>`;
        } else if (isInService) {
            actionBtn = `<button onclick="markComplete('${escape(log.id)}')"
                   class="complete-btn bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs px-4 py-2 rounded-xl transition-all flex items-center gap-2 ml-auto shadow-sm shadow-emerald-500/20">
                   <i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Mark Done
               </button>`;
        } else {
            actionBtn = `<span class="text-[11px] text-slate-400 italic block text-right">Completed</span>`;
        }

        // Proof Action Button
        let proofBtn = '';
        const isDocRelated = (log.activity || '').toLowerCase().includes('doc');
        
        if ((isInService || isCompleted) && isDocRelated) {
            if (log.proofImage) {
                proofBtn = `<button onclick="viewProof('${log.proofImage}')" 
                        class="px-3 py-1.5 rounded-xl bg-violet-50 dark:bg-violet-900/30 text-violet-600 dark:text-violet-400 hover:bg-violet-100 dark:hover:bg-violet-900/50 transition-all shadow-sm flex items-center gap-2 text-[10px] font-black uppercase tracking-wider" title="View Document">
                        <i data-lucide="file-check" class="w-3.5 h-3.5"></i>
                        <span>View Proof</span>
                    </button>`;
            } else {
                proofBtn = `<button onclick="handleProofUpload('${escape(log.id)}')" 
                        class="p-2 rounded-xl bg-slate-50 dark:bg-slate-700 text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-all" title="Upload Proof">
                        <i data-lucide="upload" class="w-4 h-4"></i>
                    </button>`;
            }
        }

        return `
            <tr class="hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors ${isCompleted ? 'opacity-60' : ''}">
                <td class="px-8 py-4">
                    <div class="flex items-center gap-3">
                        <div class="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-black flex-shrink-0">
                            ${escape((log.studentName || 'S')[0]).toUpperCase()}
                        </div>
                        <div>
                            <p class="font-bold text-slate-800 dark:text-white text-sm leading-none">${escape(log.studentName || '—')}</p>
                            <p class="text-[10px] text-slate-400 font-mono mt-0.5">${escape(log.studentId || log.studentNumber || '')}</p>
                        </div>
                    </div>
                </td>
                <td class="px-6 py-4">
                    <p class="text-sm font-semibold text-slate-700 dark:text-slate-200">${escape(log.activity || '—')}</p>
                </td>
                <td class="px-6 py-4">
                    <p class="text-sm font-semibold text-slate-500 dark:text-slate-300">${formatTime(log.timeIn)}</p>
                </td>
                <td class="px-6 py-4">
                    ${durationHtml}
                </td>
                <td class="px-6 py-4 text-center">
                    ${statusBadge}
                </td>
                <td class="px-8 py-4">
                    <div class="flex items-center justify-end gap-2">
                        ${proofBtn}
                        ${actionBtn}
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    lucide.createIcons();
}

// ----------------------------------------------------------------
// Render the summary report card
// ----------------------------------------------------------------
async function renderSummary() {
    const summaryCard = document.getElementById('summaryCard');
    if (!summaryCard) return;

    if (staffName === 'Employee Hub') {
        summaryCard.classList.add('hidden');
        return; // Don't render summary for the Employee Hub
    }

    const { all, completed } = await fetchQueue();

    // Show the card
    summaryCard.classList.remove('hidden');

    // Set date
    const dateEl = document.getElementById('summaryDate');
    if (dateEl) dateEl.textContent = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    // ── Activity Breakdown ──
    const activityCounts = {};
    all.forEach(l => {
        const act = l.activity || 'Unknown';
        activityCounts[act] = (activityCounts[act] || 0) + 1;
    });
    const sortedActivities = Object.entries(activityCounts).sort((a, b) => b[1] - a[1]);
    const maxCount = sortedActivities[0]?.[1] || 1;
    const actColors = ['bg-violet-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'];

    const actListEl = document.getElementById('summaryActivityList');
    if (actListEl) {
        if (sortedActivities.length === 0) {
            actListEl.innerHTML = `<p class="text-xs text-slate-400 italic">No visits yet today.</p>`;
        } else {
            actListEl.innerHTML = sortedActivities.map(([act, count], i) => {
                const pct = Math.round((count / maxCount) * 100);
                const color = actColors[i % actColors.length];
                return `
                    <div class="space-y-1">
                        <div class="flex justify-between text-[11px] font-black uppercase tracking-wider">
                            <span class="text-slate-600 dark:text-slate-300 truncate max-w-[70%]">${escape(act)}</span>
                            <span class="text-slate-400">${count} visit${count !== 1 ? 's' : ''}</span>
                        </div>
                        <div class="h-2 w-full bg-slate-100 dark:bg-slate-600 rounded-full overflow-hidden">
                            <div class="${color} h-full rounded-full transition-all duration-500" style="width:${pct}%"></div>
                        </div>
                    </div>
                `;
            }).join('');
        }
    }

    // ── Completion Rate ──
    const completionEl = document.getElementById('summaryCompletionRate');
    if (completionEl) {
        if (all.length === 0) {
            completionEl.textContent = '—';
        } else {
            const rate = Math.round((completed.length / all.length) * 100);
            completionEl.textContent = `${rate}%`;
        }
    }

    // ── Avg Visit Duration ──
    const avgDurEl = document.getElementById('summaryAvgDuration');
    if (avgDurEl) {
        const completedWithTimes = completed.filter(l => l.timeIn && l.timeOut);

        if (completedWithTimes.length === 0) {
            avgDurEl.innerHTML = '—';
        } else {
            // Wait Time: timeIn -> serviceStartTime (fallback to timeOut if no serviceStart)
            const sumWaitMs = completedWithTimes.reduce((sum, l) => {
                const endWait = l.serviceStartTime ? new Date(l.serviceStartTime) : new Date(l.timeOut);
                return sum + Math.max(0, endWait - new Date(l.timeIn));
            }, 0);

            // Service Time: serviceStartTime -> timeOut (or 0 if no serviceStart)
            const sumServiceMs = completedWithTimes.reduce((sum, l) => {
                if (!l.serviceStartTime) return sum;
                return sum + Math.max(0, new Date(l.timeOut) - new Date(l.serviceStartTime));
            }, 0);

            const avgWaitMs = sumWaitMs / completedWithTimes.length;
            const avgServiceMs = sumServiceMs / completedWithTimes.length;

            const formatDur = (ms) => {
                const min = Math.round(ms / 60000);
                return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
            };

            // Using smaller text to fit both
            avgDurEl.innerHTML = `
                <div class="flex flex-col text-sm font-bold leading-tight">
                    <span class="text-amber-500">Wait: ${formatDur(avgWaitMs)}</span>
                    <span class="text-blue-500">Service: ${formatDur(avgServiceMs)}</span>
                </div>
            `;
            // Remove huge text class from the parent
            avgDurEl.classList.remove('text-3xl');
        }
    }

    // ── Busiest Hour ──
    const busiestEl = document.getElementById('summaryBusiestHour');
    if (busiestEl) {
        if (all.length === 0) {
            busiestEl.textContent = '—';
        } else {
            const hourCounts = {};
            all.forEach(l => {
                if (!l.timeIn) return;
                const hr = new Date(l.timeIn).getHours();
                hourCounts[hr] = (hourCounts[hr] || 0) + 1;
            });
            const busiestHr = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
            if (busiestHr !== undefined) {
                const hr = parseInt(busiestHr);
                const label = new Date(0, 0, 0, hr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                busiestEl.textContent = label;
            } else {
                busiestEl.textContent = '—';
            }
        }
    }

    lucide.createIcons();
}

// ----------------------------------------------------------------
// Start Service
// ----------------------------------------------------------------
window.startService = async function (logId) {
    const btn = document.querySelector(`button[onclick="startService('${logId}')"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> Starting…`; lucide.createIcons(); }

    try {
        const res = await fetch(`/api/logs/${logId}/service-start`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staffName })
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Service started!');
        await renderQueue();
    } catch (e) {
        showToast('Failed to start service', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="play" class="w-3.5 h-3.5"></i> Start Service`; lucide.createIcons(); }
    }
};

// ----------------------------------------------------------------
// Mark a log as completed
// ----------------------------------------------------------------
window.markComplete = async function (logId) {
    const btn = document.querySelector(`button[onclick="markComplete('${logId}')"]`);
    if (btn) { btn.disabled = true; btn.innerHTML = `<i data-lucide="loader" class="w-3.5 h-3.5 animate-spin"></i> Saving…`; lucide.createIcons(); }

    try {
        const res = await fetch(`/api/logs/${logId}/complete`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ staffName })
        });
        if (!res.ok) throw new Error('Failed');
        showToast('Session marked as completed!');
        await renderQueue();
    } catch (e) {
        showToast('Failed to update log', 'error');
        if (btn) { btn.disabled = false; btn.innerHTML = `<i data-lucide="check-circle" class="w-3.5 h-3.5"></i> Mark Done`; lucide.createIcons(); }
    }
};

// ----------------------------------------------------------------
// Proof Upload Handling
// ----------------------------------------------------------------
let currentUploadLogId = null;

window.handleProofUpload = function(logId) {
    currentUploadLogId = logId;
    const input = document.getElementById('proofUploadInput');
    if (input) {
        input.value = ''; // Reset
        input.click();
    }
};

// Global listener for the file input (added in init)
async function handleFileSelected(event) {
    const file = event.target.files[0];
    if (!file || !currentUploadLogId) return;

    if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
        showToast('Please select an image or PDF file', 'error');
        return;
    }

    // Optimization: we could show a loading state on the button here
    // but for simplicity we'll just show the toast
    showToast('Uploading proof...', 'success');

    const formData = new FormData();
    formData.append('proof', file);

    try {
        const res = await fetch(`/api/logs/${currentUploadLogId}/upload-proof`, {
            method: 'POST',
            body: formData
        });
        
        if (!res.ok) throw new Error('Upload failed');
        
        const data = await res.json();
        showToast('Proof uploaded successfully!');
        renderQueue(); // Refresh to show the image button
    } catch (e) {
        console.error('Upload error:', e);
        showToast('Failed to upload proof', 'error');
    } finally {
        currentUploadLogId = null;
    }
}

// ----------------------------------------------------------------
// Generate PDF Summary Report
// ----------------------------------------------------------------
async function generatePDF() {
    const { all, pending, completed } = await fetchQueue();
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });

    const today = new Date();
    const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
    const timeStr = today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const pageW = doc.internal.pageSize.getWidth();

    // ── Compact Header ──
    doc.setFillColor(109, 40, 217);
    doc.rect(0, 0, pageW, 22, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.text('Faculty Hub — Daily Report', 14, 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(`${staffName}  |  ${dateStr} at ${timeStr}`, 14, 17);

    // ── Compute metrics ──
    const completionRate = all.length > 0 ? Math.round((completed.length / all.length) * 100) : 0;

    // Calculate Wait & Service times for PDF
    const completedWithTimes = completed.filter(l => l.timeIn && l.timeOut);
    let avgWaitStr = '—';
    let avgServiceStr = '—';

    if (completedWithTimes.length > 0) {
        const sumWaitMs = completedWithTimes.reduce((sum, l) => {
            const endWait = l.serviceStartTime ? new Date(l.serviceStartTime) : new Date(l.timeOut);
            return sum + Math.max(0, endWait - new Date(l.timeIn));
        }, 0);

        const sumServiceMs = completedWithTimes.reduce((sum, l) => {
            if (!l.serviceStartTime) return sum;
            return sum + Math.max(0, new Date(l.timeOut) - new Date(l.serviceStartTime));
        }, 0);

        const formatDur = (ms) => {
            const min = Math.round(ms / 60000);
            return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h ${min % 60}m`;
        };

        avgWaitStr = formatDur(sumWaitMs / completedWithTimes.length);
        avgServiceStr = formatDur(sumServiceMs / completedWithTimes.length);
    }

    const hourCounts = {};
    all.forEach(l => { if (l.timeIn) { const hr = new Date(l.timeIn).getHours(); hourCounts[hr] = (hourCounts[hr] || 0) + 1; } });
    const busiestHr = Object.entries(hourCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
    const busiestStr = busiestHr !== undefined
        ? new Date(0, 0, 0, parseInt(busiestHr)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : '—';

    // ── Single compact metrics row (6 columns) ──
    const statsY = 27;
    const metrics = [
        { label: 'Total', value: String(all.length), color: [59, 130, 246] },
        { label: 'Completed', value: String(completed.length), color: [16, 185, 129] },
        { label: 'Completion Rate', value: `${completionRate}%`, color: [109, 40, 217] },
        { label: 'Avg Wait', value: avgWaitStr, color: [245, 158, 11] },
        { label: 'Avg Service', value: avgServiceStr, color: [99, 102, 241] },
        { label: 'Busiest Hour', value: busiestStr, color: [14, 165, 233] },
    ];
    const mW = (pageW - 28) / 6 - 1;
    metrics.forEach((m, i) => {
        const x = 14 + i * (mW + 2);
        doc.setFillColor(...m.color);
        doc.roundedRect(x, statsY, mW, 14, 2, 2, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.text(m.value, x + mW / 2, statsY + 6.5, { align: 'center' });
        doc.setFontSize(5.5);
        doc.setFont('helvetica', 'normal');
        doc.text(m.label.toUpperCase(), x + mW / 2, statsY + 11, { align: 'center' });
    });

    // ── Student Visit Log Table ──
    const tableY = statsY + 18;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(15, 23, 42);
    doc.text('Student Visit Log', 14, tableY);

    // Helper: parse parent name
    function parseDisplayName(log) {
        if (log.studentNumber === 'PARENT_VISIT' || (log.activity && log.activity.startsWith('[Parent]'))) {
            const m = (log.studentName || '').match(/^(.*?)(?:\s*\(\s*Visiting:\s*(.*?)\s*\))?$/);
            if (m) {
                const parentName = m[1].trim();
                return m[2] ? `${parentName} : ${m[2].trim()}` : parentName;
            }
        }
        return log.studentName || '—';
    }

    const tableRows = all.map(l => [
        parseDisplayName(l),
        l.studentId && l.studentId !== 'N/A' ? l.studentId : (l.studentNumber !== 'PARENT_VISIT' ? (l.studentNumber || '—') : (l.studentId || 'Parent')),
        (l.activity || '—').replace('[Parent] ', ''),
        l.timeIn ? new Date(l.timeIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
        l.timeOut ? new Date(l.timeOut).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Active',
        l.status === 'completed' ? 'Done' : 'Pending',
    ]);

    doc.autoTable({
        startY: tableY + 3,
        head: [['Name / Visitor', 'ID', 'Activity', 'In', 'Out', 'Status']],
        body: tableRows,
        styles: { fontSize: 7.5, cellPadding: 2.5 },
        headStyles: { fillColor: [109, 40, 217], textColor: 255, fontStyle: 'bold', fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 250, 252] },
        columnStyles: {
            0: { cellWidth: 55 },
            1: { cellWidth: 24 },
            2: { cellWidth: 46 },
            3: { cellWidth: 18 },
            4: { cellWidth: 18 },
            5: { cellWidth: 21 },
        },
        didParseCell: (data) => {
            if (data.section === 'body' && data.column.index === 5) {
                data.cell.styles.textColor = data.cell.raw === 'Done' ? [5, 150, 105] : [217, 119, 6];
                data.cell.styles.fontStyle = 'bold';
            }
        }
    });

    // ── Footer ──
    const footerY = doc.internal.pageSize.getHeight() - 8;
    doc.setFontSize(6.5);
    doc.setTextColor(148, 163, 184);
    doc.setFont('helvetica', 'normal');
    doc.text(`Logbook System — ${staffName} Faculty Report`, 14, footerY);
    doc.text(`Generated ${dateStr}`, pageW - 14, footerY, { align: 'right' });

    const filename = `faculty-report-${staffName.replace(/\s+/g, '-').toLowerCase()}-${today.toISOString().split('T')[0]}.pdf`;
    doc.save(filename);
    showToast('PDF report downloaded!');
}


// ----------------------------------------------------------------
// Init
// ----------------------------------------------------------------
async function init() {
    const noFacultyState = document.getElementById('noFacultyState');
    const statsRow = document.getElementById('statsRow');
    const queueCard = document.getElementById('queueCard');
    const facultyNameHeader = document.getElementById('facultyNameHeader');

    // Load office settings
    try {
        const settings = await loadSystemSettings();
        if (settings.officeId) officeId = settings.officeId;
    } catch (e) { console.warn('Could not load settings'); }

    if (!staffName) {
        noFacultyState?.classList.remove('hidden');
        renderFacultySelection();
        return;
    }

    // Show components based on hub type
    if (staffName === 'Employee Hub') {
        statsRow?.classList.add('hidden');
        queueCard?.classList.add('hidden');
        document.getElementById('summaryCard')?.classList.add('hidden');
    } else {
        statsRow?.classList.remove('hidden');
        statsRow?.classList.add('grid');
        queueCard?.classList.remove('hidden');
        document.getElementById('summaryCard')?.classList.remove('hidden');
    }

    if (facultyNameHeader) facultyNameHeader.textContent = staffName;
    document.title = `${staffName} - Faculty Hub`;

    // Initial load
    renderQueue();
    renderSummary();
    checkClockInStatus();

    // Auto-refresh every 10s
    autoRefreshTimer = setInterval(() => {
        renderQueue();
        renderSummary();
        checkClockInStatus();
    }, 10000);

    // Manual refresh button
    document.getElementById('refreshBtn')?.addEventListener('click', () => {
        renderQueue();
        renderSummary();
    });

    // PDF download button
    document.getElementById('downloadPdfBtn')?.addEventListener('click', () => {
        generatePDF();
    });

    // Clock out button
    document.getElementById('clockOutBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clock out?')) {
            handleClockOut();
        }
    });

    // Proof upload listener
    document.getElementById('proofUploadInput')?.addEventListener('change', handleFileSelected);

    // Header Logout button listener
    document.getElementById('logoutHeaderBtn')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to log out of the system?')) {
            window.authManager.handleLogout();
        }
    });

    // Proof modal close listeners
    const closeModal = () => {
        document.getElementById('proofViewerModal')?.classList.add('hidden');
    };
    document.getElementById('closeProofModal')?.addEventListener('click', closeModal);
    document.getElementById('closeProofModalBtn')?.addEventListener('click', closeModal);
    document.getElementById('proofViewerModal')?.addEventListener('click', (e) => {
        if (e.target.id === 'proofViewerModal') closeModal();
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
// ----------------------------------------------------------------
// Quick Student Lookup Logic
// ----------------------------------------------------------------

let allStudents = [];

function initQuickLookup() {
    const openBtn = document.getElementById('openSearchBtn');
    const modal = document.getElementById('lookupModal');
    const searchInput = document.getElementById('lookupSearchInput');

    if (!openBtn || !modal || !searchInput) return;

    openBtn.addEventListener('click', () => {
        modal.classList.remove('hidden');
        modal.classList.add('flex');
        searchInput.focus();
        fetchStudentsForLookup();
    });

    searchInput.addEventListener('input', () => {
        const term = searchInput.value.toLowerCase().trim();
        renderLookupResults(term);
    });
}

async function fetchStudentsForLookup() {
    try {
        const res = await fetch('/api/students');
        allStudents = await res.json();
    } catch (e) {
        console.error('Error fetching students:', e);
    }
}

function renderLookupResults(term) {
    const resultsArea = document.getElementById('lookupResults');
    if (!resultsArea) return;

    if (!term) {
        resultsArea.innerHTML = `<div class="text-center py-10 text-slate-400 italic">Type to search for students...</div>`;
        return;
    }

    const filtered = allStudents.filter(s =>
        (s.name || '').toLowerCase().includes(term) ||
        (s.studentId || '').toLowerCase().includes(term) ||
        (s.barcode || '').toLowerCase().includes(term)
    ).slice(0, 50); // Limit to 50 results

    if (filtered.length === 0) {
        resultsArea.innerHTML = `<div class="text-center py-10 text-slate-400 italic">No students found matching "${term}"</div>`;
        return;
    }

    resultsArea.innerHTML = filtered.map(s => `
        <div class="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-700/50 rounded-2xl border border-slate-100 dark:border-slate-600 hover:border-blue-500 transition-all group">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-300 flex items-center justify-center font-bold">
                    ${(s.name || 'S').charAt(0)}
                </div>
                <div>
                    <p class="font-bold text-slate-900 dark:text-white leading-none mb-1">${s.name}</p>
                    <p class="text-[10px] font-mono text-slate-400 uppercase tracking-widest">${s.studentId || s.barcode}</p>
                </div>
            </div>
            <button onclick="viewStudentDetails('${s.barcode}')" class="px-4 py-2 bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 font-bold text-xs rounded-xl border border-slate-200 dark:border-slate-600 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-all">
                View History
            </button>
        </div>
    `).join('');

    if (window.lucide) lucide.createIcons();
}

async function viewStudentDetails(barcode) {
    const student = allStudents.find(s => s.barcode === barcode);
    if (!student) return;

    const modal = document.getElementById('studentDetailsModal');
    const content = document.getElementById('studentDetailsContent');
    if (!modal || !content) return;

    content.innerHTML = `
        <div class="flex flex-col items-center py-4">
            <div class="animate-spin rounded-full h-10 w-10 border-4 border-blue-500 border-t-transparent"></div>
            <p class="mt-4 text-slate-500 font-medium">Loading history...</p>
        </div>
    `;
    modal.classList.remove('hidden');
    modal.classList.add('flex');

    try {
        const res = await fetch(`/api/logs?studentNumber=${barcode}`);
        const logs = await res.json();

        // Sort logs: newest first
        const sortedLogs = logs.sort((a, b) => new Date(b.timeIn) - new Date(a.timeIn)).slice(0, 10);

        content.innerHTML = `
            <div class="space-y-4">
                <div class="grid grid-cols-2 gap-4 pb-4 border-b border-slate-100 dark:border-slate-700">
                    <div>
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Course & Year</p>
                        <p class="font-bold text-slate-700 dark:text-slate-200">${student.course} - ${student.yearLevel}</p>
                    </div>
                    <div>
                        <p class="text-[10px] font-black uppercase text-slate-400 tracking-widest mb-1">Student ID</p>
                        <p class="font-bold text-slate-700 dark:text-slate-200">${student.studentId || 'N/A'}</p>
                    </div>
                </div>
                
                <h4 class="text-xs font-black uppercase tracking-widest text-slate-400 mb-2">Recent Visits (Last 10)</h4>
                <div class="space-y-3 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                    ${sortedLogs.length === 0 ? '<p class="text-center py-4 italic text-slate-400">No visit history found.</p>' : sortedLogs.map(l => `
                        <div class="p-3 bg-slate-50 dark:bg-slate-700/50 rounded-xl border border-slate-100 dark:border-slate-600">
                            <div class="flex justify-between items-start mb-1">
                                <p class="font-bold text-sm text-slate-800 dark:text-slate-200">${l.activity}</p>
                                <span class="text-[10px] bg-slate-200 dark:bg-slate-600 px-2 py-0.5 rounded uppercase font-black">${l.status}</span>
                            </div>
                            <div class="flex justify-between items-center text-[10px] text-slate-500">
                                <span>${new Date(l.timeIn).toLocaleDateString()} ${new Date(l.timeIn).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                <span>with ${l.staff || 'Generic'}</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        if (window.lucide) lucide.createIcons();
    } catch (e) {
        content.innerHTML = `<p class="text-red-500 font-bold">Error loading history. Please try again.</p>`;
    }
}

// Export for global access via onclick
window.viewStudentDetails = viewStudentDetails;

// Initializations
document.addEventListener('DOMContentLoaded', () => {
    initQuickLookup();
});
