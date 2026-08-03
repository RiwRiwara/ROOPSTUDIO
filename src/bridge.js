// bridge.js — สะพานระหว่าง MCP server (nodeในเทอร์มินัล) กับ Photopea (ในเบราว์เซอร์)
//
//   AI agent → MCP (stdio) → [bridge นี้] → WebSocket → Studio UI → postMessage → Photopea
//
// ต่างจากต้นทาง (attalla1/photopea-mcp-server, MIT) ตรง:
//   - หนึ่งงานส่งไฟล์กลับได้หลายไฟล์ (export หลายขนาดในสคริปต์เดียว)
//   - broadcast สถานะงานทุกช่วง (start/done/error + เวลาที่ใช้) ให้ UI วาด timeline ได้
//   - UI กดสั่งงานเองได้ ไม่ชนกับคิวของ agent เพราะคิวอยู่ฝั่งหน้าเว็บชั้นเดียว

import { createServer } from 'http';
import { randomUUID } from 'crypto';
import { WebSocketServer, WebSocket } from 'ws';

const DEFAULT_TIMEOUT = 30_000;
const FILE_TIMEOUT = 120_000;
const READY_TIMEOUT = 90_000;

/** ธงบอกว่าสคริปต์พัง — Photopea ไม่มีทางบอกเราเองว่าสคริปต์ throw
 *  (ต้นฉบับ upstream จึงรายงาน "สำเร็จ" ทั้งที่งานล้มเหลว) เราห่อ try/catch เอง */
export const ERR_FLAG = '__ROOP_ERR__';

function wrap(script) {
  return `try {\n${script}\n} catch (e) { app.echoToOE('${ERR_FLAG}' + (e && e.message ? e.message : e)); }`;
}

export class Bridge {
  constructor({ port, mock = false, onLaunch = null }) {
    this.port = port;
    this.mock = mock;
    this.onLaunch = onLaunch;
    this.client = null;
    this.ready = false;
    this.pending = new Map(); // id -> {resolve, timer, expectFiles, tool}
    this.launched = false;
    this.history = []; // เก็บ activity ล่าสุดไว้ให้หน้าเว็บที่เพิ่งเปิดเห็นย้อนหลัง
    this.httpServer = createServer();
    this.wss = new WebSocketServer({ server: this.httpServer });

    this.wss.on('connection', (ws) => {
      const prev = this.client;
      this.client = ws;
      if (prev && prev !== ws && prev.readyState === WebSocket.OPEN) {
        prev.removeAllListeners();
        prev.terminate();
      }
      // ส่ง activity ย้อนหลัง + config ให้หน้าเว็บที่เพิ่งต่อเข้ามา
      ws.send(JSON.stringify({ type: 'hello', mock: this.mock, history: this.history.slice(-100) }));

      ws.on('message', (raw) => {
        let msg;
        try { msg = JSON.parse(raw.toString()); } catch { return; }
        this.handleMessage(msg);
      });
      ws.on('close', () => {
        if (this.client === ws) {
          this.client = null;
          this.ready = false;
          this.failAll('หน้าเว็บ Studio ถูกปิดหรือหลุดการเชื่อมต่อ');
        }
      });
      ws.on('error', () => {});
    });
  }

  // -------------------------------------------------------------------------
  start() {
    return new Promise((resolve, reject) => {
      this.httpServer.listen(this.port, '127.0.0.1', resolve);
      this.httpServer.once('error', reject);
    });
  }

  isReady() {
    return this.client !== null && this.ready;
  }

  /** เปิดเบราว์เซอร์ครั้งแรกที่ agent เรียกใช้จริง แล้วรอจน Photopea พร้อม */
  waitForReady() {
    if (this.isReady()) return Promise.resolve();
    if (!this.launched) {
      this.launched = true;
      if (this.onLaunch) this.onLaunch(`http://127.0.0.1:${this.port}`);
    }
    return new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (this.isReady()) return resolve();
        if (Date.now() - started > READY_TIMEOUT) {
          return reject(new Error(
            `Photopea ยังไม่พร้อมภายใน ${READY_TIMEOUT / 1000} วินาที — เปิด http://127.0.0.1:${this.port} แล้วรอให้ Photopea โหลดเสร็จ`
          ));
        }
        setTimeout(tick, 200);
      };
      tick();
    });
  }

  // -------------------------------------------------------------------------
  send(obj) {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify(obj));
    }
  }

  /** บอก UI ว่ามีอะไรเกิดขึ้น — UI เอาไปวาด timeline */
  activity(entry) {
    const record = { type: 'activity', at: Date.now(), ...entry };
    this.history.push(record);
    if (this.history.length > 300) this.history.shift();
    this.send(record);
  }

  // -------------------------------------------------------------------------
  /**
   * รันสคริปต์ใน Photopea
   * @returns {Promise<{ok:boolean, echo:string|null, files:Array<{data:Buffer,mimeType:string}>, error:string|null}>}
   */
  async run(script, { expectFiles = false, tool = 'script', summary = '' } = {}) {
    try {
      await this.waitForReady();
    } catch (err) {
      this.activity({ tool, summary, status: 'error', error: err.message });
      return { ok: false, echo: null, files: [], error: err.message };
    }

    const id = randomUUID();
    const startedAt = Date.now();
    this.activity({ id, tool, summary, status: 'running' });

    return new Promise((resolve) => {
      const timeoutMs = expectFiles ? FILE_TIMEOUT : DEFAULT_TIMEOUT;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = `หมดเวลารอ Photopea (${timeoutMs / 1000} วินาที)`;
        this.activity({ id, tool, summary, status: 'error', error, ms: Date.now() - startedAt });
        resolve({ ok: false, echo: null, files: [], error });
      }, timeoutMs);

      this.pending.set(id, { resolve, timer, tool, summary, startedAt });
      this.send({ id, type: 'execute', script: wrap(script), expectFiles, tool, summary });
    });
  }

  /** ส่งไฟล์ (รูป/ฟอนต์) เข้า Photopea — มันจะเปิดเป็นเอกสารใหม่ */
  async load(buffer, filename) {
    try {
      await this.waitForReady();
    } catch (err) {
      return { ok: false, echo: null, files: [], error: err.message };
    }
    const id = randomUUID();
    const startedAt = Date.now();
    this.activity({ id, tool: 'load_file', summary: `ส่งไฟล์เข้า Photopea: ${filename}`, status: 'running' });

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = 'หมดเวลารอตอนส่งไฟล์เข้า Photopea';
        this.activity({ id, tool: 'load_file', status: 'error', error, ms: Date.now() - startedAt });
        resolve({ ok: false, echo: null, files: [], error });
      }, FILE_TIMEOUT);

      this.pending.set(id, { resolve, timer, tool: 'load_file', summary: filename, startedAt });
      this.send({ id, type: 'load', data: buffer.toString('base64'), filename });
    });
  }

  // -------------------------------------------------------------------------
  handleMessage(msg) {
    if (msg.type === 'status') {
      if (msg.status === 'ready') this.ready = true;
      return;
    }
    // UI แจ้งว่าผู้ใช้กดปุ่มลัดเอง — บันทึกลง timeline ให้เห็นร่วมกับงานของ agent
    if (msg.type === 'ui-activity') {
      this.activity({
        id: msg.id, tool: msg.tool || 'quick', summary: msg.summary || '',
        status: msg.status || 'done', source: 'user', ms: msg.ms,
      });
      return;
    }
    if (msg.type !== 'result') return;

    const p = this.pending.get(msg.id);
    if (!p) return; // หมดเวลาไปแล้ว
    clearTimeout(p.timer);
    this.pending.delete(msg.id);

    const files = (msg.files || []).map((f) => ({
      data: Buffer.from(f.data, 'base64'),
      mimeType: f.mimeType || 'application/octet-stream',
    }));
    const ms = Date.now() - p.startedAt;

    this.activity({
      id: msg.id, tool: p.tool, summary: p.summary,
      status: msg.success ? 'done' : 'error',
      error: msg.error || null, ms, files: files.length,
    });

    p.resolve({
      ok: !!msg.success,
      echo: msg.echo ?? null,
      files,
      error: msg.error || null,
    });
  }

  failAll(reason) {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, echo: null, files: [], error: reason });
    }
    this.pending.clear();
  }

  stop() {
    this.failAll('ปิดเซิร์ฟเวอร์');
    for (const ws of this.wss.clients) ws.terminate();
    return new Promise((resolve) => this.wss.close(() => this.httpServer.close(() => resolve())));
  }
}
