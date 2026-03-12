#!/usr/bin/env node
/**
 * Filter JSON log lines by traceId and print in timestamp order.
 * Usage: node scripts/trace-story.mjs <traceId>
 *        cat logs.jsonl | node scripts/trace-story.mjs <traceId>
 * Log shape: one JSON object per line with traceId (or trace_id), timestamp, message, level, etc.
 */

const traceId = process.argv[2];
if (!traceId) {
  console.error('Usage: trace-story.mjs <traceId>');
  console.error('Reads JSON lines from stdin. Example: cat logs.jsonl | node scripts/trace-story.mjs abc-123');
  process.exit(1);
}

const lines = [];
let buf = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buf += chunk;
  const parts = buf.split('\n');
  buf = parts.pop() ?? '';
  for (const line of parts) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line);
      const id = obj.traceId ?? obj.trace_id;
      if (id === traceId) lines.push(obj);
    } catch {
      // skip invalid JSON lines
    }
  }
});
process.stdin.on('end', () => {
  if (buf.trim()) {
    try {
      const obj = JSON.parse(buf);
      if ((obj.traceId ?? obj.trace_id) === traceId) lines.push(obj);
    } catch {}
  }
  lines.sort((a, b) => (a.timestamp || '').localeCompare(b.timestamp || ''));
  for (const obj of lines) {
    console.log(JSON.stringify(obj));
  }
});
