# ⚙️ Recommended System Settings for Implementation

To make the **Digital Logbook System** more flexible and user-friendly, here are several "System Settings" features suggested for the next phase of development:

### 1. 🏢 Department & Office Configuration
*   **Office Name Customization**: Allow admins to change the name displayed on the dashboard (e.g., "Engineering Office" to "Dean's Office").
*   **Office ID Management**: A setting to change the `officeId` for data tagging without editing the source code.
*   **School Information**: Fields to upload the school logo and official name for the PDF report headers.

### 2. 📝 Activity & Category Management
*   **Custom Activity List**: A simple interface to add, edit, or delete the "Purpose of Visit" options (currently hardcoded as Enrollment, Inquiries, etc.).
*   **Year Level Toggle**: Options to enable or disable specific fields in the registration form based on the current department requirements.
*   **Required Fields**: A checklist to mark which student information is "Required" or "Optional" during check-in.

### 3. 🖱️ Scanner & UI Preferences
*   **Auto-Submit Toggle**: An option to turn on/off the automatic submission of scans (useful for high-speed vs. verification-based logging).
*   **Audio Feedback**: A setting to enable or disable a "Beep" or success sound upon a successful NFC/Barcode scan.
*   **Appearance Mode**: A Dark Mode / Light Mode toggle to reduce eye strain for staff working long hours at the station.

### 4. 🗄️ Data & Sync Management
*   **Manual Sync Trigger**: A button to force an immediate backup of local logs to the Firebase cloud.
*   **Auto-Checkout Timer**: A setting to automatically "Check-Out" any students who are still clocked in at a specific time (e.g., 5:00 PM).
*   **Database Maintenance**: Options to clear successfully synced local logs to save disk space on the terminal device.

### 5. 🔐 Security & Staff Control
*   **Authorized Staff Emails**: A whitelist management system to add or remove staff members who can access the dashboard.
*   **Session Timeout**: A setting to automatically log out the staff member from the dashboard after a period of inactivity.
*   **Activity Audit**: A hidden log of "Who changed what" within the settings themselves.

---

### **Implementation Strategy:**
> **Tip:** These settings should be stored in the local **SQLite database** first (to maintain the "Offline-First" rule) and then synced to the **Firebase Remote Config** or a dedicated `settings` collection in Firestore.
