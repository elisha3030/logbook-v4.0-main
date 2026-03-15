console.log('--- SERVER STARTING ---');
require('dotenv').config();
console.log('1. dotenv initialized');
const express = require('express');
console.log('2. express loaded');
const admin = require('firebase-admin');
console.log('3. firebase-admin loaded');
const cors = require('cors');
console.log('4. cors loaded');
const path = require('path');
console.log('5. path loaded');
const { open } = require('sqlite');
console.log('6. sqlite loaded');
const sqlite3 = require('sqlite3');
console.log('7. sqlite3 loaded');
const crypto = require('crypto');
console.log('8. crypto loaded');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
console.log('9. session modules loaded');

const app = express();
console.log('8. express app created');
const PORT = process.env.PORT || 3000;
console.log('9. PORT set to', PORT);

// Initialize Firebase Admin
let db = null;
let firebaseInitialized = false;

// Runtime cloud connectivity — separate from startup init.
// Set to false when a sync fails with a network/unavailability error;
// reset to true as soon as a sync succeeds.
const BASE_SYNC_INTERVAL_MS = 60 * 1000; // 1 minute
const MAX_SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes cap
let cloudReachable = true; // Assume online until proven otherwise to avoid "offline-first" confusion
let consecutiveSyncFailures = 0;
const MAX_CONSECUTIVE_FAILURES = 3;
let lastSyncAttempt = null;

function getSyncRetryDelay() {
    // Exponential backoff: 1 m → 2 m → 4 m → 8 m → 10 m (cap)
    return Math.min(BASE_SYNC_INTERVAL_MS * Math.pow(2, consecutiveSyncFailures), MAX_SYNC_INTERVAL_MS);
}

function markCloudReachable() {
    if (!cloudReachable) console.log('✅ Cloud connection restored.');
    cloudReachable = true;
    consecutiveSyncFailures = 0;
}

function markCloudUnreachable(reason) {
    consecutiveSyncFailures++;
    if (cloudReachable) console.warn(`⚠️  Cloud unreachable (${reason}). Falling back to offline DB. Retry #${consecutiveSyncFailures}.`);
    cloudReachable = false;
}

try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (serviceAccountPath) {
        const absolutePath = path.isAbsolute(serviceAccountPath)
            ? serviceAccountPath
            : path.join(__dirname, serviceAccountPath);

        console.log(`🔍 Checking for service account at: ${absolutePath}`);

        if (require('fs').existsSync(absolutePath)) {
            const serviceAccount = require(absolutePath);
            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });
            db = admin.firestore();
            firebaseInitialized = true;
            console.log('✅ Firebase Admin initialized successfully.');
        } else {
            console.warn(`⚠️ Service account file not found at ${absolutePath}.`);
        }
    } else {
        console.warn('⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not defined in .env.');
    }
} catch (error) {
    console.error('❌ Error during Firebase initialization:', error);
}

if (!firebaseInitialized) {
    console.warn('🚀 Running in OFFLINE-ONLY mode. Cloud sync disabled.');
} else {
    cloudReachable = true; // Assume reachable until first failure
}

// Local SQLite Database Initialization
let localDb;
async function initializeLocalDb() {
    localDb = await open({
        filename: path.join(__dirname, 'local.db'),
        driver: sqlite3.Database
    });

    // Enable WAL mode for better concurrency (read/write at the same time)
    await localDb.exec('PRAGMA journal_mode = WAL');
    await localDb.exec('PRAGMA synchronous = NORMAL');
    await localDb.exec('PRAGMA mmap_size = 30000000000');
    await localDb.exec('PRAGMA cache_size = -2000'); // 2MB cache
    await localDb.exec('PRAGMA temp_store = MEMORY');

    // Students table for local caching
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS students (
            barcode TEXT PRIMARY KEY,
            name TEXT,
            studentId TEXT,
            course TEXT,
            yearLevel TEXT,
            synced INTEGER DEFAULT 0,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Logs table for offline-first logging
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id TEXT PRIMARY KEY,
            studentNumber TEXT,
            studentName TEXT,
            studentId TEXT,
            activity TEXT,
            staff TEXT,
            yearLevel TEXT,
            course TEXT,
            date TEXT,
            timeIn TEXT,
            timeOut TEXT,
            staffEmail TEXT,
            officeId TEXT,
            synced INTEGER DEFAULT 0,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Add staff column if it doesn't exist (for existing databases)
    try {
        await localDb.exec('ALTER TABLE logs ADD COLUMN staff TEXT');
    } catch (e) { /* column already exists */ }

    // Add status column if it doesn't exist
    try {
        await localDb.exec("ALTER TABLE logs ADD COLUMN status TEXT DEFAULT 'pending'");
    } catch (e) { /* column already exists */ }

    // Add serviceStartTime column if it doesn't exist
    try {
        await localDb.exec('ALTER TABLE logs ADD COLUMN serviceStartTime TEXT');
    } catch (e) { /* column already exists */ }

    // Add synced column to students if it doesn't exist
    try {
        await localDb.exec('ALTER TABLE students ADD COLUMN synced INTEGER DEFAULT 1');
    } catch (e) { /* column already exists */ }

    // Settings table (key-value store for all system settings)
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Authorized staff emails whitelist
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS authorized_staff (
            email TEXT PRIMARY KEY,
            addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Audit log: tracks who changed what in settings
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            staffEmail TEXT,
            action TEXT,
            details TEXT,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Offline auth cache — stores PBKDF2-hashed credentials for staff
    // who have successfully authenticated online at least once.
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS cached_auth (
            email    TEXT PRIMARY KEY,
            hash     TEXT NOT NULL,
            salt     TEXT NOT NULL,
            cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // ============================================================
    // Admin accounts — fully local, no Firebase Auth dependency.
    // Credentials are verified offline via PBKDF2 (same as cached_auth).
    // Firebase Auth is NOT consulted for admin authentication.
    // ============================================================
    await localDb.exec(`
        CREATE TABLE IF NOT EXISTS admin_users (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            email       TEXT UNIQUE NOT NULL,
            hash        TEXT NOT NULL,
            salt        TEXT NOT NULL,
            displayName TEXT DEFAULT 'Administrator',
            role        TEXT DEFAULT 'admin',
            createdAt   DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Seed the default admin if no admin accounts exist yet
    const adminCount = await localDb.get('SELECT COUNT(*) AS count FROM admin_users');
    if (adminCount.count === 0) {
        const defaultSalt = crypto.randomBytes(32).toString('hex');
        const defaultHash = hashPassword('admin123', defaultSalt);
        await localDb.run(
            'INSERT INTO admin_users (email, hash, salt, displayName, role) VALUES (?, ?, ?, ?, ?)',
            ['admin@email.com', defaultHash, defaultSalt, 'System Admin', 'superadmin']
        );
        console.log('✨ Default admin seeded in local database (admin@email.com / admin123).');
        console.log('⚠️  IMPORTANT: Change the default admin password after first login!');
    }

    // Seed default settings if not present
    const defaultSettings = {
        officeName: 'Engineering Office',
        officeId: 'engineering-office',
        schoolName: 'Your School Name',
        activities: JSON.stringify(['Enrollment', 'Inquiries', 'Document Request', 'Consultation', 'Others']),
        yearLevelEnabled: 'true',
        yearLevelRequired: 'true',
        courseRequired: 'true',
        autoSubmit: 'false',
        audioFeedback: 'true',
        appearanceMode: 'light',
        autoCheckoutTime: '',
        sessionTimeoutMinutes: '0'
    };
    for (const [key, value] of Object.entries(defaultSettings)) {
        await localDb.run(
            'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
            [key, value]
        );
    }

    // Create Indexes for performance
    await localDb.exec('CREATE INDEX IF NOT EXISTS idx_students_barcode ON students(barcode)');
    await localDb.exec('CREATE INDEX IF NOT EXISTS idx_logs_student_office ON logs(studentNumber, officeId)');
    await localDb.exec('CREATE INDEX IF NOT EXISTS idx_logs_synced ON logs(synced)');

    console.log('📦 Local SQLite database initialized with optimizations.');
}

// Admin Account Initialization
// Admin accounts are stored entirely in local SQLite (admin_users table).
// Firebase Auth is NOT used to create or verify admin credentials.
// The default admin is seeded inside initializeLocalDb() on first run.
async function initializeAdmin() {
    try {
        const accounts = await localDb.all('SELECT email, role, createdAt FROM admin_users ORDER BY createdAt ASC');
        console.log(`✅ Local admin accounts ready: ${accounts.length} account(s) in SQLite.`);
        for (const a of accounts) {
            console.log(`   • ${a.email} (${a.role})`);
        }
    } catch (error) {
        console.error('❌ Error reading admin accounts from SQLite:', error);
    }
}

// Middleware
app.use(cors());
app.use(express.json());

// ============================================================
// SESSION MIDDLEWARE — SQLite-backed, works fully offline
// ============================================================
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
app.use(session({
    store: new SQLiteStore({
        db: 'sessions.db',
        dir: __dirname,
        table: 'sessions'
    }),
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false,          // set true if behind HTTPS proxy
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
    }
}));
console.log('✅ Session middleware ready (SQLite-backed)');

app.use(express.static(path.join(__dirname, 'public')));

// Serve Lucide from node_modules
app.get('/js/lucide.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'lucide', 'dist', 'umd', 'lucide.js'));
});

// Serve ZXing from node_modules
app.get('/js/zxing.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', '@zxing', 'library', 'umd', 'index.min.js'));
});

// Serve Firebase SDK from node_modules (Full directory for ESM resolution)
app.use('/vendor/firebase', express.static(path.join(__dirname, 'node_modules', 'firebase')));

// Serve jsPDF from node_modules
app.get('/js/jspdf.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'jspdf', 'dist', 'jspdf.umd.min.js'));
});
app.get('/js/jspdf-autotable.js', (req, res) => {
    res.sendFile(path.join(__dirname, 'node_modules', 'jspdf-autotable', 'dist', 'jspdf.plugin.autotable.min.js'));
});

// API Routes

// Get Firebase Config
app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID,
        measurementId: process.env.FIREBASE_MEASUREMENT_ID
    });
});

// Get recent logs (Local-First; supports filtering)
app.get('/api/logs', async (req, res) => {
    try {
        const { officeId = 'engineering-office', studentNumber, limit = 500 } = req.query;
        let query = 'SELECT * FROM logs WHERE officeId = ?';
        let params = [officeId];

        if (studentNumber) {
            query += ' AND studentNumber = ?';
            params.push(studentNumber);
        }

        query += ' ORDER BY timeIn DESC LIMIT ?';
        params.push(parseInt(limit));

        const localLogs = await localDb.all(query, params);
        res.json(localLogs);
    } catch (error) {
        console.error('Error fetching logs:', error);
        res.status(500).json({ error: 'Failed to fetch logs' });
    }
});

// GET all students (Local-First)
app.get('/api/students', async (req, res) => {
    try {
        const students = await localDb.all('SELECT * FROM students ORDER BY name ASC');
        res.json(students);
    } catch (error) {
        console.error('Error fetching students:', error);
        res.status(500).json({ error: 'Failed to fetch students' });
    }
});

// UPDATE student details
app.put('/api/students/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const { name, studentId, course, yearLevel } = req.body;

        await localDb.run(
            'UPDATE students SET name = ?, studentId = ?, course = ?, yearLevel = ?, synced = 0 WHERE barcode = ?',
            [name, studentId, course, yearLevel, barcode]
        );

        res.json({ success: true });
        syncStudentsToCloud();
    } catch (error) {
        console.error('Error updating student:', error);
        res.status(500).json({ error: 'Failed to update student' });
    }
});

// DELETE student record (Local-first; cloud delete only when reachable, queued otherwise)
app.delete('/api/students/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;

        // Always delete from local SQLite immediately
        await localDb.run('DELETE FROM students WHERE barcode = ?', barcode);

        // Attempt live cloud delete only when we know Firebase is reachable.
        // If offline, the reconciliation in pullStudentsFromCloud will handle it
        // on the next successful sync (cloud-side record will be deleted then).
        if (firebaseInitialized && cloudReachable) {
            try {
                await db.collection('students').doc(barcode).delete();
                console.log(`✅ Cloud deletion successful for student ${barcode}`);
            } catch (cloudErr) {
                markCloudUnreachable(cloudErr.message);
                console.warn(`⏳ Cloud deletion queued for ${barcode} (offline):`, cloudErr.message);
            }
        } else if (firebaseInitialized) {
            console.log(`💾 Cloud deletion for ${barcode} queued — will sync when online.`);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting student:', error);
        res.status(500).json({ error: 'Failed to delete student' });
    }
});

// Register student only (no log)
app.post('/api/students/register', async (req, res) => {
    try {
        const { barcode, name, studentId, Course, yearLevel } = req.body;

        if (!barcode || !name || !studentId || !Course || !yearLevel) {
            return res.status(400).json({ error: 'All student fields are required' });
        }

        // 1. Save to SQLite immediately (Local-First)
        await localDb.run(
            'INSERT OR REPLACE INTO students (barcode, name, studentId, course, yearLevel, synced) VALUES (?, ?, ?, ?, ?, 0)',
            [barcode, name, studentId, Course, yearLevel]
        );

        res.json({ success: true });

        // 2. Sync to Firestore in background
        syncStudentsToCloud();
    } catch (error) {
        console.error('Error registering student:', error);
        res.status(500).json({ error: 'Failed to register student' });
    }
});

// Lookup student and check for active session (Hybrid: SQLite -> Firebase)
app.get('/api/students/:barcode', async (req, res) => {
    try {
        const { barcode } = req.params;
        const { officeId = 'engineering-office' } = req.query;

        // STRICKLY LOCAL-FIRST: Only check SQLite for instant response.
        // Check both barcode and studentId columns to support manual entry
        const localStudent = await localDb.get(
            'SELECT * FROM students WHERE barcode = ? OR studentId = ?',
            [barcode, barcode]
        );

        if (localStudent) {
            const studentData = {
                id: barcode,
                ...localStudent,
                Course: localStudent.course,
                'Year Level': localStudent.yearLevel
            };

            // Check for active logs in SQLite
            const activeLogs = await localDb.all(
                'SELECT id, activity, status, timeIn FROM logs WHERE studentNumber = ? AND officeId = ? AND timeOut IS NULL ORDER BY timeIn ASC',
                [barcode, officeId]
            );

            return res.json({
                ...studentData,
                activeLogs: activeLogs || []
            });
        }

        // FALLBACK: Student not in local SQLite.
        // Only attempt a cloud lookup when Firebase is configured AND reachable.
        // When offline, skip immediately to avoid blocking the scan flow.
        if (firebaseInitialized && cloudReachable) {
            try {
                const docSnap = await db.collection('students').doc(barcode).get();

                if (docSnap.exists) {
                    const cloudStudent = docSnap.data();

                    // Cache in SQLite so future lookups are instant
                    await localDb.run(
                        'INSERT OR REPLACE INTO students (barcode, name, studentId, course, yearLevel, synced) VALUES (?, ?, ?, ?, ?, 1)',
                        [barcode, cloudStudent.name, cloudStudent.studentId, cloudStudent.Course, cloudStudent["Year Level"]]
                    );

                    const studentData = {
                        id: barcode,
                        barcode: barcode,
                        name: cloudStudent.name,
                        studentId: cloudStudent.studentId,
                        Course: cloudStudent.Course,
                        'Year Level': cloudStudent["Year Level"]
                    };

                    // Use local SQLite for active session check (faster, works offline)
                    const activeLogs = await localDb.all(
                        'SELECT id, activity, status, timeIn FROM logs WHERE studentNumber = ? AND officeId = ? AND timeOut IS NULL ORDER BY timeIn ASC',
                        [barcode, officeId]
                    );

                    markCloudReachable();
                    return res.json({
                        ...studentData,
                        activeLogs: activeLogs || []
                    });
                }
            } catch (cloudError) {
                markCloudUnreachable(cloudError.message);
                console.warn(`⏳ Cloud lookup failed for student ${barcode}:`, cloudError.message);
            }
        } else if (firebaseInitialized && !cloudReachable) {
            console.log(`💾 Cloud lookup skipped for ${barcode} — offline, using local DB only.`);
        }

        res.status(404).json({ error: 'Student not found in local records or cloud' });
    } catch (error) {
        console.error('Error looking up student:', error);
        res.status(500).json({ error: 'Failed to lookup student' });
    }
});

// Register student and log visit (Hybrid: Firestore + SQLite)
app.post('/api/register-log', async (req, res) => {
    try {
        const { studentData, logData, officeId = 'engineering-office' } = req.body;
        const logId = `local_${Date.now()}`;
        const timeIn = new Date().toISOString();

        // 1. Write student to SQLite
        await localDb.run(
            'INSERT OR REPLACE INTO students (barcode, name, studentId, course, yearLevel, synced) VALUES (?, ?, ?, ?, ?, 0)',
            [studentData.barcode, studentData.name, studentData.studentId, studentData.Course, studentData.yearLevel]
        );

        // 2. Write log to SQLite
        await localDb.run(
            `INSERT INTO logs 
            (id, studentNumber, studentName, studentId, activity, staff, yearLevel, course, date, timeIn, staffEmail, officeId, synced, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
            [
                logId,
                logData.studentNumber,
                logData.studentName,
                logData.studentId,
                logData.activity,
                logData.staff || null,
                logData.yearLevel,
                logData.course,
                logData.date,
                timeIn,
                logData.staffEmail,
                officeId
            ]
        );

        res.json({ success: true, logId });

        // 3. Trigger background sync
        syncStudentsToCloud();
        syncToCloud();
    } catch (error) {
        console.error('Error registering student/log:', error);
        res.status(500).json({ error: 'Failed to process registration' });
    }
});

// Log visit only (Local-First)
app.post('/api/logs', async (req, res) => {
    try {
        const { logData, officeId = 'engineering-office' } = req.body;
        const logId = `local_${Date.now()}`;
        const timeIn = new Date().toISOString();

        await localDb.run(
            `INSERT INTO logs 
            (id, studentNumber, studentName, studentId, activity, staff, yearLevel, course, date, timeIn, staffEmail, officeId, synced, status) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending')`,
            [
                logId,
                logData.studentNumber,
                logData.studentName,
                logData.studentId,
                logData.activity,
                logData.staff || null,
                logData.yearLevel,
                logData.course,
                logData.date,
                timeIn,
                logData.staffEmail,
                officeId
            ]
        );

        res.json({ success: true, id: logId });

        // Trigger sync attempt
        syncToCloud();
    } catch (error) {
        console.error('Error logging visit locally:', error);
        res.status(500).json({ error: 'Failed to log visit locally' });
    }
});

// Update log (Time-out)
app.patch('/api/logs/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const timeOut = new Date().toISOString();

        await localDb.run(
            'UPDATE logs SET timeOut = ?, synced = 0 WHERE id = ?',
            [timeOut, id]
        );

        res.json({ success: true });
        syncToCloud();
    } catch (error) {
        console.error('Error updating log locally:', error);
        res.status(500).json({ error: 'Failed to update log' });
    }
});

// Mark log as completed (Staff/Teacher action)
app.patch('/api/logs/:id/complete', async (req, res) => {
    try {
        const { id } = req.params;
        const { staffName } = req.body;

        const timeOut = new Date().toISOString();
        await localDb.run(
            "UPDATE logs SET status = 'completed', timeOut = COALESCE(timeOut, ?), staff = CASE WHEN staff IS NOT NULL AND staff != '' THEN staff ELSE ? END, synced = 0 WHERE id = ?",
            [timeOut, staffName || 'Staff', id]
        );

        res.json({ success: true });
        syncToCloud();
    } catch (error) {
        console.error('Error completing log locally:', error);
        res.status(500).json({ error: 'Failed to complete log' });
    }
});

// Start service (Staff/Teacher action)
app.patch('/api/logs/:id/service-start', async (req, res) => {
    try {
        const { id } = req.params;
        const { staffName } = req.body;
        const serviceStartTime = new Date().toISOString();

        await localDb.run(
            "UPDATE logs SET status = 'in-service', serviceStartTime = ?, staff = CASE WHEN staff IS NOT NULL AND staff != '' THEN staff ELSE ? END, synced = 0 WHERE id = ?",
            [serviceStartTime, staffName || 'Staff', id]
        );

        res.json({ success: true });
        syncToCloud();
    } catch (error) {
        console.error('Error starting service locally:', error);
        res.status(500).json({ error: 'Failed to start service' });
    }
});

// Update log status (Generic toggle)
app.patch('/api/logs/:id/status', async (req, res) => {

    try {
        const { id } = req.params;
        const { status, staffName } = req.body;

        await localDb.run(
            "UPDATE logs SET status = ?, staff = CASE WHEN staff IS NOT NULL AND staff != '' THEN staff ELSE ? END, synced = 0 WHERE id = ?",
            [status, staffName || 'Staff', id]
        );

        res.json({ success: true });
        syncToCloud();
    } catch (error) {
        console.error('Error updating log status locally:', error);
        res.status(500).json({ error: 'Failed to update log status' });
    }
});

// Force-close all stuck active sessions (admin utility)
app.delete('/api/logs/clear-active', async (req, res) => {
    try {
        const timeOut = new Date().toISOString();
        const result = await localDb.run(
            "UPDATE logs SET timeOut = ?, synced = 0 WHERE timeOut IS NULL",
            [timeOut]
        );
        console.log(`🧹 Cleared ${result.changes} stuck active session(s).`);
        res.json({ success: true, cleared: result.changes });
        syncToCloud();
    } catch (error) {
        console.error('Error clearing active sessions:', error);
        res.status(500).json({ error: 'Failed to clear active sessions' });
    }
});

// ============================================================
// SETTINGS API ROUTES
// ============================================================

// Helper: write to audit log
async function writeAudit(staffEmail, action, details) {
    try {
        await localDb.run(
            'INSERT INTO audit_log (staffEmail, action, details) VALUES (?, ?, ?)',
            [staffEmail || 'unknown', action, typeof details === 'object' ? JSON.stringify(details) : details]
        );
    } catch (e) { /* non-critical */ }
}

// GET all settings
app.get('/api/settings', async (req, res) => {
    try {
        const rows = await localDb.all('SELECT key, value FROM settings');
        const settings = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
        res.json(settings);
    } catch (error) {
        console.error('Error fetching settings:', error);
        res.status(500).json({ error: 'Failed to fetch settings' });
    }
});

// PUT (bulk update) settings
app.put('/api/settings', async (req, res) => {
    try {
        const { settings, staffEmail } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'settings object required' });
        }
        for (const [key, value] of Object.entries(settings)) {
            await localDb.run(
                'INSERT OR REPLACE INTO settings (key, value, updatedAt) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [key, String(value)]
            );
        }
        await writeAudit(staffEmail, 'settings_update', settings);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating settings:', error);
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// GET authorized staff list
app.get('/api/settings/staff', async (req, res) => {
    try {
        const rows = await localDb.all('SELECT email, addedAt FROM authorized_staff ORDER BY addedAt ASC');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch staff list' });
    }
});

// GET combined faculty list for student portal
app.get('/api/faculty', async (req, res) => {
    try {
        // Try to get explicit faculty list from settings
        const row = await localDb.get("SELECT value FROM settings WHERE key = 'facultyList'");
        let faculty = [];

        if (row && row.value) {
            try {
                faculty = JSON.parse(row.value);
            } catch (e) {
                console.error("Error parsing facultyList setting:", e);
            }
        }

        // If no explicit list exists, fallback to admins
        if (faculty.length === 0) {
            const admins = await localDb.all('SELECT displayName as name, "Administrator" as position FROM admin_users');
            faculty = admins.map(a => ({
                name: a.name || 'Administrator',
                position: a.position || 'Admin',
                photoURL: null
            }));
        }

        res.json(faculty);
    } catch (error) {
        console.error('Error fetching faculty list:', error);
        res.status(500).json({ error: 'Failed to fetch faculty list' });
    }
});

// POST add authorized staff
app.post('/api/settings/staff', async (req, res) => {
    try {
        const { email, staffEmail } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });
        await localDb.run('INSERT OR IGNORE INTO authorized_staff (email) VALUES (?)', [email.toLowerCase().trim()]);
        await writeAudit(staffEmail, 'staff_added', { email });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to add staff' });
    }
});

// DELETE authorized staff
app.delete('/api/settings/staff/:email', async (req, res) => {
    try {
        const { email } = req.params;
        const { staffEmail } = req.body;
        await localDb.run('DELETE FROM authorized_staff WHERE email = ?', [decodeURIComponent(email)]);
        await writeAudit(staffEmail, 'staff_removed', { email });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to remove staff' });
    }
});

// GET audit log
app.get('/api/settings/audit', async (req, res) => {
    try {
        const rows = await localDb.all('SELECT * FROM audit_log ORDER BY createdAt DESC LIMIT 100');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch audit log' });
    }
});

// POST database maintenance: clear synced logs
app.post('/api/db-maintenance', async (req, res) => {
    try {
        const { staffEmail } = req.body;
        const result = await localDb.run('DELETE FROM logs WHERE synced = 1');
        await writeAudit(staffEmail, 'db_maintenance', { deletedLogs: result.changes });
        console.log(`🗑️ DB Maintenance: Cleared ${result.changes} synced log(s).`);
        res.json({ success: true, deleted: result.changes });
    } catch (error) {
        res.status(500).json({ error: 'Failed to perform maintenance' });
    }
});

// Auto-checkout scheduler: runs every minute, checks the configured time
let autoCheckoutTimer = null;
async function scheduleAutoCheckout() {
    if (autoCheckoutTimer) clearInterval(autoCheckoutTimer);
    autoCheckoutTimer = setInterval(async () => {
        try {
            const row = await localDb.get("SELECT value FROM settings WHERE key = 'autoCheckoutTime'");
            if (!row || !row.value) return;
            const checkoutTime = row.value; // e.g. "17:00"
            const now = new Date();
            const [hh, mm] = checkoutTime.split(':').map(Number);
            if (now.getHours() === hh && now.getMinutes() === mm) {
                const timeOut = now.toISOString();
                const result = await localDb.run(
                    "UPDATE logs SET timeOut = ?, synced = 0 WHERE timeOut IS NULL",
                    [timeOut]
                );
                if (result.changes > 0) {
                    console.log(`⏰ Auto-checkout: Closed ${result.changes} active session(s) at ${checkoutTime}`);
                    syncToCloud();
                }
            }
        } catch (e) { /* skip */ }
    }, 60000);
}

// ============================================================
// END SETTINGS API ROUTES
// ============================================================

// Sync Logic: Pushes unsynced logs to Firebase
let isSyncingLogs = false;
async function syncToCloud() {
    if (isSyncingLogs || !firebaseInitialized) return;
    isSyncingLogs = true;
    lastSyncAttempt = new Date().toISOString();
    try {
        const unsynced = await localDb.all('SELECT * FROM logs WHERE synced = 0');
        if (unsynced.length === 0) {
            markCloudReachable(); // Connection is fine even if nothing to sync
            return;
        }

        console.log(`🔄 Syncing ${unsynced.length} log(s) to cloud...`);

        for (const log of unsynced) {
            try {
                const officeId = log.officeId || 'engineering-office';
                const firebaseLogData = { ...log };
                delete firebaseLogData.synced;
                delete firebaseLogData.id;

                // Convert ISO strings back to Firebase Timestamps for consistency
                if (firebaseLogData.timeIn) firebaseLogData.timeIn = admin.firestore.Timestamp.fromDate(new Date(firebaseLogData.timeIn));
                if (firebaseLogData.timeOut) firebaseLogData.timeOut = admin.firestore.Timestamp.fromDate(new Date(firebaseLogData.timeOut));

                if (firebaseLogData.serviceStartTime) firebaseLogData.serviceStartTime = admin.firestore.Timestamp.fromDate(new Date(firebaseLogData.serviceStartTime));

                if (log.id.startsWith('local_')) {
                    // New log
                    const docRef = await db.collection('offices').doc(officeId).collection('logs').add({
                        ...firebaseLogData,
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    // Update local ID and mark as synced
                    await localDb.run('UPDATE logs SET synced = 1, id = ? WHERE id = ?', [docRef.id, log.id]);
                } else {
                    // Update existing log (e.g. time-out, status change)
                    await db.collection('offices').doc(officeId).collection('logs').doc(log.id).update(firebaseLogData);
                    await localDb.run('UPDATE logs SET synced = 1 WHERE id = ?', [log.id]);
                }
                markCloudReachable();
            } catch (syncError) {
                markCloudUnreachable(syncError.message);
                break; // Stop loop — remaining records stay queued with synced=0
            }
        }
    } catch (error) {
        markCloudUnreachable(error.message);
        console.error('❌ Sync error:', error.message);
    } finally {
        isSyncingLogs = false;
    }
}

// ============================================================
// OFFLINE AUTH ENDPOINTS
// ============================================================

// Helpers for PBKDF2 credential caching
function hashPassword(password, salt) {
    return crypto.pbkdf2Sync(password, salt, 100_000, 64, 'sha512').toString('hex');
}

// POST /api/auth/cache-session
// Called by the client after a successful Firebase Auth SDK login to store
// hashed credentials so offline logins work on subsequent visits.
app.post('/api/auth/cache-session', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });

        const salt = crypto.randomBytes(32).toString('hex');
        const hash = hashPassword(password, salt);

        await localDb.run(
            'INSERT OR REPLACE INTO cached_auth (email, hash, salt, cachedAt) VALUES (?, ?, ?, CURRENT_TIMESTAMP)',
            [email.toLowerCase().trim(), hash, salt]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Error caching auth credentials:', error);
        res.status(500).json({ error: 'Failed to cache credentials' });
    }
});

// POST /api/auth/login  — LOCAL-FIRST
// Priority:
//   1. admin_users table (local SQLite admin accounts — works 100% offline)
//   2. cached_auth table (Firebase staff with cached offline credentials)
//   3. Online only: tell client to use Firebase SDK for first-time Firebase staff login
// On success, a server-side session is created.
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password required' });

        const normalizedEmail = email.toLowerCase().trim();

        // 1. Check local admin_users table first (no Firebase dependency, works offline)
        const adminUser = await localDb.get(
            'SELECT hash, salt, displayName, role FROM admin_users WHERE email = ?',
            normalizedEmail
        );
        if (adminUser) {
            const inputHash = hashPassword(password, adminUser.salt);
            if (inputHash === adminUser.hash) {
                req.session.user = {
                    email: normalizedEmail,
                    displayName: adminUser.displayName,
                    role: adminUser.role,
                    isAdmin: true,
                    offlineMode: !cloudReachable
                };
                console.log(`🔓 Admin auth success for ${normalizedEmail} (role=${adminUser.role})`);
                return res.json({
                    success: true,
                    email: normalizedEmail,
                    displayName: adminUser.displayName,
                    role: adminUser.role,
                    isAdmin: true,
                    offlineMode: !cloudReachable
                });
            }
            // Email matched an admin account but password is wrong — stop here
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        // 2. Check locally-cached PBKDF2 hash for Firebase staff (works 100% offline)
        const cached = await localDb.get('SELECT hash, salt FROM cached_auth WHERE email = ?', normalizedEmail);
        if (cached) {
            const inputHash = hashPassword(password, cached.salt);
            if (inputHash === cached.hash) {
                req.session.user = { email: normalizedEmail, offlineMode: !cloudReachable };
                console.log(`🔓 Cached-staff auth success for ${normalizedEmail} (offlineMode=${!cloudReachable})`);
                return res.json({ success: true, email: normalizedEmail, offlineMode: !cloudReachable });
            }
            return res.status(401).json({ error: 'Incorrect password.' });
        }

        // 3. No local record — if online, tell client to use Firebase SDK
        //    (Firebase Admin cannot verify passwords; the client SDK must do it)
        if (firebaseInitialized && cloudReachable) {
            return res.json({ success: false, needsFirebaseAuth: true });
        }

        // 4. Offline and no local credentials — cannot authenticate
        return res.status(401).json({
            error: 'No offline credentials found. Please log in while connected to the internet first.'
        });
    } catch (error) {
        console.error('Error in auth login:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
});

// POST /api/auth/firebase-login
// Called by the client AFTER Firebase Auth SDK successfully verifies credentials.
// We optionally verify the ID token server-side, then create a server session.
app.post('/api/auth/firebase-login', async (req, res) => {
    try {
        const { email, idToken } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });

        const normalizedEmail = email.toLowerCase().trim();

        // Verify the Firebase ID token if Admin SDK is available
        if (firebaseInitialized && idToken) {
            try {
                const decoded = await admin.auth().verifyIdToken(idToken);
                if (decoded.email.toLowerCase() !== normalizedEmail) {
                    return res.status(401).json({ error: 'Token/email mismatch.' });
                }
                markCloudReachable();
            } catch (tokenErr) {
                console.warn('⚠️  ID token verification failed:', tokenErr.message);
                return res.status(401).json({ error: 'Invalid Firebase token.' });
            }
        }

        // Create server session
        req.session.user = { email: normalizedEmail, offlineMode: false };
        console.log(`✅ Firebase-authenticated session created for ${normalizedEmail}`);
        res.json({ success: true, email: normalizedEmail });
    } catch (error) {
        console.error('Error in firebase-login:', error);
        res.status(500).json({ error: 'Session creation failed' });
    }
});

// GET /api/auth/session — check if the caller has an active server session
app.get('/api/auth/session', (req, res) => {
    if (req.session && req.session.user) {
        return res.json({ authenticated: true, user: req.session.user });
    }
    res.json({ authenticated: false });
});

// POST /api/auth/logout — destroy the server session
app.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Session destroy error:', err);
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

// ============================================================
// ADMIN ACCOUNT MANAGEMENT (local SQLite — no Firebase Auth)
// All endpoints require an active session.
// ============================================================

// Middleware: require an authenticated admin session
function requireAdmin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Authentication required.' });
    }
    next();
}

// GET /api/auth/admins — list all admin accounts (passwords excluded)
app.get('/api/auth/admins', requireAdmin, async (req, res) => {
    try {
        const admins = await localDb.all(
            'SELECT id, email, displayName, role, createdAt, updatedAt FROM admin_users ORDER BY createdAt ASC'
        );
        res.json(admins);
    } catch (error) {
        console.error('Error fetching admins:', error);
        res.status(500).json({ error: 'Failed to fetch admin accounts' });
    }
});

// POST /api/auth/admins — create a new admin account
app.post('/api/auth/admins', requireAdmin, async (req, res) => {
    try {
        const { email, password, displayName, role } = req.body;
        if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
        if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

        const salt = crypto.randomBytes(32).toString('hex');
        const hash = hashPassword(password, salt);
        const normalizedEmail = email.toLowerCase().trim();

        await localDb.run(
            'INSERT INTO admin_users (email, hash, salt, displayName, role) VALUES (?, ?, ?, ?, ?)',
            [normalizedEmail, hash, salt, displayName || 'Administrator', role || 'admin']
        );

        await writeAudit(req.session.user.email, 'admin_created', { email: normalizedEmail, role: role || 'admin' });
        console.log(`✅ Admin account created: ${normalizedEmail} by ${req.session.user.email}`);
        res.json({ success: true, email: normalizedEmail });
    } catch (error) {
        if (error.message && error.message.includes('UNIQUE constraint')) {
            return res.status(409).json({ error: 'An admin account with that email already exists' });
        }
        console.error('Error creating admin:', error);
        res.status(500).json({ error: 'Failed to create admin account' });
    }
});

// PUT /api/auth/admins/:email — update display name, role, or password
app.put('/api/auth/admins/:email', requireAdmin, async (req, res) => {
    try {
        const targetEmail = decodeURIComponent(req.params.email).toLowerCase().trim();
        const { password, displayName, role } = req.body;

        const existing = await localDb.get('SELECT id FROM admin_users WHERE email = ?', targetEmail);
        if (!existing) return res.status(404).json({ error: 'Admin account not found' });

        if (password) {
            if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
            const salt = crypto.randomBytes(32).toString('hex');
            const hash = hashPassword(password, salt);
            await localDb.run(
                'UPDATE admin_users SET hash = ?, salt = ?, updatedAt = CURRENT_TIMESTAMP WHERE email = ?',
                [hash, salt, targetEmail]
            );
        }

        if (displayName) {
            await localDb.run(
                'UPDATE admin_users SET displayName = ?, updatedAt = CURRENT_TIMESTAMP WHERE email = ?',
                [displayName, targetEmail]
            );
        }

        if (role) {
            await localDb.run(
                'UPDATE admin_users SET role = ?, updatedAt = CURRENT_TIMESTAMP WHERE email = ?',
                [role, targetEmail]
            );
        }

        await writeAudit(req.session.user.email, 'admin_updated', { email: targetEmail, changed: Object.keys(req.body) });
        console.log(`✅ Admin account updated: ${targetEmail} by ${req.session.user.email}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error updating admin:', error);
        res.status(500).json({ error: 'Failed to update admin account' });
    }
});

// DELETE /api/auth/admins/:email — remove an admin account (cannot delete the last one)
app.delete('/api/auth/admins/:email', requireAdmin, async (req, res) => {
    try {
        const targetEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

        // Prevent deleting yourself
        if (targetEmail === req.session.user.email) {
            return res.status(400).json({ error: 'You cannot delete your own account while logged in' });
        }

        // Prevent deleting the last admin
        const count = await localDb.get('SELECT COUNT(*) AS count FROM admin_users');
        if (count.count <= 1) {
            return res.status(400).json({ error: 'Cannot delete the last admin account' });
        }

        const result = await localDb.run('DELETE FROM admin_users WHERE email = ?', targetEmail);
        if (result.changes === 0) return res.status(404).json({ error: 'Admin account not found' });

        await writeAudit(req.session.user.email, 'admin_deleted', { email: targetEmail });
        console.log(`🗑️ Admin account deleted: ${targetEmail} by ${req.session.user.email}`);
        res.json({ success: true });
    } catch (error) {
        console.error('Error deleting admin:', error);
        res.status(500).json({ error: 'Failed to delete admin account' });
    }
});

// ============================================================
// END ADMIN ACCOUNT MANAGEMENT
// ============================================================

// ============================================================
// END OFFLINE AUTH
// ============================================================

// Manual sync trigger (useful for admin dashboards or instant testing)
app.post('/api/sync-now', async (req, res) => {
    if (!firebaseInitialized) {
        return res.status(503).json({ error: 'Sync unavailable in offline mode' });
    }
    try {
        console.log('⚡ Manual sync triggered by user.');
        await syncToCloud();
        await syncStudentsToCloud();
        await pullLogsFromCloud();
        await pullStudentsFromCloud();
        res.json({ success: true, message: 'Sync complete', cloudReachable });
    } catch (error) {
        console.error('Error during manual sync:', error);
        res.status(500).json({ error: 'Manual sync failed' });
    }
});

// Sync status — lets the UI know if it is operating in offline mode
app.get('/api/sync-status', async (req, res) => {
    try {
        const [pendingLogs, pendingStudents] = await Promise.all([
            localDb.get('SELECT COUNT(*) AS count FROM logs WHERE synced = 0'),
            localDb.get('SELECT COUNT(*) AS count FROM students WHERE synced = 0')
        ]);
        res.json({
            firebaseInitialized,
            cloudReachable,
            pendingLogs: pendingLogs.count,
            pendingStudents: pendingStudents.count,
            lastSyncAttempt,
            retryDelay: cloudReachable ? BASE_SYNC_INTERVAL_MS : getSyncRetryDelay()
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get sync status' });
    }
});

// Adaptive sync heartbeat — backs off when cloud is unreachable
// instead of hammering Firebase with guaranteed-to-fail requests.
function scheduleSyncHeartbeat() {
    const delay = cloudReachable ? BASE_SYNC_INTERVAL_MS : getSyncRetryDelay();
    setTimeout(async () => {
        await syncToCloud();           // push unsynced logs → cloud
        await syncStudentsToCloud();   // push unsynced students → cloud
        await pullLogsFromCloud();     // pull new cloud logs → local
        await pullStudentsFromCloud(); // pull new cloud students → local
        scheduleSyncHeartbeat();       // reschedule with updated delay
    }, delay);
}

// Sync Students: Pushes unsynced student data to Firebase
let isSyncingStudents = false;
async function syncStudentsToCloud() {
    if (isSyncingStudents || !firebaseInitialized) return;
    isSyncingStudents = true;
    try {
        const unsynced = await localDb.all('SELECT * FROM students WHERE synced = 0');
        if (unsynced.length === 0) return;

        console.log(`🔄 Syncing ${unsynced.length} student record(s) to cloud...`);

        for (const student of unsynced) {
            try {
                await db.collection('students').doc(student.barcode).set({
                    name: student.name,
                    studentId: student.studentId,
                    Course: student.course,
                    'Year Level': student.yearLevel,
                    updatedAt: admin.firestore.FieldValue.serverTimestamp()
                }, { merge: true });

                await localDb.run('UPDATE students SET synced = 1 WHERE barcode = ?', student.barcode);
                markCloudReachable();
            } catch (err) {
                markCloudUnreachable(err.message);
                break; // Remaining records stay queued with synced=0
            }
        }
    } catch (error) {
        markCloudUnreachable(error.message);
        console.error('❌ Student sync error:', error.message);
    } finally {
        isSyncingStudents = false;
    }
}

// Proactive Sync: Pulls logs from Firestore into local SQLite.
// Incremental mode (heartbeat): only fetches logs newer than the newest local createdAt.
// Full mode (startup): fetches ALL logs and also updates timeOut on already-cached records.
async function pullLogsFromCloud({ full = false } = {}) {
    if (!firebaseInitialized) return;
    try {
        const officeRow = await localDb.get("SELECT value FROM settings WHERE key = 'officeId'");
        const officeId = officeRow ? officeRow.value : 'engineering-office';

        let query = db.collection('offices').doc(officeId).collection('logs')
            .orderBy('createdAt', 'asc');

        if (!full) {
            // Incremental: only records newer than what we already have
            const latest = await localDb.get(
                "SELECT MAX(createdAt) AS ts FROM logs WHERE synced = 1"
            );
            if (latest && latest.ts) {
                query = query.where('createdAt', '>', admin.firestore.Timestamp.fromDate(new Date(latest.ts)));
            }
            query = query.limit(200);
        } else {
            query = query.limit(2000); // Higher cap for full startup sync
        }

        const snapshot = await query.get();
        if (snapshot.empty) {
            if (full) console.log('☁️  No cloud logs to pull.');
            return;
        }

        if (full) console.log(`☁️  Full log pull: processing ${snapshot.size} cloud log(s)...`);
        else console.log(`☁️  Pulling ${snapshot.size} new log(s) from cloud...`);

        let inserted = 0, updated = 0;

        for (const doc of snapshot.docs) {
            const d = doc.data();

            // Convert Firestore Timestamps to ISO strings
            const timeIn = d.timeIn ? (d.timeIn.toDate ? d.timeIn.toDate().toISOString() : d.timeIn) : null;
            const timeOut = d.timeOut ? (d.timeOut.toDate ? d.timeOut.toDate().toISOString() : d.timeOut) : null;
            const createdAt = d.createdAt ? (d.createdAt.toDate ? d.createdAt.toDate().toISOString() : d.createdAt) : null;

            const existing = await localDb.get('SELECT id, synced, timeOut FROM logs WHERE id = ?', doc.id);

            if (existing) {
                // Only update timeOut if: the local record is already synced (cloud is source
                // of truth) AND the cloud has a timeOut the local record lacks.
                if (existing.synced === 1 && !existing.timeOut && timeOut) {
                    await localDb.run(
                        'UPDATE logs SET timeOut = ? WHERE id = ?',
                        [timeOut, doc.id]
                    );
                    updated++;
                }
            } else {
                // New record — insert it
                await localDb.run(
                    `INSERT INTO logs
                     (id, studentNumber, studentName, studentId, activity, staff, yearLevel, course,
                      date, timeIn, timeOut, staffEmail, officeId, synced, createdAt)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
                    [
                        doc.id,
                        d.studentNumber, d.studentName, d.studentId,
                        d.activity, d.staff || null,
                        d.yearLevel, d.course, d.date,
                        timeIn, timeOut,
                        d.staffEmail, officeId,
                        createdAt
                    ]
                );
                inserted++;
            }
        }

        if (inserted > 0 || updated > 0) {
            console.log(`✅ Logs synced from cloud — ${inserted} new, ${updated} updated (timeOut).`);
            markCloudReachable();
        }
    } catch (error) {
        markCloudUnreachable(error.message);
        console.warn('⏳ Log pull deferred (cloud unreachable):', error.message);
    }
}

// Proactive Sync: Pulls ALL students from cloud into local SQLite
// ⚠️ Skips students with synced=0 (pending local edits) to prevent data loss
async function pullStudentsFromCloud() {
    if (!firebaseInitialized) return;
    try {
        console.log('🔄 Proactive Sync: Fetching student directory from cloud...');
        const snapshot = await db.collection('students').get();

        console.log(`📦 Found ${snapshot.size} students in cloud. Updating local cache...`);

        // Get all locally-pending barcodes so we don't overwrite them
        const pendingRows = await localDb.all('SELECT barcode FROM students WHERE synced = 0');
        const pendingBarcodes = new Set(pendingRows.map(r => r.barcode));
        if (pendingBarcodes.size > 0) {
            console.log(`⏭️ Skipping ${pendingBarcodes.size} pending local edit(s) during pull.`);
        }

        const cloudBarcodes = new Set();
        for (const doc of snapshot.docs) {
            cloudBarcodes.add(doc.id);

            // Don't overwrite records that have unsynced local edits
            if (pendingBarcodes.has(doc.id)) continue;

            const data = doc.data();
            await localDb.run(
                'INSERT OR REPLACE INTO students (barcode, name, studentId, course, yearLevel, synced) VALUES (?, ?, ?, ?, ?, 1)',
                [doc.id, data.name, data.studentId, data.Course, data["Year Level"]]
            );
        }

        // Clean up deleted students (Only delete local students that were already synced but are now missing from the cloud)
        const localSyncedStudents = await localDb.all('SELECT barcode FROM students WHERE synced = 1');
        let deletedCount = 0;
        for (const localStudent of localSyncedStudents) {
            if (!cloudBarcodes.has(localStudent.barcode)) {
                await localDb.run('DELETE FROM students WHERE barcode = ?', [localStudent.barcode]);
                deletedCount++;
            }
        }

        if (deletedCount > 0) {
            console.log(`🗑️ Removed ${deletedCount} deleted student(s) from local cache.`);
        }

        console.log('✅ Local student directory is now up to date.');
    } catch (error) {
        console.warn('⏳ Proactive sync deferred (likely offline):', error.message);
    }
}

// ============================================================
// STARTUP SYNC — Firebase → Local SQLite reconciliation
//
// DATA FLOW:
//   Firebase (Firestore) is the cloud source of truth for students
//   and logs. Local SQLite is the operational database that serves
//   all API requests. The sync direction is primarily:
//
//       Firebase ──────────────────→ Local SQLite
//       (cloud, authoritative)        (local, serves all reads/writes)
//
// Admin accounts are stored ONLY in local SQLite (admin_users table)
// and are NEVER synced to Firebase.
//
// Startup sequence:
//   1. Push locally-pending edits (synced=0) → cloud first so that
//      offline edits are not overwritten by the subsequent pull.
//   2. Pull full student directory cloud → local (replace).
//   3. Pull all logs cloud → local (full, with timeOut updates).
// ============================================================
async function startupSync() {
    if (!firebaseInitialized) {
        console.log('🔌 Firebase not configured — skipping startup sync (offline-only mode).');
        return;
    }
    console.log('🔄 Starting bidirectional startup sync...');
    try {
        // Step 1: Push any locally-pending changes first
        await syncStudentsToCloud();
        await syncToCloud();

        // Step 2: Pull the full student directory from cloud → local
        await pullStudentsFromCloud();

        // Step 3: Full log pull — inserts new records AND updates timeOut on existing ones
        await pullLogsFromCloud({ full: true });

        console.log('✅ Startup sync complete. Databases are in sync.');
    } catch (err) {
        console.warn('⏳ Startup sync partially failed (running in degraded mode):', err.message);
    }
}

// Initialize and start server
initializeLocalDb().then(() => {
    app.listen(PORT, () => {
        console.log(`🚀 Server running on http://localhost:${PORT}`);

        // Non-blocking background tasks
        // ⚠️ Order matters: push pending local changes FIRST, then pull from cloud
        // This prevents pending edits from being overwritten on restart
        initializeAdmin();

        // Full bidirectional sync on every startup, then periodic heartbeat
        startupSync().catch(err => console.warn('⏳ Startup sync error:', err.message));
        scheduleSyncHeartbeat();
        scheduleAutoCheckout();
    });
}).catch(err => {
    console.error('❌ Critical failure initializing local database:', err);
    process.exit(1);
});
