
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

async function dump() {
    const db = await open({
        filename: path.join(__dirname, 'local.db'),
        driver: sqlite3.Database
    });
    const logs = await db.all('SELECT * FROM logs WHERE date = ? OR timeIn LIKE ?', ['2026-03-19', '2026-03-19%']);
    const settings = await db.all('SELECT * FROM settings');
    const faculty = await db.all('SELECT * FROM settings WHERE key = "faculty"');
    
    fs.writeFileSync('dump.json', JSON.stringify({ logs, settings, faculty }, null, 2));
    console.log('Dumped to dump.json');
}

dump();
