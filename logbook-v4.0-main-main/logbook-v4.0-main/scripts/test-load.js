const path = require('path');
console.log('Testing module loading...');
try {
    require('dotenv').config({ path: path.join(__dirname, '../.env') });
    console.log('✅ dotenv loaded');
    require('express');
    console.log('✅ express loaded');
    require('firebase-admin');
    console.log('✅ firebase-admin loaded');
    require('cors');
    console.log('✅ cors loaded');
    require('path');
    console.log('✅ path loaded');
    require('sqlite');
    console.log('✅ sqlite loaded');
    require('sqlite3');
    console.log('✅ sqlite3 loaded');
} catch (error) {
    console.error('❌ Loading failed:', error);
}
