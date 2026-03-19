
const { open } = require('sqlite');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

async function dump() {
    const db = await open({
        filename: path.join(__dirname, 'local.db'),
        driver: sqlite3.Database
    });
    const logs = await db.all('SELECT * FROM logs ORDER BY createdAt DESC LIMIT 20');
    fs.writeFileSync('dump_all.json', JSON.stringify({ logs }, null, 2));
    console.log('Dumped to dump_all.json');
}

dump();
