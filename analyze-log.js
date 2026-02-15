const fs = require('fs');
const lines = fs.readFileSync('C:/Users/k_shk/Projects/OpenSidebar/logs/opensidebar.jsonl', 'utf8').split('\n');
for (const line of lines) {
  if (!line.trim()) continue;
  try {
    const obj = JSON.parse(line);
    if (obj.src !== 'background') continue;
    const ts = obj.ts.slice(11, 19);
    const msg = obj.msg;
    const data = obj.data || {};
    
    if (msg === 'User message') {
      const text = (data.text || '').slice(0, 80);
      console.log(ts + ' | USER MESSAGE: ' + text + '...');
    } else if (msg === 'LLM response') {
      const turn = data.turn || '?';
      const url = data.url || '';
      let step = '';
      if (url.includes('step')) step = url.split('/').pop().split('?')[0];
      const tools = (data.toolCalls || []).map(t => String(t).slice(0, 70));
      const text = (data.text || '').slice(0, 80);
      console.log(ts + ' | Turn ' + String(turn).padStart(3) + ' [' + step.padStart(6) + '] tools=[' + tools.join(', ') + ']' + (text ? ' text=' + text : ''));
    } else if (msg === 'DONE called') {
      console.log(ts + ' | *** DONE *** Turn ' + data.turn + ' url=' + data.url + ' summary=' + (data.summary || '').slice(0, 120));
    } else if (msg.includes('Circuit breaker')) {
      console.log(ts + ' | CIRCUIT BREAKER: Turn ' + data.turn + ' tool=' + data.tool + ' count=' + data.count);
    } else if (msg.includes('stuck') || msg.includes('Stuck')) {
      console.log(ts + ' | STUCK: Turn ' + data.turn + ' type=' + data.type + ' staleTurns=' + data.staleTurns);
    } else if (msg.includes('Redundant action')) {
      console.log(ts + ' | REDUNDANT: Turn ' + data.turn + ' tool=' + data.tool + ' count=' + data.count);
    }
  } catch(e) {}
}
