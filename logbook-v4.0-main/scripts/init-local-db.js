/**
 * init-local-db.js
 * Standalone script to create / migrate local.db so its schema
 * matches the shape of the remote Firestore collections:
 *
 *   Firestore                      │  local.db (SQLite)
 *   ─────────────────────────────  │  ──────────────────────────────────
 *   students/{barcode}             │  students  (barcode PK)
 *     name, studentId,             │    name, studentId,
 *     Course, Year Level,          │    course, yearLevel,   ← normalised
 *     updatedAt                    │    synced, updatedAt
 *                                  │
 *   offices/{officeId}/logs/{id}   │  logs  (id PK)
 *     studentNumber, studentName,  │    studentNumber, studentName,
 *     studentId, activity, staff,  │    studentId, activity, staff,
 *     yearLevel, course, date,     │    yearLevel, course, date,
 *     timeIn, timeOut, staffEmail, │    timeIn, timeOut, staffEmail,
 *     createdAt                    │    officeId,   ← path component
 *                                  │    synced, createdAt
 *
 * Additional local-only tables (no Firestore equivalent):
 *   settings, authorized_staff, audit_log, cached_auth
 */

'use strict';

const path    = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const DB_PATH = path.join(__dirname, '..', 'local.db');

async function run() {
    console.log(`📂 Opening (or creating) database at: ${DB_PATH}`);

    const db = await open({ filename: DB_PATH, driver: sqlite3.Database });

    /* ── Performance PRAGMAs ─────────────────────────────────────── */
    await db.exec('PRAGMA journal_mode = WAL');
    await db.exec('PRAGMA synchronous = NORMAL');
    await db.exec('PRAGMA mmap_size = 30000000000');
    await db.exec('PRAGMA cache_size = -2000');
    await db.exec('PRAGMA temp_store = MEMORY');

    /* ── students ────────────────────────────────────────────────── */
    // Mirrors: Firestore students/{barcode}
    //   name, studentId, Course → course, Year Level → yearLevel, updatedAt
    await db.exec(`
        CREATE TABLE IF NOT EXISTS students (
            barcode     TEXT PRIMARY KEY,
            name        TEXT,
            studentId   TEXT,
            course      TEXT,
            yearLevel   TEXT,
            synced      INTEGER  DEFAULT 0,
            updatedAt   DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── logs ────────────────────────────────────────────────────── */
    // Mirrors: Firestore offices/{officeId}/logs/{id}
    //   officeId is the parent document path component stored as a column.
    await db.exec(`
        CREATE TABLE IF NOT EXISTS logs (
            id            TEXT PRIMARY KEY,
            studentNumber TEXT,
            studentName   TEXT,
            studentId     TEXT,
            activity      TEXT,
            staff         TEXT,
            yearLevel     TEXT,
            course        TEXT,
            date          TEXT,
            timeIn        TEXT,
            timeOut       TEXT,
            staffEmail    TEXT,
            officeId      TEXT,
            synced        INTEGER  DEFAULT 0,
            createdAt     DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── settings ────────────────────────────────────────────────── */
    // Key-value store for all system settings (local-only, no Firestore mirror)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS settings (
            key       TEXT PRIMARY KEY,
            value     TEXT,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── authorized_staff ────────────────────────────────────────── */
    // Staff email whitelist (local-only)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS authorized_staff (
            email   TEXT PRIMARY KEY,
            addedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── audit_log ───────────────────────────────────────────────── */
    // Tracks who changed what in settings (local-only)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            staffEmail TEXT,
            action     TEXT,
            details    TEXT,
            createdAt  DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── cached_auth ─────────────────────────────────────────────── */
    // PBKDF2-hashed offline credential cache (local-only)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS cached_auth (
            email    TEXT PRIMARY KEY,
            hash     TEXT NOT NULL,
            salt     TEXT NOT NULL,
            cachedAt DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    /* ── Migrations for existing databases ───────────────────────── */
    // Safe ALTER TABLE additions — silently ignored if columns already exist.
    const migrations = [
        'ALTER TABLE logs     ADD COLUMN staff    TEXT',
        'ALTER TABLE students ADD COLUMN synced   INTEGER DEFAULT 1',
    ];
    for (const sql of migrations) {
        try { await db.exec(sql); } catch (_) { /* column already exists */ }
    }

    /* ── Indexes ─────────────────────────────────────────────────── */
    await db.exec('CREATE INDEX IF NOT EXISTS idx_students_barcode        ON students(barcode)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_logs_student_office     ON logs(studentNumber, officeId)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_logs_synced             ON logs(synced)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_logs_created_synced     ON logs(createdAt, synced)');

    /* ── Default settings ────────────────────────────────────────── */
    const defaults = {
        officeName:            'Engineering Office',
        officeId:              'engineering-office',
        schoolName:            'Your School Name',
        activities:            JSON.stringify(['Enrollment', 'Inquiries', 'Document Request', 'Consultation', 'Others']),
        yearLevelEnabled:      'true',
        yearLevelRequired:     'true',
        courseRequired:        'true',
        autoSubmit:            'false',
        audioFeedback:         'true',
        appearanceMode:        'light',
        autoCheckoutTime:      '',
        sessionTimeoutMinutes: '0',
    };

    for (const [key, value] of Object.entries(defaults)) {
        await db.run(
            'INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)',
            [key, value]
        );
    }

    await db.close();
    console.log('✅ local.db schema is up to date and matches the remote Firestore schema.');
}

run().catch(err => {
    console.error('❌ Failed to initialise local.db:', err);
    process.exit(1);
});
