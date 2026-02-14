const fs = require('fs');
const path = require('path');

const logPath = path.join(process.cwd(), 'logs/opensidebar.jsonl');
const content = fs.readFileSync(logPath, 'utf-8');
const lines = content.trim().split('\n');

let restartIndex = -1;
for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('Service Worker Initialized')) {
        restartIndex = i;
        break;
    }
}

if (restartIndex !== -1) {
    const start = Math.max(0, restartIndex - 20);
    const end = Math.min(lines.length, restartIndex + 5);
    const context = lines.slice(start, end);

    context.forEach(line => {
        try {
            const json = JSON.parse(line);
            console.log(JSON.stringify(json, null, 2));
        } catch (e) {
            console.log(line);
        }
    });
} else {
    console.log('No restart found in the last logs.');
}
