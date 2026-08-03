// photopea.js — ตัวสร้างสคริปต์ที่ส่งเข้า Photopea
//
// Photopea รับสคริปต์แบบเดียวกับ Photoshop ExtendScript ผ่าน postMessage
// กติกาที่ต้องจำ:
//   - app.echoToOE(str)  → ส่งข้อความกลับหน้าเว็บ (ใช้เป็นค่า return)
//   - doc.saveToOE(fmt)  → ส่งไฟล์ที่ export กลับมาเป็น ArrayBuffer
//   - เมื่อสคริปต์จบ Photopea ส่งสตริง 'done' เสมอ
//
// สคริปต์ในไฟล์นี้ออกแบบให้ "หนึ่งสคริปต์ = หนึ่งงานที่จบในตัว" เพื่อลดจำนวน
// รอบ round-trip และให้ export หลายไฟล์ในสคริปต์เดียวได้

export function esc(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n');
}

export function hexRgb(hex) {
  const h = String(hex).replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function colorVar(name, hex) {
  const { r, g, b } = hexRgb(hex);
  return `var ${name} = new SolidColor(); ${name}.rgb.red = ${r}; ${name}.rgb.green = ${g}; ${name}.rgb.blue = ${b};`;
}

/** helper ที่ฝังหัวสคริปต์ทุกตัว — อ่านขนาดเอกสารเป็นตัวเลขจริง (doc.width เป็น UnitValue) */
const HELPERS = `
function _num(v){ return parseFloat(String(v)); }
function _dims(d){ return { w: _num(d.width), h: _num(d.height) }; }
`.trim();

export function withHelpers(body) {
  return HELPERS + '\n' + body;
}

// ---------------------------------------------------------------------------
// เอกสาร
// ---------------------------------------------------------------------------

export function createDocument({ width, height, name = 'RoopStudio', fill }) {
  const lines = [
    `var _doc = app.documents.add(${width}, ${height}, 72, '${esc(name)}', NewDocumentMode.RGB);`,
  ];
  if (fill) {
    lines.push(colorVar('_fill', fill));
    lines.push(`_doc.selection.selectAll(); _doc.selection.fill(_fill); _doc.selection.deselect();`);
  }
  lines.push(`app.echoToOE('ok');`);
  return lines.join('\n');
}

export function documentInfo() {
  return withHelpers(`
var _d = app.activeDocument;
var _layers = [];
for (var i = 0; i < _d.layers.length; i++) { _layers.push(_d.layers[i].name); }
app.echoToOE(JSON.stringify({
  name: _d.name, width: _num(_d.width), height: _num(_d.height),
  layerCount: _d.layers.length, layers: _layers
}));`.trim());
}

export function resizeImage({ width, height }) {
  return `app.activeDocument.resizeImage(${width}, ${height}, null, ResampleMethod.BICUBIC);\napp.echoToOE('ok');`;
}

export function resizeCanvas({ width, height }) {
  return `app.activeDocument.resizeCanvas(${width}, ${height}, AnchorPosition.MIDDLECENTER);\napp.echoToOE('ok');`;
}

/** ย่อ/ขยายให้เต็มกรอบแล้วครอปกลาง (cover) — ใช้ทำภาพหลายขนาดจากต้นฉบับเดียว */
export function coverResize({ width, height }) {
  return withHelpers(`
var _d = app.activeDocument;
var _s = _dims(_d);
var _scale = Math.max(${width} / _s.w, ${height} / _s.h);
_d.resizeImage(Math.round(_s.w * _scale), Math.round(_s.h * _scale), null, ResampleMethod.BICUBIC);
_d.resizeCanvas(${width}, ${height}, AnchorPosition.MIDDLECENTER);
app.echoToOE('ok');`.trim());
}

// ---------------------------------------------------------------------------
// ข้อความ / รูปทรง
// ---------------------------------------------------------------------------

export function addText({
  content, x, y, font, size, color, align = 'left',
  box, lineHeight, tracking, name,
}) {
  const lines = [
    `var _l = app.activeDocument.artLayers.add();`,
    `_l.kind = LayerKind.TEXT;`,
    `var _t = _l.textItem;`,
  ];
  if (name) lines.push(`_l.name = '${esc(name)}';`);
  if (box) {
    lines.push(`_t.kind = TextType.PARAGRAPHTEXT;`);
    lines.push(`_t.width = ${box.width}; _t.height = ${box.height};`);
  }
  if (font) lines.push(`_t.font = '${esc(font)}';`);
  if (size !== undefined) lines.push(`_t.size = ${size};`);
  if (lineHeight !== undefined) lines.push(`_t.leading = ${lineHeight};`);
  if (tracking !== undefined) lines.push(`_t.tracking = ${tracking};`);
  if (align) {
    const j = { left: 'LEFT', center: 'CENTER', right: 'RIGHT' }[align] || 'LEFT';
    lines.push(`_t.justification = Justification.${j};`);
  }
  if (color) {
    lines.push(colorVar('_tc', color));
    lines.push(`_t.color = _tc;`);
  }
  lines.push(`_t.contents = '${esc(content)}';`);
  lines.push(`_t.position = [${x}, ${y}];`);
  lines.push(`app.echoToOE('ok');`);
  return lines.join('\n');
}

export function addRect({ x, y, width, height, color, opacity = 100, name = 'rect' }) {
  return [
    `var _l = app.activeDocument.artLayers.add();`,
    `_l.name = '${esc(name)}';`,
    `app.activeDocument.selection.select([[${x},${y}],[${x + width},${y}],[${x + width},${y + height}],[${x},${y + height}]]);`,
    colorVar('_rc', color),
    `app.activeDocument.selection.fill(_rc);`,
    `app.activeDocument.selection.deselect();`,
    `_l.opacity = ${opacity};`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Selection — เลือกพื้นที่ก่อนแล้วค่อยเติม/ลบ/ปรับ (คนละขั้นกับ addRect ที่ทำจบในตัว)
//
// กติกาสำคัญ: ทุกฟังก์ชันในกลุ่มนี้ใช้ Selection object ตรง ๆ ของ Photoshop DOM
// (select/expand/contract/feather/invert/fill/clear/similar) — ไม่แตะ
// executeAction/ActionDescriptor เด็ดขาด เพราะ action บางตัว (เช่น colorRange)
// เปิด dialog ค้างใน Photopea แล้วไม่ส่ง echoToOE กลับมาเลย ทำให้คิวทั้งระบบค้าง
// ตาม incident จริงที่เจอ — ห้ามใช้ ActionManager กับ action ที่ต้อง dialog
// ---------------------------------------------------------------------------

/** เลือกพื้นที่สี่เหลี่ยม/วงรี/หลายเหลี่ยม/ทั้งภาพ — feather เป็นพิกเซล (ขอบฟุ้ง) */
export function select({ type = 'rect', x, y, width, height, points, feather = 0 }) {
  const sel = 'app.activeDocument.selection';
  let line;
  if (type === 'all') {
    line = `${sel}.selectAll();`;
  } else if (type === 'ellipse') {
    line = `${sel}.selectEllipse({left: ${x}, top: ${y}, right: ${x + width}, bottom: ${y + height}}, SelectionType.REPLACE, ${feather});`;
  } else if (type === 'polygon') {
    const pts = points.map(([px, py]) => `[${px},${py}]`).join(',');
    line = `${sel}.select([${pts}], SelectionType.REPLACE, ${feather});`;
  } else {
    line = `${sel}.select([[${x},${y}],[${x + width},${y}],[${x + width},${y + height}],[${x},${y + height}]], SelectionType.REPLACE, ${feather});`;
  }
  return `${line}\napp.echoToOE('ok');`;
}

/** ขยาย/หด/ฟุ้งขอบ/สลับด้าน ของ selection ที่มีอยู่ตอนนี้ */
export function modifySelection({ action, amount = 0 }) {
  const sel = 'app.activeDocument.selection';
  const line = {
    expand: `${sel}.expand(${amount});`,
    contract: `${sel}.contract(${amount});`,
    feather: `${sel}.feather(${amount});`,
    invert: `${sel}.invert();`,
  }[action];
  if (!line) throw new Error(`ไม่รู้จัก action "${action}"`);
  return `${line}\napp.echoToOE('ok');`;
}

/** เลือกจุดหนึ่งแล้วขยายไปหาพิกเซลสีใกล้เคียงทั่วเลเยอร์ — แทน "magic wand"
 *  โดยไม่พึ่ง executeAction (ปลอดภัยกว่า colorRange ที่เด้ง dialog ค้าง) */
export function selectSimilar({ x, y, seed = 3 }) {
  return withHelpers(`
var _sel = app.activeDocument.selection;
_sel.select([[${x - seed},${y - seed}],[${x + seed},${y - seed}],[${x + seed},${y + seed}],[${x - seed},${y + seed}]], SelectionType.REPLACE, 0);
_sel.similar();
app.echoToOE('ok');`.trim());
}

/** เติมสีลง selection ปัจจุบัน (ไม่ใช้ selection ต้องมีอยู่ก่อนจาก roop_select) */
export function fillSelection({ color, opacity = 100 }) {
  return [
    colorVar('_fc', color),
    `app.activeDocument.selection.fill(_fc, ColorBlendMode.NORMAL, ${opacity});`,
    `app.activeDocument.selection.deselect();`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

/** ลบพิกเซลใน selection ปัจจุบันออก (โปร่งใสถ้าเลเยอร์มี alpha) — ใช้ตัดพื้นหลัง/ลบส่วนเกิน
 *  แปลงเลเยอร์ "Background" ที่ล็อกอยู่ให้เป็นเลเยอร์ปกติก่อนอัตโนมัติ ไม่งั้นลบไม่ได้ (ไม่มี alpha) */
export function eraseSelection() {
  return [
    `var _al = app.activeDocument.activeLayer;`,
    `if (_al.isBackgroundLayer) _al.isBackgroundLayer = false;`,
    `app.activeDocument.selection.clear();`,
    `app.activeDocument.selection.deselect();`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

export function deselect() {
  return `app.activeDocument.selection.deselect();\napp.echoToOE('ok');`;
}

// ---------------------------------------------------------------------------
// รูป
// ---------------------------------------------------------------------------

/**
 * หลังจากส่ง ArrayBuffer เข้า Photopea แล้ว รูปจะเปิดเป็น "เอกสารใหม่"
 * สคริปต์นี้ย้ายรูปจากเอกสารนั้นเข้าเอกสารเป้าหมาย แล้วปิดตัวต้นทางทิ้ง
 * fit: 'cover' = เต็มกรอบแล้วล้นถูกครอป, 'contain' = เห็นครบทั้งรูป, 'none' = ขนาดเดิม
 */
export function mergeLoadedInto({ targetName, fit = 'cover', x = null, y = null, name = 'image' }) {
  return withHelpers(`
var _src = app.activeDocument;
_src.selection.selectAll();
_src.selection.copy(true);
var _sd = _dims(_src);
_src.close(SaveOptions.DONOTSAVECHANGES);
app.activeDocument = app.documents.getByName('${esc(targetName)}');
var _tgt = app.activeDocument;
_tgt.paste();
var _layer = _tgt.activeLayer;
_layer.name = '${esc(name)}';
var _td = _dims(_tgt);
var _fit = '${fit}';
if (_fit !== 'none') {
  var _scale = _fit === 'cover'
    ? Math.max(_td.w / _sd.w, _td.h / _sd.h)
    : Math.min(_td.w / _sd.w, _td.h / _sd.h);
  _layer.resize(_scale * 100, _scale * 100, AnchorPosition.MIDDLECENTER);
}
${x !== null && y !== null ? `
var _b = _layer.bounds;
_layer.translate(${x} - _num(_b[0]), ${y} - _num(_b[1]));` : ''}
app.echoToOE('ok');`.trim());
}

/**
 * หลังจากส่ง ArrayBuffer (ผลตัดพื้นหลัง) เข้า Photopea แล้ว มันเปิดเป็นเอกสารใหม่
 * สคริปต์นี้ paste เนื้อหานั้นเข้าไปในเอกสารเป้าหมายเป็นเลเยอร์บนสุด แล้วลบเลเยอร์เดิม
 * ทั้งหมดทิ้ง — ผลคือเอกสารเดิม (ชื่อ/ขนาดเดิม) เหลือแค่ภาพที่ตัดพื้นหลังแล้วชั้นเดียว
 */
export function replaceWithLoaded({ targetName, layerName = 'cutout' }) {
  return withHelpers(`
var _src = app.activeDocument;
_src.selection.selectAll();
_src.selection.copy(true);
_src.close(SaveOptions.DONOTSAVECHANGES);
app.activeDocument = app.documents.getByName('${esc(targetName)}');
var _tgt = app.activeDocument;
_tgt.paste();
var _new = _tgt.activeLayer;
_new.name = '${esc(layerName)}';
for (var i = _tgt.layers.length - 1; i >= 0; i--) {
  if (_tgt.layers[i] !== _new) _tgt.layers[i].remove();
}
app.echoToOE('ok');`.trim());
}

export function adjust({ brightness, contrast, desaturate: desat, invert }) {
  const lines = [`var _l = app.activeDocument.activeLayer;`];
  if (brightness !== undefined || contrast !== undefined) {
    lines.push(`_l.adjustBrightnessContrast(${brightness ?? 0}, ${contrast ?? 0});`);
  }
  if (desat) lines.push(`_l.desaturate();`);
  if (invert) lines.push(`_l.invert();`);
  lines.push(`app.echoToOE('ok');`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Layer — จัดการเลเยอร์ (list/add/duplicate/rename/delete/select/reorder/set)
// ทุกฟังก์ชันอ้างเลเยอร์ด้วยชื่อ (artLayers.getByName) ไม่รองรับ layer group/ซ้อนโฟลเดอร์
// ---------------------------------------------------------------------------

const BLEND_MODES = {
  normal: 'NORMAL', multiply: 'MULTIPLY', screen: 'SCREEN', overlay: 'OVERLAY',
  darken: 'DARKEN', lighten: 'LIGHTEN', colorDodge: 'COLORDODGE', colorBurn: 'COLORBURN',
  hardLight: 'HARDLIGHT', softLight: 'SOFTLIGHT', difference: 'DIFFERENCE',
  exclusion: 'EXCLUSION', hue: 'HUE', saturation: 'SATURATION', color: 'COLOR', luminosity: 'LUMINOSITY',
};

export function layerList() {
  return withHelpers(`
var _d = app.activeDocument;
var _out = [];
for (var i = 0; i < _d.layers.length; i++) {
  var _l = _d.layers[i];
  _out.push({
    name: _l.name, index: i, visible: _l.visible,
    opacity: _num(_l.opacity), blendMode: String(_l.blendMode),
    locked: !!_l.allLocked, isBackground: !!_l.isBackgroundLayer,
    kind: String(_l.kind),
  });
}
app.echoToOE(JSON.stringify(_out));`.trim());
}

export function layerAdd({ name = 'layer' }) {
  return [
    `var _l = app.activeDocument.artLayers.add();`,
    `_l.name = '${esc(name)}';`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

export function layerDuplicate({ name, newName }) {
  return [
    `var _l = app.activeDocument.artLayers.getByName('${esc(name)}');`,
    `var _c = _l.duplicate();`,
    newName ? `_c.name = '${esc(newName)}';` : '',
    `app.echoToOE('ok');`,
  ].filter(Boolean).join('\n');
}

export function layerDelete({ name }) {
  return [
    `app.activeDocument.artLayers.getByName('${esc(name)}').remove();`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

/** เลเยอร์ "Background" จริง (isBackgroundLayer) เปลี่ยนชื่อไม่ติด นอกจากปลดล็อกก่อน
 *  (เจอจริงตอนทดสอบ: .name = 'x' รันผ่านไม่ throw แต่ชื่อไม่เปลี่ยน) */
export function layerRename({ name, newName }) {
  return [
    `var _l = app.activeDocument.artLayers.getByName('${esc(name)}');`,
    `if (_l.isBackgroundLayer) _l.isBackgroundLayer = false;`,
    `_l.name = '${esc(newName)}';`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

export function layerSelect({ name }) {
  return [
    `app.activeDocument.activeLayer = app.activeDocument.artLayers.getByName('${esc(name)}');`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

/** ย้ายลำดับเลเยอร์ — ขึ้น/ลงหนึ่งขั้น (สลับกับเลเยอร์ข้าง ๆ) หรือไปสุดบน/สุดล่าง
 *  index 0 = บนสุด (เรียงแบบเดียวกับ layers panel) */
export function layerReorder({ name, direction }) {
  if (!['up', 'down', 'top', 'bottom'].includes(direction)) {
    throw new Error(`ไม่รู้จัก direction "${direction}"`);
  }
  return withHelpers(`
var _d = app.activeDocument;
var _l = _d.artLayers.getByName('${esc(name)}');
var _idx = -1;
for (var i = 0; i < _d.layers.length; i++) { if (_d.layers[i] === _l) { _idx = i; break; } }
var _dir = '${direction}';
if (_dir === 'up' && _idx > 0) {
  _l.move(_d.layers[_idx - 1], ElementPlacement.PLACEBEFORE);
} else if (_dir === 'down' && _idx < _d.layers.length - 1) {
  _l.move(_d.layers[_idx + 1], ElementPlacement.PLACEAFTER);
} else if (_dir === 'top') {
  _l.move(_d, ElementPlacement.PLACEATBEGINNING);
} else if (_dir === 'bottom') {
  _l.move(_d, ElementPlacement.PLACEATEND);
}
app.echoToOE('ok');`.trim());
}

export function layerSet({ name, visible, opacity, blendMode, locked }) {
  const l = `app.activeDocument.artLayers.getByName('${esc(name)}')`;
  const lines = [];
  if (visible !== undefined) lines.push(`${l}.visible = ${!!visible};`);
  if (opacity !== undefined) lines.push(`${l}.opacity = ${opacity};`);
  if (blendMode !== undefined) {
    const bm = BLEND_MODES[blendMode];
    if (!bm) throw new Error(`ไม่รู้จัก blendMode "${blendMode}"`);
    lines.push(`${l}.blendMode = BlendMode.${bm};`);
  }
  if (locked !== undefined) lines.push(`${l}.allLocked = ${!!locked};`);
  lines.push(`app.echoToOE('ok');`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Filter — เอฟเฟกต์บนเลเยอร์ที่กำลังเลือกอยู่ (ArtLayer.applyXxx ตรง ๆ ไม่ผ่าน
// ActionManager เพื่อเลี่ยง dialog ค้าง เหมือนกติกาของกลุ่ม selection ด้านบน)
// ---------------------------------------------------------------------------

export function filter({ type, amount, radius, threshold, angle, monochromatic }) {
  const l = 'app.activeDocument.activeLayer';
  const line = {
    gaussianBlur: `${l}.applyGaussianBlur(${radius ?? 5});`,
    sharpen: `${l}.applySharpen();`,
    sharpenMore: `${l}.applySharpenMore();`,
    unsharpMask: `${l}.applyUnSharpMask(${amount ?? 50}, ${radius ?? 2}, ${threshold ?? 0});`,
    addNoise: `${l}.applyAddNoise(${amount ?? 10}, ${monochromatic ? 'NoiseDistribution.GAUSSIAN' : 'NoiseDistribution.UNIFORM'}, ${!!monochromatic});`,
    motionBlur: `${l}.applyMotionBlur(${angle ?? 0}, ${radius ?? 10});`,
    highPass: `${l}.applyHighPass(${radius ?? 10});`,
    despeckle: `${l}.applyDespeckle();`,
  }[type];
  if (!line) throw new Error(`ไม่รู้จัก filter "${type}"`);
  return `${line}\napp.echoToOE('ok');`;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

function fmtString(format, quality) {
  if ((format === 'jpg' || format === 'webp') && quality !== undefined) {
    return `${format}:${Math.min(1, Math.max(0, quality))}`;
  }
  return format;
}

export function exportDoc({ format = 'png', quality }) {
  return `app.activeDocument.saveToOE('${fmtString(format, quality)}');`;
}

/**
 * export หลายขนาดในสคริปต์เดียว — duplicate เอกสาร, cover-resize, saveToOE, ปิดทิ้ง
 * Photopea จะส่ง ArrayBuffer กลับมาหลายก้อนตามลำดับ sizes แล้วค่อยตามด้วย 'done'
 * (ฝั่งหน้าเว็บของเรารองรับหลายไฟล์ต่อหนึ่งงาน — ต้นฉบับ upstream รับได้ไฟล์เดียว)
 */
export const TEMP_PREFIX = '__roop_tmp';

export function exportSet({ sizes, format = 'png', quality }) {
  const f = fmtString(format, quality);
  const body = sizes.map(({ width, height }, i) => `
_dup = _base.duplicate('${TEMP_PREFIX}_${i}');
app.activeDocument = _dup;
_s = _dims(_dup);
_scale = Math.max(${width} / _s.w, ${height} / _s.h);
_dup.resizeImage(Math.round(_s.w * _scale), Math.round(_s.h * _scale), null, ResampleMethod.BICUBIC);
_dup.resizeCanvas(${width}, ${height}, AnchorPosition.MIDDLECENTER);
_dup.saveToOE('${f}');
app.activeDocument = _base;`.trim()).join('\n');

  // ไม่ปิดเอกสารชั่วคราวในสคริปต์เดียวกับ saveToOE — เก็บกวาดด้วย closeTemps()
  // แยกอีกรอบ เพื่อไม่ให้เสี่ยงว่าไฟล์ถูกส่งกลับไม่ครบ
  return withHelpers(`var _base = app.activeDocument;\nvar _dup, _s, _scale;\n${body}`);
}

/** ปิดเอกสารชั่วคราวทั้งหมดที่สร้างระหว่าง export หลายขนาด */
export function closeTemps() {
  return `
for (var i = app.documents.length - 1; i >= 0; i--) {
  var _d = app.documents[i];
  if (_d.name.indexOf('${TEMP_PREFIX}') === 0) {
    app.activeDocument = _d;
    _d.close(SaveOptions.DONOTSAVECHANGES);
  }
}
app.echoToOE('ok');`.trim();
}

// ---------------------------------------------------------------------------
// ฟอนต์ / ประวัติ / ดิบ
// ---------------------------------------------------------------------------

/** โหลดฟอนต์จาก URL — Photopea เปิดไฟล์ฟอนต์เป็น "เอกสาร" ต้องสลับกลับเอง */
export function loadFont(url) {
  return [
    `var _prev = app.documents.length > 0 ? app.activeDocument.name : null;`,
    `app.open('${esc(url)}');`,
    `if (_prev) { try { app.activeDocument = app.documents.getByName(_prev); } catch (e) {} }`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

export function listFonts(search) {
  const filter = search
    ? `if (_n.toLowerCase().indexOf('${esc(String(search).toLowerCase())}') >= 0) _r.push(_n);`
    : `_r.push(_n);`;
  return `var _r = [];\nfor (var i = 0; i < app.fonts.length; i++) { var _n = app.fonts[i].postScriptName; ${filter} }\napp.echoToOE(JSON.stringify(_r));`;
}

export function undo(steps = 1) {
  return [
    `var _hs = app.activeDocument.historyStates;`,
    `var _t = Math.max(0, _hs.length - 1 - ${steps});`,
    `app.activeDocument.activeHistoryState = _hs[_t];`,
    `app.echoToOE('ok');`,
  ].join('\n');
}

export function rawScript(code) {
  return code;
}
