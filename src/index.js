#!/usr/bin/env node
// RoopStudio — MCP server + Studio UI สำหรับสั่ง Photopea ด้วย AI
// ต่อยอดจาก attalla1/photopea-mcp-server (MIT) — ดูรายละเอียดใน README

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { createServer as netServer } from 'net';
import { spawn } from 'child_process';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Bridge } from './bridge.js';
import { registerTools } from './tools.js';
import { presetPayload } from './presets.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const DEFAULT_PORT = 4127;

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => { const i = argv.indexOf(f); return i > -1 && argv[i + 1] ? argv[i + 1] : d; };

const MOCK = has('--mock');
const NO_MCP = has('--ui-only');
const PORT_ARG = Number(val('--port', process.env.ROOPSTUDIO_PORT || DEFAULT_PORT));

function findPort(preferred) {
  return new Promise((res) => {
    const s = netServer();
    s.listen(preferred, '127.0.0.1', () => s.close(() => res(preferred)));
    s.on('error', () => {
      const f = netServer();
      f.listen(0, '127.0.0.1', () => {
        const p = f.address().port;
        f.close(() => res(p));
      });
    });
  });
}

function openBrowser(url) {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
      : ['xdg-open', [url]];
  try {
    spawn(cmd[0], cmd[1], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' }).unref();
  } catch {
    log(`เปิดเบราว์เซอร์เองไม่ได้ — เปิด ${url} ด้วยตัวเองได้เลย`);
  }
}

// stdout สงวนไว้ให้ MCP protocol เท่านั้น — log ทุกอย่างลง stderr
const log = (...a) => console.error('[roopstudio]', ...a);

async function main() {
  const port = await findPort(PORT_ARG);
  const bridge = new Bridge({ port, mock: MOCK, onLaunch: (url) => { log('เปิดเบราว์เซอร์:', url); openBrowser(url); } });

  const studioHtml = readFileSync(join(ROOT, 'web', 'studio.html'), 'utf-8');
  const mockHtml = readFileSync(join(ROOT, 'web', 'mock.html'), 'utf-8');

  bridge.httpServer.on('request', (req, res) => {
    const url = (req.url || '/').split('?')[0];
    const send = (code, body, type) => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    if (req.method === 'GET' && (url === '/' || url === '/index.html')) {
      return send(200, studioHtml, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url === '/mock.html') {
      return send(200, mockHtml, 'text/html; charset=utf-8');
    }
    if (req.method === 'GET' && url === '/api/presets') {
      return send(200, JSON.stringify({ ...presetPayload(), mock: MOCK }), 'application/json; charset=utf-8');
    }
    send(404, 'not found', 'text/plain');
  });

  await bridge.start();
  log(`Studio: http://127.0.0.1:${port}${MOCK ? '  (โหมด mock — ไม่ต่อเน็ต ไม่ใช้ Photopea จริง)' : ''}`);

  if (NO_MCP) {
    log('โหมด --ui-only: เปิดหน้า Studio อย่างเดียว ไม่เริ่ม MCP');
    openBrowser(`http://127.0.0.1:${port}`);
    return;
  }

  const server = new McpServer({ name: 'roopstudio', version: '0.1.0' });
  registerTools(server, bridge);
  await server.connect(new StdioServerTransport());
  log('MCP server พร้อม (เบราว์เซอร์จะเปิดเองเมื่อมีคำสั่งแรก)');
}

main().catch((e) => {
  console.error('[roopstudio] fatal:', e);
  process.exit(1);
});
