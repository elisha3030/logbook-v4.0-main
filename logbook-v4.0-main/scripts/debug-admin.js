const admin = require('firebase-admin');
const path = require('path');
// Resolve .env from project root regardless of where this script lives
require('dotenv').config({ path: path.join(__dirname, '../.env') });

async function checkAdmin() {
    try {
        const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
        // Resolve relative paths from project root (process.cwd()), not __dirname
        const absolutePath = path.isAbsolute(serviceAccountPath)
            ? serviceAccountPath
            : path.resolve(serviceAccountPath);

        const serviceAccount = require(absolutePath);
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        console.log('--- Checking for Admin User ---');
        try {
            const user = await admin.auth().getUserByEmail('admin@email.com');
            console.log('✅ Found admin user:', user.email);
        } catch (e) {
            console.log('❌ Admin user not found:', e.message);
            console.log('Creating admin user...');
            await admin.auth().createUser({
                email: 'admin@email.com',
                password: 'admin123',
                displayName: 'System Admin'
            });
            console.log('✨ Admin user created successfully!');
        }
    } catch (error) {
        console.error('❌ Critical error:', error);
    }
}

checkAdmin();
