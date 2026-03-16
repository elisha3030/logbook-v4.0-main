const http = require('http');

http.get('http://localhost:3000/api/config', (res) => {
    console.log(`STATUS: ${res.statusCode}`);
    let data = '';
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => {
        console.log('BODY: ' + data);
        process.exit(0);
    });
}).on('error', (err) => {
    console.error('ERROR: ' + err.message);
    process.exit(1);
});
