import { loadSystemSettings, applyThemeFromStorage } from './settings.js';
import OfflineRegistry from './offline-registry.js';

// Apply saved theme immediately
applyThemeFromStorage();

class StudentsManager {
    constructor() {
        this.students = [];
        this.filteredStudents = [];
        this.currentPage = 1;
        this.studentsPerPage = 10;
        this.isLoading = false;
        this.officeId = 'engineering-office';
        this.offlineRegistry = new OfflineRegistry();
        this.init();
    }

    init() {
        if (document.getElementById('studentsTableBody')) {
            this.setupEventListeners();
            this.setupConfirmModal(); // This was missing in the diff's init block, but present in original. Keeping it.
            this.loadStudents();

            // Periodically re-fetch to keep sync statuses up-to-date
            setInterval(() => this.loadStudents(), 15000);

            // Start heartbeat for offline sync
            setInterval(() => {
                this.offlineRegistry.sync().then(synced => {
                    if (synced > 0) {
                        this.showToast(`Synced ${synced} record(s)!`);
                        this.loadStudents(); // Reload table
                    }
                });
            }, 45000); // Check every 45 seconds
        }
    }

    setupConfirmModal() {
        const modal = document.getElementById('confirmModal');
        const cancelBtn = document.getElementById('confirmCancelBtn');
        if (cancelBtn) cancelBtn.addEventListener('click', () => this._resolveConfirm && this._resolveConfirm(false));
        if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) this._resolveConfirm && this._resolveConfirm(false); });
    }

    confirmDelete(student) {
        return new Promise((resolve) => {
            this._resolveConfirm = (result) => {
                const modal = document.getElementById('confirmModal');
                modal.classList.remove('visible');
                this._resolveConfirm = null;
                resolve(result);
            };

            // Populate student info
            document.getElementById('confirmStudentName').textContent = student.name;
            document.getElementById('confirmStudentBarcode').textContent = student.barcode;
            document.getElementById('confirmStudentAvatar').textContent = student.name.charAt(0).toUpperCase();

            // Wire confirm button fresh each time
            const deleteBtn = document.getElementById('confirmDeleteBtn');
            const newBtn = deleteBtn.cloneNode(true); // remove old listeners
            deleteBtn.parentNode.replaceChild(newBtn, deleteBtn);
            newBtn.addEventListener('click', () => this._resolveConfirm && this._resolveConfirm(true));

            // Show modal
            const modal = document.getElementById('confirmModal');
            modal.classList.add('visible');
            if (window.lucide) window.lucide.createIcons();
        });
    }

    setupEventListeners() {
        const searchInput = document.getElementById('studentSearch');
        const yearFilter = document.getElementById('yearLevelFilter');
        const addBtn = document.getElementById('addStudentBtn');
        const form = document.getElementById('studentForm');

        if (searchInput) searchInput.addEventListener('input', () => this.filterStudents());
        if (yearFilter) yearFilter.addEventListener('change', () => this.filterStudents());
        if (addBtn) addBtn.addEventListener('click', () => this.openModal());
        if (form) form.addEventListener('submit', (e) => this.handleFormSubmit(e));
    }

    selectRoom(room) {
        this.selectedRoom = room;
        this.filterStudents();
    }

    clearRoomSelection() {
        this.selectedRoom = null;
        const searchInput = document.getElementById('studentSearch');
        const yearFilter = document.getElementById('yearLevelFilter');
        if (searchInput) searchInput.value = '';
        if (yearFilter) yearFilter.value = '';
        this.filterStudents();
    }

    showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const template = document.getElementById('toastTemplate');
        if (!container || !template) return;

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

        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 3000);
    }

    async loadStudents() {
        try {
            const tableBody = document.getElementById('studentsTableBody');
            if (!tableBody) return;

            const response = await fetch('/api/students');
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Failed to fetch students');

            this.students = data;
            this.filterStudents();
        } catch (error) {
            console.error('❌ Error loading students:', error);
            this.showToast('Error loading student directory', 'error');
        }
    }

    getRoom(course) {
        if (!course || course === 'null' || course === 'undefined') return 'Computer Engineering';
        const c = course.toLowerCase().trim();

        if (c.includes('electrical') || c.includes('bsee') || c === 'ee') return 'Electrical Engineering';
        if (c.includes('industrial') || c.includes('bsie') || c === 'ie') return 'Industrial Engineering';
        if (c.includes('electronic') || c.includes('bsece') || c === 'ece' || c.includes('electronics')) return 'Electronics Engineering';

        // Everything else (BSCS-DS, CPE, generic Engineering) defaults to Computer Engineering
        return 'Computer Engineering';
    }

    filterStudents() {
        const searchTerm = document.getElementById('studentSearch')?.value.toLowerCase() || '';
        const yearValue = document.getElementById('yearLevelFilter')?.value || '';

        this.filteredStudents = this.students
            .filter(student => {
                const sid = (student.studentId || '').toLowerCase();
                const matchesSearch = !searchTerm ||
                    student.name.toLowerCase().includes(searchTerm) ||
                    student.barcode.toLowerCase().includes(searchTerm) ||
                    sid.includes(searchTerm);
                const matchesYear = !yearValue || student.yearLevel === yearValue;
                const matchesRoom = !this.selectedRoom || this.getRoom(student.course) === this.selectedRoom;
                return matchesSearch && matchesYear && matchesRoom;
            })
            .sort((a, b) => {
                const ra = this.getRoom(a.course).toLowerCase();
                const rb = this.getRoom(b.course).toLowerCase();
                if (ra !== rb) return ra.localeCompare(rb);
                return (a.name || '').localeCompare(b.name || '');
            });

        this.currentPage = 1;
        this.displayStudents();
    }

    displayStudents() {
        const roomsContainer = document.getElementById('roomsContainer');
        const tableContainer = document.getElementById('tableContainer');

        if (!this.selectedRoom) {
            // Show Rooms Grid
            roomsContainer.classList.remove('hidden');
            tableContainer.classList.add('hidden');
            this.displayRoomsGrid();
        } else {
            // Show Table
            roomsContainer.classList.add('hidden');
            tableContainer.classList.remove('hidden');
            this.displayStudentsTable();
        }
    }

    displayRoomsGrid() {
        const roomsContainer = document.getElementById('roomsContainer');

        const ROOMS = [
            'Computer Engineering',
            'Electrical Engineering',
            'Electronics Engineering',
            'Industrial Engineering'
        ];

        // Ensure we always render exactly the 4 permanent rooms
        roomsContainer.innerHTML = ROOMS.map(room => {
            const count = this.students.filter(s => this.getRoom(s.course) === room).length;
            return `
            <div onclick="window.studentsManager.selectRoom('${room.replace(/'/g, "\\'")}')" 
                 class="aspect-square bg-white dark:bg-slate-800 shadow-xl shadow-slate-200/50 dark:shadow-slate-900/50 border border-slate-100 dark:border-slate-700 rounded-[3rem] flex flex-col items-center justify-center p-8 cursor-pointer hover:border-blue-500 hover:ring-8 ring-blue-50 transition-all text-center group relative overflow-hidden transform active:scale-95">
                <div class="absolute inset-0 bg-gradient-to-br from-blue-50/50 to-transparent opacity-0 group-hover:opacity-100 transition-opacity"></div>
                
                <div class="w-20 h-20 rounded-full bg-blue-50 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                    <i data-lucide="door-open" class="w-10 h-10 text-blue-600"></i>
                </div>
                
                <h3 class="text-2xl font-black text-slate-800 dark:text-white group-hover:text-blue-600 transition-colors leading-tight mb-3">
                    ${room}
                </h3>
                
                <span class="px-3 py-1 bg-slate-100 text-slate-500 rounded-lg text-[10px] font-black uppercase tracking-widest group-hover:bg-blue-100 group-hover:text-blue-700 transition-colors">
                    ${count} Student${count !== 1 ? 's' : ''}
                </span>
            </div>
            `;
        }).join('');
        lucide.createIcons();
    }

    displayStudentsTable() {
        const tableBody = document.getElementById('studentsTableBody');
        const roomLabel = document.getElementById('roomContextLabel');
        if (roomLabel) roomLabel.innerText = `Viewing Room — ${this.selectedRoom}`;

        const startIndex = (this.currentPage - 1) * this.studentsPerPage;
        const endIndex = startIndex + this.studentsPerPage;
        const pageStudents = this.filteredStudents.slice(startIndex, endIndex);

        if (pageStudents.length === 0) {
            tableBody.innerHTML = `<tr><td colspan="6" class="px-8 py-20 text-center text-slate-400 font-medium italic">No students found.</td></tr>`;
            return;
        }

        const val = (v) => (!v || v === 'null' || v === 'undefined') ? '<span class="text-slate-300 font-normal">—</span>' : v;

        tableBody.innerHTML = pageStudents.map(student => `
            <tr class="hover:bg-slate-50/80 dark:hover:bg-slate-700/50 transition-colors group">
                <td class="px-8 py-5">
                    <div class="flex items-center gap-3">
                        <div class="w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-white flex items-center justify-center font-bold border border-blue-100 dark:border-blue-900/20">
                            ${student.name.charAt(0)}
                        </div>
                        <div>
                            <p class="font-bold text-slate-900 dark:text-white leading-none mb-1">${student.name}</p>
                            <p class="text-[10px] font-mono text-slate-400 uppercase tracking-widest">${student.barcode}</p>
                        </div>
                    </div>
                </td>
                <td class="px-8 py-5 font-bold text-slate-700 dark:text-slate-300">${val(student.studentId)}</td>
                <td class="px-6 py-5 text-sm font-medium text-slate-400 dark:text-slate-300 italic">${val(student.course)}</td>
                <td class="px-6 py-5">
                    <span class="px-3 py-1 rounded-lg bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-black uppercase tracking-wider border border-slate-200 dark:border-slate-600">
                        ${student.yearLevel}
                    </span>
                </td>
                <td class="px-6 py-5 text-center">
                    ${student.synced === 2
                ? '<span class="text-orange-500 flex items-center justify-center gap-1 text-[10px] font-black uppercase"><i data-lucide="cloud-lightning" class="w-4 h-4"></i> Local</span>'
                : student.synced
                    ? '<span class="text-emerald-500 flex items-center justify-center gap-1 text-[10px] font-black uppercase"><i data-lucide="cloud-check" class="w-4 h-4"></i> Synced</span>'
                    : '<span class="text-amber-500 flex items-center justify-center gap-1 text-[10px] font-black uppercase"><i data-lucide="cloud-off" class="w-4 h-4"></i> Pending</span>'
            }
                </td>
                <td class="px-8 py-5 text-right">
                    <div class="flex items-center justify-end gap-2">
                        <button onclick="window.studentsManager.openModal('${student.barcode}')" class="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-400 hover:text-blue-600 hover:border-blue-200 transition-all">
                            <i data-lucide="edit-3" class="w-4 h-4"></i>
                        </button>
                        <button onclick="window.studentsManager.deleteStudent('${student.barcode}')" class="w-9 h-9 flex items-center justify-center rounded-xl bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-slate-400 hover:text-red-500 hover:border-red-200 transition-all">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </div>
                </td>
            </tr>`).join('');
        lucide.createIcons();
        this.updatePagination();
    }

    updatePagination() {
        const pagination = document.getElementById('pagination');
        const totalPages = Math.ceil(this.filteredStudents.length / this.studentsPerPage);
        if (totalPages <= 1) { pagination.innerHTML = ''; return; }

        let html = `<li><button class="px-4 py-2 text-xs font-black rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-50" ${this.currentPage === 1 ? 'disabled' : ''} onclick="window.studentsManager.goToPage(${this.currentPage - 1})">Prev</button></li>`;
        for (let i = 1; i <= totalPages; i++) {
            html += `<li><button class="w-10 h-10 flex items-center justify-center text-xs font-black rounded-xl border transition-all ${i === this.currentPage ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white dark:bg-slate-700 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-300'}" onclick="window.studentsManager.goToPage(${i})">${i}</button></li>`;
        }
        html += `<li><button class="px-4 py-2 text-xs font-black rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-600 dark:text-slate-300 disabled:opacity-50" ${this.currentPage === totalPages ? 'disabled' : ''} onclick="window.studentsManager.goToPage(${this.currentPage + 1})">Next</button></li>`;
        pagination.innerHTML = html;
    }

    goToPage(page) {
        this.currentPage = page;
        this.displayStudents();
    }

    openModal(barcode = null) {
        const modal = document.getElementById('studentModal');
        const form = document.getElementById('studentForm');
        this.editingBarcode = barcode;

        if (barcode) {
            document.getElementById('modalTitle').textContent = 'Edit Student Details';
            const student = this.students.find(s => s.barcode === barcode);
            if (student) {
                document.getElementById('barcode').value = student.barcode;
                document.getElementById('barcode').readOnly = true;
                document.getElementById('barcode').classList.add('bg-slate-100', 'cursor-not-allowed');
                document.getElementById('name').value = student.name;
                document.getElementById('studentId').value = student.studentId;
                document.getElementById('course').value = student.course;
                document.getElementById('yearLevel').value = student.yearLevel;
            }
        } else {
            document.getElementById('modalTitle').textContent = 'Add New Student';
            form.reset();
            document.getElementById('barcode').readOnly = false;
            document.getElementById('barcode').classList.remove('bg-slate-100', 'cursor-not-allowed');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    }

    closeModal() {
        const modal = document.getElementById('studentModal');
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }

    async handleFormSubmit(e) {
        e.preventDefault();
        const formData = {
            barcode: document.getElementById('barcode').value,
            name: document.getElementById('name').value,
            studentId: document.getElementById('studentId').value,
            course: document.getElementById('course').value,
            yearLevel: document.getElementById('yearLevel').value
        };

        try {
            const url = this.editingBarcode ? `/api/students/${this.editingBarcode}` : '/api/students/register';
            const method = this.editingBarcode ? 'PUT' : 'POST';

            // Note: register endpoint uses casing Course, others use course. Standardizing here for Backend to handle logic.
            // Backend register endpoint expects: { barcode, name, studentId, Course, yearLevel }
            const payload = this.editingBarcode ? formData : { ...formData, Course: formData.course };

            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) throw new Error('Failed to save student');

            this.showToast(this.editingBarcode ? 'Student updated successfully' : 'Student added successfully');
            this.closeModal();
            this.loadStudents();

            // Re-fetch after 3s to show updated sync status (Pending → Synced)
            setTimeout(() => this.loadStudents(), 3000);
        } catch (error) {
            console.warn('❌ Save student failed, queuing offline:', error);

            // Queue locally
            this.offlineRegistry.queueRegistration(payload);

            this.showToast('Server unavailable. Data saved locally and will sync later.', 'error');
            this.closeModal();

            // Add a temporary local entry to the table so the user sees it
            const existingIdx = this.students.findIndex(s => s.barcode === payload.barcode);
            if (existingIdx !== -1) {
                this.students[existingIdx] = { ...payload, synced: 2 }; // synced=2 = local pending
            } else {
                this.students.unshift({ ...payload, synced: 2 });
            }
            this.filterStudents();
        }
    }

    async deleteStudent(barcode) {
        const student = this.students.find(s => s.barcode === barcode);
        if (!student) return;

        const confirmed = await this.confirmDelete(student);
        if (!confirmed) return;

        try {
            const response = await fetch(`/api/students/${barcode}`, { method: 'DELETE' });
            if (!response.ok) throw new Error('Failed to delete student');

            this.showToast('Student record deleted');
            this.loadStudents();
        } catch (error) {
            console.error('❌ Error deleting student:', error);
            this.showToast('Error deleting record', 'error');
        }
    }
}

window.studentsManager = new StudentsManager();
