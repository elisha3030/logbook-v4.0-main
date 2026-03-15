# 🖥️ Local PC Deployment Guide

This guide walks you through deploying the **Logbook System** on a local Windows PC from scratch. The system supports both a **full Firebase-connected mode** and a **standalone offline-only mode**.

---

## 📋 Prerequisites

| Requirement | Version | Download |
|---|---|---|
| Node.js | v18.x or higher (LTS) | https://nodejs.org |
| npm | Included with Node.js | — |
| Git *(optional)* | Latest | https://git-scm.com |
| A Firebase Project | — | https://console.firebase.google.com |

Verify your installation:
```bash
node -v
npm -v
```

---

## 🚀 Quick Start (Windows)

A one-click setup script is included. **Run it once** after downloading the project:

1. Open the project folder in File Explorer.
2. Double-click **`setup.bat`**.
3. Follow the on-screen prompts.
4. Once done, open your browser and go to **http://localhost:3000**.

> If you prefer manual setup, continue reading below.

---

## 🔧 Manual Setup — Step by Step

### Step 1 — Get the Project Files

**Option A: Clone with Git**
```bash
git clone <repository-url>
cd logbook-system
```

**Option B: Download ZIP**
1. Download and extract the ZIP archive.
2. Open a terminal (`cmd` or PowerShell) inside the extracted folder.

---

### Step 2 — Install Dependencies

```bash
npm install
```

This installs all Node.js packages listed in `package.json` into a local `node_modules/` folder.

---

### Step 3 — Configure Environment Variables

1. Copy the example file:
   ```bash
   copy .env.example .env
   ```
   *(On macOS/Linux use `cp .env.example .env`)*

2. Open `.env` in a text editor (Notepad, VS Code, etc.) and fill in your values.

#### .env Fields Explained

| Variable | Required | Description |
|---|---|---|
| `PORT` | No | Port the server listens on. Default: `3000` |
| `SESSION_SECRET` | **Yes** | Long random string for secure session cookies |
| `FIREBASE_SERVICE_ACCOUNT_PATH` | For cloud mode | Path to your Firebase service account JSON file |
| `FIREBASE_API_KEY` | For cloud mode | Firebase Web SDK API key |
| `FIREBASE_AUTH_DOMAIN` | For cloud mode | Firebase Auth domain |
| `FIREBASE_PROJECT_ID` | For cloud mode | Firebase project ID |
| `FIREBASE_STORAGE_BUCKET` | For cloud mode | Firebase Storage bucket |
| `FIREBASE_MESSAGING_SENDER_ID` | For cloud mode | Firebase Messaging sender ID |
| `FIREBASE_APP_ID` | For cloud mode | Firebase App ID |
| `FIREBASE_MEASUREMENT_ID` | No | Firebase Analytics (can be omitted) |

**To generate a secure `SESSION_SECRET`:**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

### Step 4 — Firebase Setup *(Skip for Offline-Only Mode)*

#### 4a. Create a Firebase Project
1. Go to https://console.firebase.google.com and click **Add Project**.
2. Enable **Google Analytics** (optional).

#### 4b. Enable Authentication
1. In the Firebase Console → **Authentication** → **Sign-in method**.
2. Enable **Email/Password**.

#### 4c. Enable Firestore
1. In the Firebase Console → **Firestore Database** → **Create Database**.
2. Choose **Production mode** and select a region close to your location.

#### 4d. Get the Service Account Key (Admin SDK)
1. Go to **Project Settings** (gear icon) → **Service accounts**.
2. Click **Generate new private key** → **Generate Key**.
3. Rename the downloaded file to `firebase-key.json`.
4. Place it in the `config/` folder:
   ```
   config/
   └── firebase-key.json   ← here
   ```

#### 4e. Get the Web App Config (Client SDK)
1. Go to **Project Settings** → **Your apps** → click **</>** (Web app).
2. Register the app, then copy the `firebaseConfig` object values.
3. Paste each value into your `.env` file.

---

### Step 5 — Initialize the Local Database

Run the database setup script to create the SQLite database with the correct schema:

```bash
npm run init-db
```

> This creates `local.db` in the project root. You only need to run this **once**. It is safe to re-run — it will not overwrite existing data.

---

### Step 6 — Start the Server

```bash
npm start
```

You should see output like:
```
--- SERVER STARTING ---
✅ Firebase Admin initialized successfully.
✅ Local database initialized.
🚀 Server running on http://localhost:3000
```

Open **http://localhost:3000** in your browser.

---

### Step 7 — (Optional) Auto-Start the App at Windows Login

The `autostart/` folder contains scripts that eliminate the need to manually open a terminal each time.

#### Quick launch (manual, any time)
Double-click **`autostart\start-logbook.bat`**. It will:
1. Start the Node.js server in a minimised window.
2. Wait 4 seconds for the server to boot.
3. Open `http://localhost:3000` in your default browser.

#### Register a scheduled task (runs automatically at login)

1. Right-click **`autostart\install-task.ps1`** → **Run with PowerShell** *(or run as Administrator)*.
2. The script registers a Windows Task Scheduler job named `LogbookSystem` that fires `start-logbook.bat` every time you log in.
3. You will be asked whether to launch the app immediately.

> **Tip:** If PowerShell blocks the script with an execution-policy error, run this once in an Administrator PowerShell:
> ```powershell
> Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
> ```

#### Autostart script reference

| File | Description |
|---|---|
| `autostart/start-logbook.bat` | Batch launcher — starts server & opens browser. Safe to double-click. |
| `autostart/start-logbook.ps1` | PowerShell launcher — polls the server until ready before opening the browser. |
| `autostart/install-task.ps1` | Registers the `LogbookSystem` scheduled task (run once, as Administrator). |
| `autostart/uninstall-task.ps1` | Removes the `LogbookSystem` scheduled task (as Administrator). |

---

### Step 8 — Create the First Admin User *(Firebase mode only)*

If this is a fresh Firebase project, create the initial admin account:

```bash
npm run debug:admin
```

This creates a `admin@email.com` / `admin123` account in Firebase Authentication. **Change the password immediately** after first login.

---

## 🔌 Offline-Only Mode (No Firebase)

The system works **fully offline** without any Firebase configuration. In this mode:
- All data is stored in the local SQLite database (`local.db`).
- No cloud sync occurs.
- To use this mode, simply leave all `FIREBASE_*` variables empty or remove them from `.env`.

When the server starts you will see:
```
⚠️ FIREBASE_SERVICE_ACCOUNT_PATH not defined in .env.
🚀 Running in OFFLINE-ONLY mode. Cloud sync disabled.
```

This is normal and expected for offline deployments.

---

## 🗂️ Project File Reference

```
logbook-system/
├── server.js               # Main Express server & all API routes
├── .env                    # Your private environment config (DO NOT SHARE)
├── .env.example            # Safe template — commit this instead of .env
├── local.db                # SQLite database (auto-created on first run)
├── package.json            # Dependencies and npm scripts
├── setup.bat               # Windows one-click setup script
├── autostart/              # Windows auto-launch scripts
│   ├── start-logbook.bat   # Double-click launcher (starts server + opens browser)
│   ├── start-logbook.ps1   # PowerShell launcher with server-ready polling
│   ├── install-task.ps1    # Registers a Task Scheduler job to auto-start at login
│   └── uninstall-task.ps1  # Removes the scheduled task
├── config/
│   └── firebase-key.json   # Firebase Service Account key (DO NOT SHARE)
├── docs/
│   ├── DEPLOYMENT.md       # This guide
│   └── SETTINGS_SUGGESTIONS.md
├── scripts/
│   ├── init-local-db.js    # Creates / migrates local.db schema
│   ├── debug-admin.js      # Creates default admin Firebase user
│   ├── test-load.js        # Dependency load test
│   └── verify.js           # Server health check
└── public/                 # Frontend (HTML, CSS, JS)
```

---

## 📜 Available npm Scripts

| Command | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run init-db` | Initialize / migrate the local SQLite database |
| `npm run debug:admin` | Create or verify the default admin Firebase user |
| `npm run verify` | Run a server health check |
| `npm run test:load` | Test that all modules load correctly |

---

## 🛠️ Troubleshooting

### ❌ `Cannot find module '...'`
Run `npm install` to restore missing dependencies.

### ❌ `EADDRINUSE: address already in use :::3000`
Another process is using port 3000. Either:
- Stop the other process, or
- Change `PORT=3001` (or any free port) in your `.env` file.

### ❌ Firebase `auth/invalid-credential` on login
- Double-check that `FIREBASE_API_KEY` and other Web SDK values in `.env` match your Firebase Console exactly.
- Confirm Email/Password authentication is enabled in Firebase.

### ❌ `Service account file not found`
- Verify `config/firebase-key.json` exists and the path in `.env` (`FIREBASE_SERVICE_ACCOUNT_PATH`) is correct.

### ❌ `local.db` schema errors / missing columns
Run `npm run init-db` to apply any pending schema migrations.

### ❌ Server starts but browser shows a blank/error page
- Make sure you are visiting **http://localhost:3000** (not https).
- Check the terminal for error messages.

---

## 🔒 Security Checklist (Before Going Live)

- [ ] `.env` is listed in `.gitignore` — confirm it is **never** committed.
- [ ] `config/firebase-key.json` is listed in `.gitignore`.
- [ ] `SESSION_SECRET` is set to a long, random value (not the placeholder).
- [ ] Default admin password has been changed after first login.
- [ ] Firestore security rules are configured in the Firebase Console.
- [ ] The PC running the server is on a secure, trusted network.

---

## 📞 Getting Help

- Check the **terminal output** — the server logs all errors with descriptive messages.
- Review `docs/SETTINGS_SUGGESTIONS.md` for configuration options.
- Run `npm run verify` for a quick health check.
