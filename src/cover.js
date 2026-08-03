// cover.js — สูตรจัดหน้า "ภาพปกโพสต์" หนึ่งขนาด = หนึ่งสคริปต์
//
// นี่คือหัวใจของ RoopStudio: แทนที่จะให้ AI สั่งทีละ 15 คำสั่ง (สร้างเอกสาร →
// วางรูป → ย่อ → ใส่แผ่นบัง → ใส่ข้อความ → ...) เราให้ tool เดียวที่รู้สูตรจัดหน้า
// แล้วออกมาถูกต้องทุกอัตราส่วน เพราะจัดหน้าใหม่ต่อขนาด ไม่ใช่ครอปจากภาพเดียว
// (ครอปจากภาพเดียวคือสิ่งที่ทำให้ตัวหนังสือโดนตัดหัวตัดท้าย)

import { esc, hexRgb, TEMP_PREFIX } from './photopea.js';

function solid(name, hex) {
  const { r, g, b } = hexRgb(hex);
  return `var ${name} = new SolidColor(); ${name}.rgb.red = ${r}; ${name}.rgb.green = ${g}; ${name}.rgb.blue = ${b};`;
}

/** สัดส่วนทุกอย่างอิงความกว้าง/สูงของภาพ เพื่อให้ story กับ og ออกมาสมดุลเท่ากัน */
export function layoutFor(width, height) {
  const m = Math.round(width * 0.075);
  return {
    margin: m,
    headlineSize: Math.round(width * 0.072),
    subtitleSize: Math.round(width * 0.034),
    brandSize: Math.round(width * 0.026),
    boxWidth: width - m * 2,
    boxHeight: Math.round(height * 0.28),
    headlineTop: Math.round(height * 0.38),
    ruleTop: Math.round(height * 0.38) - Math.round(height * 0.055),
    ruleWidth: Math.round(width * 0.1),
    ruleHeight: Math.max(3, Math.round(height * 0.006)),
    gap: Math.round(height * 0.03),
  };
}

/**
 * สร้างสคริปต์ประกอบภาพปกหนึ่งขนาดจนถึงขั้น export
 * @param {object} o
 * @param {number} o.width @param {number} o.height
 * @param {object} o.theme  {background, headline, subtitle, scrim}
 * @param {string} o.headline @param {string} [o.subtitle] @param {string} [o.brandMark]
 * @param {string} o.fontBold @param {string} o.fontRegular
 * @param {string|null} o.bgDocName ชื่อเอกสารรูปพื้นหลังที่เปิดค้างไว้ (ถ้ามี)
 * @param {string} o.format
 * @param {number} o.index
 */
export function buildCover(o) {
  const {
    width, height, theme, headline, subtitle, brandMark,
    fontBold, fontRegular, bgDocName, format, index,
  } = o;
  const L = layoutFor(width, height);
  const docName = `${TEMP_PREFIX}_cover_${index}`;
  const lines = [];

  lines.push(`function _num(v){ return parseFloat(String(v)); }`);
  lines.push(`var _doc = app.documents.add(${width}, ${height}, 72, '${docName}', NewDocumentMode.RGB);`);
  lines.push(solid('_bg', theme.background));
  lines.push(`_doc.selection.selectAll(); _doc.selection.fill(_bg); _doc.selection.deselect();`);

  // พื้นหลังรูป — ก๊อปจากเอกสารที่เปิดค้างไว้ แล้วขยายให้เต็มกรอบ (cover)
  if (bgDocName) {
    lines.push(`
var _bgd = app.documents.getByName('${esc(bgDocName)}');
app.activeDocument = _bgd;
var _bw = _num(_bgd.width), _bh = _num(_bgd.height);
_bgd.selection.selectAll(); _bgd.selection.copy(true); _bgd.selection.deselect();
app.activeDocument = _doc;
_doc.paste();
var _bl = _doc.activeLayer; _bl.name = 'background';
var _sc = Math.max(${width} / _bw, ${height} / _bh) * 100;
_bl.resize(_sc, _sc, AnchorPosition.MIDDLECENTER);`.trim());
  }

  // แผ่นบังให้ตัวหนังสืออ่านออกเวลาทับรูป
  if (theme.scrim) {
    lines.push(`var _sl = _doc.artLayers.add(); _sl.name = 'scrim';`);
    lines.push(`_doc.selection.select([[0,0],[${width},0],[${width},${height}],[0,${height}]]);`);
    lines.push(solid('_sc2', theme.scrim.color));
    lines.push(`_doc.selection.fill(_sc2); _doc.selection.deselect();`);
    lines.push(`_sl.opacity = ${theme.scrim.opacity};`);
  }

  // เส้นขีดสั้น ๆ เหนือพาดหัว — ลายเซ็นงานดีไซน์แบบ editorial
  lines.push(`var _rl = _doc.artLayers.add(); _rl.name = 'rule';`);
  lines.push(`_doc.selection.select([[${L.margin},${L.ruleTop}],[${L.margin + L.ruleWidth},${L.ruleTop}],[${L.margin + L.ruleWidth},${L.ruleTop + L.ruleHeight}],[${L.margin},${L.ruleTop + L.ruleHeight}]]);`);
  lines.push(solid('_rc', theme.headline));
  lines.push(`_doc.selection.fill(_rc); _doc.selection.deselect();`);

  // พาดหัว (กล่องข้อความ ตัดบรรทัดเอง)
  lines.push(`
var _hl = _doc.artLayers.add(); _hl.kind = LayerKind.TEXT; _hl.name = 'headline';
var _ht = _hl.textItem;
_ht.kind = TextType.PARAGRAPHTEXT;
_ht.width = ${L.boxWidth}; _ht.height = ${L.boxHeight};
_ht.font = '${esc(fontBold)}';
_ht.size = ${L.headlineSize};
_ht.leading = ${Math.round(L.headlineSize * 1.25)};
_ht.justification = Justification.LEFT;
${solid('_hc', theme.headline)}
_ht.color = _hc;
_ht.contents = '${esc(headline)}';
_ht.position = [${L.margin}, ${L.headlineTop}];`.trim());

  if (subtitle) {
    const subTop = L.headlineTop + L.boxHeight + L.gap;
    lines.push(`
var _sl2 = _doc.artLayers.add(); _sl2.kind = LayerKind.TEXT; _sl2.name = 'subtitle';
var _st = _sl2.textItem;
_st.kind = TextType.PARAGRAPHTEXT;
_st.width = ${L.boxWidth}; _st.height = ${Math.round(L.subtitleSize * 3.2)};
_st.font = '${esc(fontRegular)}';
_st.size = ${L.subtitleSize};
_st.leading = ${Math.round(L.subtitleSize * 1.45)};
${solid('_stc', theme.subtitle)}
_st.color = _stc;
_st.contents = '${esc(subtitle)}';
_st.position = [${L.margin}, ${subTop}];`.trim());
  }

  if (brandMark) {
    lines.push(`
var _bm = _doc.artLayers.add(); _bm.kind = LayerKind.TEXT; _bm.name = 'brand';
var _bt = _bm.textItem;
_bt.font = '${esc(fontRegular)}';
_bt.size = ${L.brandSize};
_bt.tracking = 120;
${solid('_bc', theme.subtitle)}
_bt.color = _bc;
_bt.contents = '${esc(brandMark)}';
_bt.position = [${L.margin}, ${height - L.margin}];`.trim());
  }

  lines.push(`_doc.saveToOE('${format}');`);
  return lines.join('\n');
}
