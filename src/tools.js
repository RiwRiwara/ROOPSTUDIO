// tools.js — MCP tools ของ RoopStudio
//
// ปรัชญา: tool น้อยแต่ตรงงาน ดีกว่า tool เยอะแต่ดิบ
//   - กลุ่ม "ชิ้นส่วน" (create/text/place/export) ไว้ให้ agent ประกอบเองเมื่ออยากคุมละเอียด
//   - กลุ่ม "งานสำเร็จรูป" (make_post_cover / export_social_set) คือของจริงที่ทำให้
//     คำสั่งเดียวจบ — agent ไม่ต้องวางแผน 15 ขั้นแล้วพลาดกลางทาง

import { z } from 'zod';
import * as P from './photopea.js';
import { buildCover } from './cover.js';
import { SOCIAL_SIZES, DEFAULT_SET, THAI_FONTS, COVER_THEMES } from './presets.js';
import { readSource, writeOut, extFor, expandPath } from './files.js';
import { removeBackgroundToPng } from './bgremove.js';
import { basename, join } from 'path';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'ใช้รูปแบบ #rrggbb');
const ok = (text) => ({ content: [{ type: 'text', text }] });
const fail = (text) => ({ isError: true, content: [{ type: 'text', text }] });

/** สถานะฟอนต์ไทยต่อหนึ่ง session — โหลดซ้ำไม่มีประโยชน์ */
const state = { thaiFontsLoaded: false };

async function ensureThaiFonts(bridge, familyKeys = ['plex']) {
  if (state.thaiFontsLoaded) return { loaded: [], already: true };
  const loaded = [];
  for (const key of familyKeys) {
    const fam = THAI_FONTS[key];
    if (!fam) continue;
    for (const weight of ['regular', 'bold']) {
      const f = fam[weight];
      if (!f) continue;
      const r = await bridge.run(P.loadFont(f.url), {
        tool: 'load_font', summary: `โหลดฟอนต์ ${f.postScriptName}`,
      });
      if (r.ok) loaded.push(f.postScriptName);
    }
  }
  if (loaded.length) state.thaiFontsLoaded = true;
  return { loaded, already: false };
}

function resolveSizes(keys) {
  const list = (keys && keys.length ? keys : DEFAULT_SET);
  const out = [];
  for (const k of list) {
    const s = SOCIAL_SIZES[k];
    if (!s) throw new Error(`ไม่รู้จักขนาด "${k}" — เลือกจาก: ${Object.keys(SOCIAL_SIZES).join(', ')}`);
    out.push({ key: k, ...s });
  }
  return out;
}

async function saveFiles(files, { outDir, baseName, keys }) {
  const saved = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const ext = extFor(f.mimeType);
    const key = keys && keys[i] ? `-${keys[i]}` : (files.length > 1 ? `-${i + 1}` : '');
    const p = join(expandPath(outDir), `${baseName}${key}.${ext}`);
    saved.push(await writeOut(p, f.data));
  }
  return saved;
}

export function registerTools(server, bridge) {
  // -------------------------------------------------------------------------
  // งานสำเร็จรูป (ของเด็ดของ RoopStudio)
  // -------------------------------------------------------------------------

  server.registerTool('roop_make_post_cover', {
    title: 'ทำภาพปกโพสต์ (ทุกขนาด)',
    description:
      'สร้างภาพปกโพสต์พร้อมพาดหัวภาษาไทย/อังกฤษ ครบทุกขนาดโซเชียลในคำสั่งเดียว ' +
      'จัดหน้าใหม่ต่อขนาด (ไม่ใช่ครอปจากภาพเดียว ตัวหนังสือจึงไม่โดนตัด) ' +
      'โหลดฟอนต์ไทยให้อัตโนมัติ ใส่รูปพื้นหลังได้จากไฟล์ในเครื่องหรือ URL ' +
      'ถ้าระบุ outDir จะเซฟไฟล์ลงเครื่องให้เลย',
    inputSchema: {
      headline: z.string().describe('พาดหัว — ภาษาไทยได้ ขึ้นบรรทัดใหม่ด้วย \\n'),
      subtitle: z.string().optional().describe('ข้อความรอง ใต้พาดหัว'),
      brandMark: z.string().optional().describe('ข้อความเล็กมุมล่าง เช่นชื่อแบรนด์'),
      background: z.string().optional().describe('พาธไฟล์รูปในเครื่อง หรือ URL รูปพื้นหลัง'),
      theme: z.enum(['ink', 'inverse', 'photo']).optional()
        .describe('ink = ตัวดำพื้นครีม, inverse = ตัวขาวพื้นดำ, photo = ทับบนรูปพร้อมแผ่นบัง (ค่าเริ่มต้นเลือกให้เองตามว่ามีรูปพื้นหลังไหม)'),
      sizes: z.array(z.enum(Object.keys(SOCIAL_SIZES))).optional()
        .describe(`ขนาดที่ต้องการ (ค่าเริ่มต้น: ${DEFAULT_SET.join(', ')})`),
      font: z.enum(Object.keys(THAI_FONTS)).optional().describe('ตระกูลฟอนต์ไทย (ค่าเริ่มต้น plex = IBM Plex Sans Thai)'),
      format: z.enum(['png', 'jpg', 'webp']).optional(),
      outDir: z.string().optional().describe('โฟลเดอร์ปลายทางสำหรับเซฟไฟล์ เช่น ~/Desktop/covers'),
      baseName: z.string().optional().describe('ชื่อไฟล์ฐาน (ค่าเริ่มต้น: cover)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    let sizes;
    try { sizes = resolveSizes(a.sizes); } catch (e) { return fail(e.message); }

    const themeKey = a.theme || (a.background ? 'photo' : 'ink');
    const theme = COVER_THEMES[themeKey];
    const famKey = a.font || 'plex';
    const fam = THAI_FONTS[famKey];
    const fontBold = (fam.bold || fam.regular).postScriptName;
    const fontRegular = (fam.regular || fam.bold).postScriptName;
    const format = a.format || 'png';

    await ensureThaiFonts(bridge, [famKey]);

    // พื้นหลัง: ส่งเข้า Photopea ครั้งเดียว แล้วก๊อปใช้ซ้ำทุกขนาด
    let bgDocName = null;
    if (a.background) {
      let buf;
      try { buf = await readSource(a.background); } catch (e) { return fail(e.message); }
      const filename = basename(String(a.background).split('?')[0]) || 'background';
      const r = await bridge.load(buf, filename);
      if (!r.ok) return fail(r.error || 'ส่งรูปพื้นหลังเข้า Photopea ไม่สำเร็จ');
      const info = await bridge.run(P.documentInfo(), { tool: 'document_info', summary: 'อ่านชื่อเอกสารรูปพื้นหลัง' });
      try { bgDocName = JSON.parse(info.echo).name; } catch { return fail('อ่านชื่อเอกสารรูปพื้นหลังไม่ได้'); }
    }

    const files = [];
    const keys = [];
    for (let i = 0; i < sizes.length; i++) {
      const s = sizes[i];
      const script = buildCover({
        width: s.width, height: s.height, theme,
        headline: a.headline, subtitle: a.subtitle, brandMark: a.brandMark,
        fontBold, fontRegular, bgDocName, format, index: i,
      });
      const r = await bridge.run(script, {
        expectFiles: true, tool: 'make_post_cover',
        summary: `ทำปก ${s.key} ${s.width}×${s.height} — "${String(a.headline).slice(0, 30)}"`,
      });
      if (!r.ok) return fail(r.error || `ทำภาพขนาด ${s.key} ไม่สำเร็จ`);
      for (const f of r.files) { files.push(f); keys.push(s.key); }
    }

    await bridge.run(P.closeTemps(), { tool: 'cleanup', summary: 'ปิดเอกสารชั่วคราว' });

    let savedNote = '';
    if (a.outDir) {
      try {
        const saved = await saveFiles(files, { outDir: a.outDir, baseName: a.baseName || 'cover', keys });
        savedNote = `\nบันทึกไฟล์แล้ว:\n${saved.map((p) => '  ' + p).join('\n')}`;
      } catch (e) { savedNote = `\n(เซฟไฟล์ไม่สำเร็จ: ${e.message})`; }
    }

    return ok(
      `ทำภาพปกเสร็จ ${files.length} ไฟล์ (${keys.join(', ')}) ธีม ${themeKey} ฟอนต์ ${fontBold}` +
      `${a.outDir ? '' : '\nดูภาพได้ในแกลเลอรีของหน้า Studio — ระบุ outDir ถ้าต้องการให้เซฟลงเครื่อง'}` +
      savedNote
    );
  });

  server.registerTool('roop_export_social_set', {
    title: 'Export ทุกขนาดโซเชียลจากภาพที่เปิดอยู่',
    description:
      'เอาเอกสารที่เปิดอยู่ตอนนี้ไปทำเป็นหลายขนาด (ย่อให้เต็มกรอบแล้วครอปกลาง) ' +
      'เหมาะกับรูปถ่าย/ภาพที่ไม่มีตัวหนังสือ ถ้ามีตัวหนังสือให้ใช้ roop_make_post_cover แทน',
    inputSchema: {
      sizes: z.array(z.enum(Object.keys(SOCIAL_SIZES))).optional(),
      format: z.enum(['png', 'jpg', 'webp']).optional(),
      quality: z.number().min(0).max(1).optional().describe('คุณภาพ 0-1 สำหรับ jpg/webp'),
      outDir: z.string().optional(),
      baseName: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    let sizes;
    try { sizes = resolveSizes(a.sizes); } catch (e) { return fail(e.message); }
    const r = await bridge.run(P.exportSet({ sizes, format: a.format || 'png', quality: a.quality }), {
      expectFiles: true, tool: 'export_social_set',
      summary: `Export ${sizes.length} ขนาด: ${sizes.map((s) => s.key).join(', ')}`,
    });
    if (!r.ok) return fail(r.error || 'export ไม่สำเร็จ');
    await bridge.run(P.closeTemps(), { tool: 'cleanup', summary: 'ปิดเอกสารชั่วคราว' });

    let savedNote = '';
    if (a.outDir) {
      try {
        const saved = await saveFiles(r.files, {
          outDir: a.outDir, baseName: a.baseName || 'export', keys: sizes.map((s) => s.key),
        });
        savedNote = `\nบันทึกไฟล์แล้ว:\n${saved.map((p) => '  ' + p).join('\n')}`;
      } catch (e) { savedNote = `\n(เซฟไฟล์ไม่สำเร็จ: ${e.message})`; }
    }
    return ok(`export เสร็จ ${r.files.length} ไฟล์${savedNote}`);
  });

  // -------------------------------------------------------------------------
  // ชิ้นส่วน
  // -------------------------------------------------------------------------

  server.registerTool('roop_status', {
    title: 'สถานะ Studio',
    description: 'เช็คว่าหน้า Studio เปิดอยู่และ Photopea พร้อมทำงานไหม พร้อมข้อมูลเอกสารที่เปิดอยู่ — เรียกอันนี้ก่อนถ้าไม่แน่ใจสถานะ',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    if (!bridge.isReady()) {
      return ok(`ยังไม่พร้อม — เปิด http://127.0.0.1:${bridge.port} แล้วรอให้ Photopea โหลดเสร็จ (เรียก tool ใด ๆ ก็ได้ ระบบจะเปิดเบราว์เซอร์ให้เอง)`);
    }
    const r = await bridge.run(P.documentInfo(), { tool: 'status', summary: 'เช็คสถานะ' });
    if (!r.ok) return ok('Photopea พร้อม แต่ยังไม่มีเอกสารเปิดอยู่');
    return ok(`พร้อมใช้งาน · เอกสารปัจจุบัน: ${r.echo}`);
  });

  server.registerTool('roop_create_document', {
    title: 'สร้างเอกสารใหม่',
    description: 'สร้างเอกสารเปล่าขนาดที่กำหนด (หรือเลือกจาก preset ขนาดโซเชียล)',
    inputSchema: {
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      preset: z.enum(Object.keys(SOCIAL_SIZES)).optional().describe('ใช้แทน width/height ได้'),
      name: z.string().optional(),
      fill: hex.optional().describe('สีพื้น เช่น #fafaf7'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const size = a.preset ? SOCIAL_SIZES[a.preset] : { width: a.width, height: a.height };
    if (!size.width || !size.height) return fail('ต้องระบุ width+height หรือ preset');
    const r = await bridge.run(P.createDocument({ ...size, name: a.name, fill: a.fill }), {
      tool: 'create_document', summary: `สร้างเอกสาร ${size.width}×${size.height}`,
    });
    return r.ok ? ok(`สร้างเอกสาร ${size.width}×${size.height} แล้ว`) : fail(r.error);
  });

  server.registerTool('roop_document_info', {
    title: 'ข้อมูลเอกสาร',
    description: 'ขนาด จำนวนเลเยอร์ และรายชื่อเลเยอร์ของเอกสารที่เปิดอยู่',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const r = await bridge.run(P.documentInfo(), { tool: 'document_info', summary: 'อ่านข้อมูลเอกสาร' });
    return r.ok ? ok(r.echo) : fail(r.error || 'ไม่มีเอกสารเปิดอยู่');
  });

  server.registerTool('roop_open_image', {
    title: 'เปิดรูป',
    description: 'เปิดรูปจากไฟล์ในเครื่องหรือ URL เป็นเอกสารใหม่',
    inputSchema: { source: z.string().describe('พาธไฟล์ในเครื่อง หรือ URL') },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    let buf;
    try { buf = await readSource(a.source); } catch (e) { return fail(e.message); }
    const r = await bridge.load(buf, basename(String(a.source).split('?')[0]) || 'image');
    return r.ok ? ok(`เปิดรูปแล้ว: ${a.source}`) : fail(r.error);
  });

  server.registerTool('roop_place_image', {
    title: 'วางรูปลงเอกสารปัจจุบัน',
    description: 'วางรูป (ไฟล์ในเครื่องหรือ URL) เป็นเลเยอร์ใหม่ในเอกสารที่เปิดอยู่ — fit: cover เต็มกรอบ / contain เห็นครบ / none ขนาดเดิม',
    inputSchema: {
      source: z.string(),
      fit: z.enum(['cover', 'contain', 'none']).optional(),
      x: z.number().optional(), y: z.number().optional(),
      name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    const info = await bridge.run(P.documentInfo(), { tool: 'document_info', summary: 'อ่านเอกสารเป้าหมาย' });
    if (!info.ok) return fail('ต้องมีเอกสารเปิดอยู่ก่อนถึงจะวางรูปได้');
    let targetName;
    try { targetName = JSON.parse(info.echo).name; } catch { return fail('อ่านชื่อเอกสารไม่ได้'); }

    let buf;
    try { buf = await readSource(a.source); } catch (e) { return fail(e.message); }
    const load = await bridge.load(buf, basename(String(a.source).split('?')[0]) || 'image');
    if (!load.ok) return fail(load.error);

    const r = await bridge.run(P.mergeLoadedInto({
      targetName, fit: a.fit || 'cover',
      x: a.x ?? null, y: a.y ?? null, name: a.name || 'image',
    }), { tool: 'place_image', summary: `วางรูป ${basename(String(a.source))}` });
    return r.ok ? ok('วางรูปแล้ว') : fail(r.error);
  });

  server.registerTool('roop_add_text', {
    title: 'ใส่ข้อความ',
    description: 'เพิ่มเลเยอร์ข้อความ — ถ้าเป็นภาษาไทยให้เรียก roop_load_thai_fonts ก่อน แล้วส่งชื่อฟอนต์ที่ได้มาในช่อง font',
    inputSchema: {
      content: z.string(), x: z.number(), y: z.number(),
      font: z.string().optional(), size: z.number().positive().optional(),
      color: hex.optional(), align: z.enum(['left', 'center', 'right']).optional(),
      lineHeight: z.number().optional(), tracking: z.number().optional(),
      box: z.object({ width: z.number(), height: z.number() }).optional()
        .describe('ทำเป็นกล่องข้อความที่ตัดบรรทัดเอง'),
      name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.addText(a), {
      tool: 'add_text', summary: `ใส่ข้อความ "${a.content.slice(0, 30)}"`,
    });
    return r.ok ? ok('ใส่ข้อความแล้ว') : fail(r.error);
  });

  server.registerTool('roop_add_rect', {
    title: 'ใส่สี่เหลี่ยม',
    description: 'วาดสี่เหลี่ยมทึบ ใช้ทำแถบสี แผ่นบังใต้ตัวหนังสือ หรือเส้นคั่น (ตั้ง opacity ได้)',
    inputSchema: {
      x: z.number(), y: z.number(), width: z.number(), height: z.number(),
      color: hex,
      opacity: z.number().min(0).max(100).optional()
        .describe('ความทึบ 0 (โปร่งใสหมด) ถึง 100 (ทึบเต็มที่, ค่าเริ่มต้น) — หน่วยเป็นเปอร์เซ็นต์ ไม่ใช่ 0–1 (เช่นอยากได้แผ่นบังทึบ 70% ให้ส่ง 70 ไม่ใช่ 0.7)'),
      name: z.string().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.addRect(a), { tool: 'add_rect', summary: `สี่เหลี่ยม ${a.width}×${a.height}` });
    return r.ok ? ok('วาดสี่เหลี่ยมแล้ว') : fail(r.error);
  });

  server.registerTool('roop_remove_background', {
    title: 'ตัดพื้นหลังด้วย AI (รันในเครื่อง)',
    description:
      'ตัดพื้นหลังออกจากรูปด้วยโมเดล AI ที่รันในเครื่อง (ไม่ผ่าน API ภายนอก หลังโหลดโมเดลครั้งแรกใช้งานออฟไลน์ได้) ' +
      'ทำ matting จริง ขอบขนสัตว์/เส้นผมฟุ้งได้ตามภาพจริง — ต่างจาก roop_magic_wand ที่ตัดตามสีเท่านั้น ' +
      'เหมาะกับพื้นหลังซับซ้อน (ท้องฟ้า กิ่งไม้ ฉากเปิด) ที่ magic wand ทำไม่ได้ผลดี ' +
      'ไม่ระบุ source = ตัดเอกสารที่เปิดอยู่ตอนนี้แล้วแทนที่เลเยอร์เดิมด้วยผลลัพธ์ (ชื่อ/ขนาดเอกสารเดิม) ' +
      'ระบุ source = เปิดรูปนั้นเป็นเอกสารใหม่ที่ตัดพื้นหลังแล้วเลย',
    inputSchema: {
      source: z.string().optional().describe('พาธไฟล์ในเครื่องหรือ URL — ถ้าไม่ระบุจะใช้เอกสารที่เปิดอยู่ตอนนี้'),
      model: z.enum(['small', 'medium', 'large']).optional()
        .describe('ขนาดโมเดล — small เร็วสุด/หยาบสุด, large แม่นสุด/ช้าสุด (ค่าเริ่มต้น medium)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
  }, async (a) => {
    const model = a.model || 'medium';
    let srcBuf, targetName = null;

    if (a.source) {
      try { srcBuf = await readSource(a.source); } catch (e) { return fail(e.message); }
    } else {
      const info = await bridge.run(P.documentInfo(), { tool: 'document_info', summary: 'อ่านเอกสารเป้าหมาย' });
      if (!info.ok) return fail('ไม่มีเอกสารเปิดอยู่ — ระบุ source หรือเปิดรูปก่อนด้วย roop_open_image');
      try { targetName = JSON.parse(info.echo).name; } catch { return fail('อ่านชื่อเอกสารไม่ได้'); }
      const exp = await bridge.run(P.exportDoc({ format: 'png' }), {
        expectFiles: true, tool: 'remove_background', summary: 'export เอกสารปัจจุบันเพื่อตัดพื้นหลัง',
      });
      if (!exp.ok || !exp.files.length) return fail(exp.error || 'export เอกสารปัจจุบันไม่สำเร็จ');
      srcBuf = exp.files[0].data;
    }

    let cutout;
    try {
      cutout = await removeBackgroundToPng(srcBuf, { model });
    } catch (e) {
      return fail(`ตัดพื้นหลังไม่สำเร็จ: ${e.message}`);
    }

    const load = await bridge.load(cutout, 'cutout.png');
    if (!load.ok) return fail(load.error || 'ส่งผลลัพธ์เข้า Photopea ไม่สำเร็จ');

    if (targetName) {
      const r = await bridge.run(P.replaceWithLoaded({ targetName }), {
        tool: 'remove_background', summary: 'แทนที่เอกสารเดิมด้วยผลตัดพื้นหลัง',
      });
      if (!r.ok) return fail(r.error);
      return ok(`ตัดพื้นหลังแล้ว (โมเดล ${model}) — แทนที่เลเยอร์เดิมในเอกสาร "${targetName}"`);
    }
    return ok(`ตัดพื้นหลังแล้ว (โมเดล ${model}) — เปิดเป็นเอกสารใหม่`);
  });

  server.registerTool('roop_layer', {
    title: 'จัดการเลเยอร์',
    description:
      'list/add/duplicate/rename/delete/select/reorder/set ของเลเยอร์ในเอกสารที่เปิดอยู่ ' +
      '(อ้างเลเยอร์ด้วยชื่อ — ไม่รองรับ layer group ซ้อนโฟลเดอร์)',
    inputSchema: {
      action: z.enum(['list', 'add', 'duplicate', 'rename', 'delete', 'select', 'reorder', 'set']),
      name: z.string().optional().describe('ชื่อเลเยอร์เป้าหมาย — ต้องระบุทุก action ยกเว้น list/add'),
      newName: z.string().optional().describe('ชื่อใหม่ — ใช้กับ rename/duplicate'),
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('ใช้กับ reorder'),
      visible: z.boolean().optional().describe('ใช้กับ set'),
      opacity: z.number().min(0).max(100).optional().describe('ใช้กับ set'),
      blendMode: z.enum([
        'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten',
        'colorDodge', 'colorBurn', 'hardLight', 'softLight', 'difference',
        'exclusion', 'hue', 'saturation', 'color', 'luminosity',
      ]).optional().describe('ใช้กับ set'),
      locked: z.boolean().optional().describe('ใช้กับ set'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const needName = a.action !== 'list' && a.action !== 'add';
    if (needName && !a.name) return fail(`action "${a.action}" ต้องระบุ name`);
    if (a.action === 'reorder' && !a.direction) return fail('action reorder ต้องระบุ direction');

    let script;
    try {
      script = {
        list: () => P.layerList(),
        add: () => P.layerAdd({ name: a.name || 'layer' }),
        duplicate: () => P.layerDuplicate({ name: a.name, newName: a.newName }),
        rename: () => { if (!a.newName) throw new Error('action rename ต้องระบุ newName'); return P.layerRename({ name: a.name, newName: a.newName }); },
        delete: () => P.layerDelete({ name: a.name }),
        select: () => P.layerSelect({ name: a.name }),
        reorder: () => P.layerReorder({ name: a.name, direction: a.direction }),
        set: () => P.layerSet(a),
      }[a.action]();
    } catch (e) { return fail(e.message); }

    const r = await bridge.run(script, { tool: 'layer', summary: `layer ${a.action}${a.name ? ` "${a.name}"` : ''}` });
    if (!r.ok) return fail(r.error);
    if (a.action === 'list') {
      let list;
      try { list = JSON.parse(r.echo); } catch { return fail('อ่านรายชื่อเลเยอร์ไม่ได้'); }
      return ok(JSON.stringify(list, null, 2));
    }
    return ok(`layer ${a.action} สำเร็จ`);
  });

  server.registerTool('roop_filter', {
    title: 'ใส่เอฟเฟกต์ภาพ (filter)',
    description:
      'ใส่ filter บนเลเยอร์ที่กำลังเลือกอยู่ (เลือกด้วย roop_layer action select ก่อนถ้าไม่ใช่เลเยอร์ปัจจุบัน) — ' +
      'gaussianBlur/sharpen/sharpenMore/unsharpMask/addNoise/motionBlur/highPass/despeckle',
    inputSchema: {
      type: z.enum(['gaussianBlur', 'sharpen', 'sharpenMore', 'unsharpMask', 'addNoise', 'motionBlur', 'highPass', 'despeckle']),
      radius: z.number().min(0).optional().describe('ใช้กับ gaussianBlur/unsharpMask/motionBlur/highPass'),
      amount: z.number().min(0).optional().describe('ใช้กับ unsharpMask (%) หรือ addNoise (%)'),
      threshold: z.number().min(0).max(255).optional().describe('ใช้กับ unsharpMask'),
      angle: z.number().min(-360).max(360).optional().describe('ใช้กับ motionBlur (องศา)'),
      monochromatic: z.boolean().optional().describe('ใช้กับ addNoise'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    let script;
    try { script = P.filter(a); } catch (e) { return fail(e.message); }
    const r = await bridge.run(script, { tool: 'filter', summary: `filter: ${a.type}` });
    return r.ok ? ok(`ใส่ filter ${a.type} แล้ว`) : fail(r.error);
  });

  server.registerTool('roop_select', {
    title: 'เลือกพื้นที่',
    description:
      'สร้าง selection บนเอกสารที่เปิดอยู่ — สี่เหลี่ยม/วงรี/หลายเหลี่ยม/ทั้งภาพ ' +
      'ใช้ก่อน roop_fill_selection, roop_erase_selection, roop_adjust หรือ roop_modify_selection ' +
      '(ไม่เติม/ไม่ลบเองจนกว่าจะเรียก tool ถัดไป)',
    inputSchema: {
      type: z.enum(['rect', 'ellipse', 'polygon', 'all']),
      x: z.number().optional().describe('มุมบนซ้าย — ใช้กับ rect/ellipse'),
      y: z.number().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      points: z.array(z.tuple([z.number(), z.number()])).optional()
        .describe('จุดของหลายเหลี่ยม [[x,y],...] — ใช้กับ type: polygon'),
      feather: z.number().min(0).optional().describe('ขอบฟุ้งเป็นพิกเซล (ค่าเริ่มต้น 0 = คมชัด)'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    if (a.type !== 'all' && a.type !== 'polygon' && (a.x === undefined || a.y === undefined || a.width === undefined || a.height === undefined)) {
      return fail('type rect/ellipse ต้องระบุ x, y, width, height');
    }
    if (a.type === 'polygon' && (!a.points || a.points.length < 3)) {
      return fail('type polygon ต้องระบุ points อย่างน้อย 3 จุด');
    }
    const r = await bridge.run(P.select(a), { tool: 'select', summary: `เลือก ${a.type}` });
    return r.ok ? ok('เลือกพื้นที่แล้ว') : fail(r.error);
  });

  server.registerTool('roop_magic_wand', {
    title: 'เลือกตามสี (คล้าย Magic Wand)',
    description:
      'คลิกจุดหนึ่งแล้วขยาย selection ไปหาพิกเซลสีใกล้เคียงทั่วเลเยอร์ที่เลือกอยู่ ' +
      'เหมาะกับพื้นหลังสีล้วน/ใกล้เคียงกัน (เช่นฉากสตูดิโอสีพื้น) — ใช้คู่กับ roop_modify_selection ' +
      '(invert เพื่อเลือกวัตถุแทนพื้นหลัง) แล้ว roop_erase_selection เพื่อตัดพื้นหลังออก',
    inputSchema: {
      x: z.number().describe('จุดที่คลิกเลือกสี'),
      y: z.number(),
      seed: z.number().positive().optional().describe('ขนาดจุดเริ่มต้นก่อนขยาย (ค่าเริ่มต้น 3px) — เพิ่มถ้าพื้นหลังมีจุดรบกวน/noise'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.selectSimilar(a), { tool: 'magic_wand', summary: `เลือกสีที่ (${a.x},${a.y})` });
    return r.ok ? ok('เลือกพื้นที่สีใกล้เคียงแล้ว — เช็คด้วย roop_document_info หรือ export ดูก่อนลบจริง') : fail(r.error);
  });

  server.registerTool('roop_modify_selection', {
    title: 'ปรับ selection',
    description: 'ขยาย/หด/ฟุ้งขอบ/สลับด้าน selection ที่เลือกอยู่ตอนนี้',
    inputSchema: {
      action: z.enum(['expand', 'contract', 'feather', 'invert']),
      amount: z.number().min(0).optional().describe('พิกเซล — ไม่ใช้กับ invert'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    let script;
    try { script = P.modifySelection(a); } catch (e) { return fail(e.message); }
    const r = await bridge.run(script, { tool: 'modify_selection', summary: `selection: ${a.action}` });
    return r.ok ? ok('ปรับ selection แล้ว') : fail(r.error);
  });

  server.registerTool('roop_fill_selection', {
    title: 'เติมสีใน selection',
    description: 'เติมสีลง selection ปัจจุบัน (ต้องมี selection อยู่ก่อนจาก roop_select/roop_magic_wand) แล้วยกเลิกการเลือกให้อัตโนมัติ',
    inputSchema: {
      color: hex,
      opacity: z.number().min(0).max(100).optional().describe('0–100, ค่าเริ่มต้น 100'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.fillSelection(a), { tool: 'fill_selection', summary: 'เติมสีใน selection' });
    return r.ok ? ok('เติมสีแล้ว') : fail(r.error);
  });

  server.registerTool('roop_erase_selection', {
    title: 'ลบพิกเซลใน selection (ตัดพื้นหลัง/erase)',
    description:
      'ลบพิกเซลใน selection ปัจจุบันออกจากเลเยอร์ที่กำลังเลือกอยู่ ให้เป็นโปร่งใส — ' +
      'ใช้ทำ cutout/ตัดพื้นหลัง (คู่กับ roop_magic_wand + roop_modify_selection invert) หรือลบส่วนเกินออกจากภาพ ' +
      'ถ้าเลเยอร์เป็น "Background" ที่ล็อกอยู่จะปลดล็อกให้อัตโนมัติก่อนลบ',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async () => {
    const r = await bridge.run(P.eraseSelection(), { tool: 'erase_selection', summary: 'ลบพิกเซลใน selection' });
    return r.ok ? ok('ลบแล้ว') : fail(r.error);
  });

  server.registerTool('roop_deselect', {
    title: 'ยกเลิกการเลือก',
    description: 'ยกเลิก selection ปัจจุบันทั้งหมด (เทียบเท่า Select > Deselect)',
    inputSchema: {},
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    const r = await bridge.run(P.deselect(), { tool: 'deselect', summary: 'ยกเลิกการเลือก' });
    return r.ok ? ok('ยกเลิกการเลือกแล้ว') : fail(r.error);
  });

  server.registerTool('roop_adjust', {
    title: 'ปรับภาพ',
    description: 'ปรับความสว่าง/คอนทราสต์ ทำขาวดำ หรือกลับสี บนเลเยอร์ที่เลือกอยู่',
    inputSchema: {
      brightness: z.number().min(-100).max(100).optional(),
      contrast: z.number().min(-100).max(100).optional(),
      desaturate: z.boolean().optional().describe('ทำเป็นขาวดำ'),
      invert: z.boolean().optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.adjust(a), { tool: 'adjust', summary: 'ปรับภาพ' });
    return r.ok ? ok('ปรับภาพแล้ว') : fail(r.error);
  });

  server.registerTool('roop_resize', {
    title: 'เปลี่ยนขนาด',
    description: 'image = ย่อ/ขยายทั้งภาพ, canvas = เปลี่ยนขนาดผืนผ้าใบ (ครอป/เพิ่มขอบ), cover = ย่อให้เต็มกรอบแล้วครอปกลาง',
    inputSchema: {
      mode: z.enum(['image', 'canvas', 'cover']),
      width: z.number().int().positive().optional(),
      height: z.number().int().positive().optional(),
      preset: z.enum(Object.keys(SOCIAL_SIZES)).optional(),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const size = a.preset ? SOCIAL_SIZES[a.preset] : { width: a.width, height: a.height };
    if (!size.width || !size.height) return fail('ต้องระบุ width+height หรือ preset');
    const script = a.mode === 'cover' ? P.coverResize(size)
      : a.mode === 'canvas' ? P.resizeCanvas(size) : P.resizeImage(size);
    const r = await bridge.run(script, { tool: 'resize', summary: `${a.mode} → ${size.width}×${size.height}` });
    return r.ok ? ok(`เปลี่ยนขนาดเป็น ${size.width}×${size.height} แล้ว`) : fail(r.error);
  });

  server.registerTool('roop_export', {
    title: 'Export ภาพ',
    description: 'export เอกสารที่เปิดอยู่ ถ้าระบุ outputPath จะเซฟลงเครื่อง ถ้าไม่ระบุจะไปโผล่ในแกลเลอรีของหน้า Studio',
    inputSchema: {
      format: z.enum(['png', 'jpg', 'webp', 'psd', 'svg']).optional(),
      quality: z.number().min(0).max(1).optional(),
      outputPath: z.string().optional().describe('พาธไฟล์ปลายทาง เช่น ~/Desktop/cover.png'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const format = a.format || 'png';
    const r = await bridge.run(P.exportDoc({ format, quality: a.quality }), {
      expectFiles: true, tool: 'export', summary: `export ${format}`,
    });
    if (!r.ok) return fail(r.error || 'export ไม่สำเร็จ');
    if (!r.files.length) return fail('Photopea ไม่ได้ส่งไฟล์กลับมา');
    if (a.outputPath) {
      try {
        const p = await writeOut(a.outputPath, r.files[0].data);
        return ok(`บันทึกแล้ว: ${p}`);
      } catch (e) { return fail(`เซฟไฟล์ไม่สำเร็จ: ${e.message}`); }
    }
    return ok(`export เสร็จ (${Math.round(r.files[0].data.length / 1024)} KB) — ดูในแกลเลอรีของหน้า Studio หรือระบุ outputPath ให้เซฟลงเครื่อง`);
  });

  server.registerTool('roop_load_thai_fonts', {
    title: 'โหลดฟอนต์ไทย',
    description:
      'โหลดฟอนต์ไทยเข้า Photopea แล้วคืนชื่อ PostScript ที่เอาไปใส่ในช่อง font ของ roop_add_text ได้ — ' +
      'จำเป็นเพราะฟอนต์ที่ Photopea มีมาให้รองรับภาษาไทยน้อยมาก',
    inputSchema: {
      family: z.array(z.enum(Object.keys(THAI_FONTS))).optional().describe('ค่าเริ่มต้น: plex'),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  }, async (a) => {
    const keys = a.family && a.family.length ? a.family : ['plex'];
    state.thaiFontsLoaded = false; // ขอโหลดตรง ๆ = บังคับโหลดจริง
    const { loaded } = await ensureThaiFonts(bridge, keys);
    if (!loaded.length) return fail('โหลดฟอนต์ไม่สำเร็จ — เช็คว่าเครื่องต่อเน็ตอยู่ไหม');
    return ok(`โหลดฟอนต์แล้ว ใช้ชื่อนี้ในช่อง font ได้เลย:\n${loaded.map((n) => '  ' + n).join('\n')}`);
  });

  server.registerTool('roop_list_fonts', {
    title: 'ดูรายชื่อฟอนต์',
    description: 'รายชื่อ PostScript ของฟอนต์ทั้งหมดใน Photopea (ใส่ search เพื่อกรอง)',
    inputSchema: { search: z.string().optional() },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.listFonts(a.search), { tool: 'list_fonts', summary: 'อ่านรายชื่อฟอนต์' });
    return r.ok ? ok(r.echo) : fail(r.error);
  });

  server.registerTool('roop_undo', {
    title: 'ย้อนกลับ',
    description: 'ย้อนการแก้ไขล่าสุด (ระบุจำนวนขั้นได้)',
    inputSchema: { steps: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.undo(a.steps || 1), { tool: 'undo', summary: `ย้อน ${a.steps || 1} ขั้น` });
    return r.ok ? ok('ย้อนกลับแล้ว') : fail(r.error);
  });

  server.registerTool('roop_run_script', {
    title: 'รันสคริปต์ Photopea ดิบ',
    description:
      'ทางออกสุดท้ายเมื่อ tool อื่นทำไม่ได้ — รันสคริปต์แบบ Photoshop ExtendScript ตรง ๆ ' +
      'ใช้ app.echoToOE(str) เพื่อส่งค่ากลับ และ app.activeDocument.saveToOE("png") เพื่อส่งไฟล์กลับ',
    inputSchema: {
      script: z.string(),
      expectFiles: z.boolean().optional().describe('ตั้ง true ถ้าสคริปต์มี saveToOE'),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async (a) => {
    const r = await bridge.run(P.rawScript(a.script), {
      expectFiles: !!a.expectFiles, tool: 'run_script', summary: 'สคริปต์ดิบ',
    });
    if (!r.ok) return fail(r.error || 'สคริปต์ล้มเหลว');
    return ok(`สำเร็จ${r.echo ? ` · echo: ${r.echo}` : ''}${r.files.length ? ` · ได้ไฟล์ ${r.files.length} ไฟล์ (ดูในแกลเลอรี)` : ''}`);
  });
}
