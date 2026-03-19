
async function initPortalMonitoring() {
    const container = document.getElementById('staffPresencePortal');
    if (!container) return;

    try {
        const response = await fetch('/api/logs?officeId=engineering-office');
        if (!response.ok) return;
        
        const logs = await response.json();
        const activeStaff = logs.filter(l => l.studentNumber === 'EMPLOYEE_LOG' && !l.timeOut);

        if (activeStaff.length === 0) {
            container.classList.add('hidden');
            return;
        }

        container.classList.remove('hidden');
        const listEl = document.getElementById('activeStaffList');
        if (listEl) {
            listEl.innerHTML = activeStaff.map(staff => `
                <div class="flex items-center gap-2 bg-blue-50 dark:bg-blue-900/20 px-3 py-1.5 rounded-full border border-blue-100 dark:border-blue-800 transition-all hover:scale-105">
                    <div class="w-5 h-5 rounded-full bg-blue-600 text-[10px] text-white flex items-center justify-center font-black">
                        ${(staff.studentName || 'S').charAt(0).toUpperCase()}
                    </div>
                    <span class="text-[10px] font-bold text-blue-700 dark:text-blue-300 whitespace-nowrap">${staff.studentName}</span>
                    <div class="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></div>
                </div>
            `).join('');
        }

        if (window.lucide) {
            window.lucide.createIcons();
        }
    } catch (e) {
        console.warn('Portal monitoring fetch failed:', e);
    }
}

// Initial load
document.addEventListener('DOMContentLoaded', initPortalMonitoring);

// Refresh every 30 seconds
setInterval(initPortalMonitoring, 30000);
