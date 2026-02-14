const fs = require('fs');
const path = require('path');

const logPath = path.join(process.cwd(), 'logs/opensidebar.jsonl');
const content = fs.readFileSync(logPath, 'utf-8');
const lines = content.trim().split('\n');
const lastLines = lines.slice(-10);

lastLines.forEach(line => {
    try {
        const json = JSON.parse(line);
        console.log(JSON.stringify(json, null, 2));
    } catch (e) {
        console.log(line);
    }
});
