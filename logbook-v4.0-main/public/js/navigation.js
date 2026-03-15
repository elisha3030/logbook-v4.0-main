/**
 * navigation.js
 * Dynamically injects the "Faculty Hubs" sidebar section on all management pages.
 * Faculty names are stored as a JSON array in the `faculty` settings key.
 *
 * Usage: <script type="module" src="js/navigation.js"></script>
 * Requires: a <nav id="mainNav"> element in the sidebar (or the nav element that
 *           contains System Settings link), and a placeholder element:
 *           <div id="facultyHubsSection"></div>
 */

async function loadFacultySidebar() {
    const placeholder = document.getElementById('facultyHubsSection');
    if (!placeholder) return;

    // Determine current page for active-state styling
    const currentPage = window.location.pathname.split('/').pop() || 'dashboard.html';

    let faculty = [];
    try {
        const res = await fetch('/api/settings');
        const settings = await res.json();
        faculty = JSON.parse(settings.faculty || '[]');
    } catch (e) {
        faculty = [];
    }

    let html = `
        <div class="pt-8 text-[10px] font-black uppercase tracking-[0.2em] text-slate-500 px-4 mb-3">
            Faculty Hubs
        </div>
    `;

    if (faculty.length === 0) {
        html += `<p class="text-[11px] italic text-slate-600 px-4 mb-2">No faculty added</p>`;
    } else {
        faculty.forEach(name => {
            const encoded = encodeURIComponent(name);
            const isActive = currentPage === 'faculty.html' &&
                new URLSearchParams(window.location.search).get('staff') === name;
            html += `
                <a href="faculty.html?staff=${encoded}"
                    class="flex items-center gap-3 px-4 py-3 rounded-xl transition-all font-semibold group ${isActive
                    ? 'bg-purple-600 text-white shadow-lg shadow-purple-900/20'
                    : 'hover:bg-slate-800 hover:text-white'
                }">
                    <i data-lucide="user-round" class="w-5 h-5 ${isActive ? '' : 'group-hover:text-purple-400 transition-colors'}"></i>
                    <span class="truncate">${_escape(name)}</span>
                </a>
            `;
        });
    }

    placeholder.innerHTML = html;

    // Re-initialize Lucide icons for freshly injected icons
    if (window.lucide) {
        lucide.createIcons();
    }
}

function _escape(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// Run on DOM ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', loadFacultySidebar);
} else {
    loadFacultySidebar();
}
