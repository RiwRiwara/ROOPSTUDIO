// presets.js — ขนาดโซเชียล, ฟอนต์ไทย, และ preset ตาม Brand CI
// ทั้ง MCP tools และ Studio UI ใช้ชุดเดียวกัน (UI ดึงผ่าน GET /api/presets)

/** ขนาดมาตรฐานของแต่ละแพลตฟอร์ม — ใช้ทั้งใน export_social_set และปุ่มใน UI */
export const SOCIAL_SIZES = {
  og: { width: 1200, height: 630, label: 'OG / Facebook link (1200×630)' },
  square: { width: 1080, height: 1080, label: 'IG / FB square (1080×1080)' },
  portrait: { width: 1080, height: 1350, label: 'IG portrait (1080×1350)' },
  story: { width: 1080, height: 1920, label: 'Story / Reels (1080×1920)' },
  x: { width: 1600, height: 900, label: 'X / Twitter (1600×900)' },
  youtube: { width: 1280, height: 720, label: 'YouTube thumbnail (1280×720)' },
};

export const DEFAULT_SET = ['og', 'square', 'story'];

/**
 * ฟอนต์ไทยที่โหลดเข้า Photopea ได้ — ใช้ไฟล์ TTF ชุดเต็ม (มีทั้งอักษรไทยและละติน)
 * ไม่ใช้ woff2 แบบ subset เพราะ subset "thai" ไม่มีอักษรละตินติดมาด้วย
 * postScriptName คือชื่อที่ต้องส่งให้ textItem.font หลังโหลดเสร็จ
 */
export const THAI_FONTS = {
  plex: {
    label: 'IBM Plex Sans Thai (ฟอนต์แบรนด์)',
    regular: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansthai/IBMPlexSansThai-Regular.ttf',
      postScriptName: 'IBMPlexSansThai',
    },
    bold: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/ibmplexsansthai/IBMPlexSansThai-Bold.ttf',
      postScriptName: 'IBMPlexSansThai-Bold',
    },
  },
  sarabun: {
    label: 'Sarabun (สารบรรณ — ทางการ อ่านง่าย)',
    regular: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Regular.ttf',
      postScriptName: 'Sarabun',
    },
    bold: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/sarabun/Sarabun-Bold.ttf',
      postScriptName: 'Sarabun-Bold',
    },
  },
  kanit: {
    label: 'Kanit (พาดหัวหนา ๆ)',
    bold: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/kanit/Kanit-Bold.ttf',
      postScriptName: 'Kanit-Bold',
    },
  },
  prompt: {
    label: 'Prompt (พาดหัวโมเดิร์น)',
    bold: {
      url: 'https://raw.githubusercontent.com/google/fonts/main/ofl/prompt/Prompt-Bold.ttf',
      postScriptName: 'Prompt-Bold',
    },
  },
};

/** ธีมภาพปกโพสต์ — ค่าเริ่มต้นตาม AI วันละเจค Brand CI (ขาวดำล้วน) */
export const COVER_THEMES = {
  ink: {
    label: 'Ink on Paper (CI หลัก)',
    background: '#fafaf7',
    headline: '#111111',
    subtitle: '#3d3d3d',
    scrim: null,
  },
  inverse: {
    label: 'Paper on Ink (สลับขั้ว)',
    background: '#111111',
    headline: '#fafaf7',
    subtitle: '#e8e8e4',
    scrim: null,
  },
  photo: {
    label: 'ทับบนรูป (มีแผ่นบังให้อ่านออก)',
    background: '#111111',
    headline: '#fafaf7',
    subtitle: '#e8e8e4',
    scrim: { color: '#111111', opacity: 55 },
  },
};

/** ปุ่มลัดใน Studio UI ที่ผู้ใช้กดเองได้ ไม่ต้องรอ AI */
export const QUICK_ACTIONS = [
  { id: 'export_png', label: 'Export PNG', hint: 'บันทึกไฟล์ที่เปิดอยู่เป็น PNG' },
  { id: 'export_jpg', label: 'Export JPG', hint: 'JPG คุณภาพ 90%' },
  { id: 'export_set', label: 'Export ทุกขนาดโซเชียล', hint: 'OG + Square + Story ในคลิกเดียว' },
  { id: 'load_thai', label: 'โหลดฟอนต์ไทย', hint: 'IBM Plex Sans Thai + Sarabun เข้า Photopea' },
  { id: 'undo', label: 'ย้อน 1 ขั้น', hint: 'ยกเลิกสิ่งที่เพิ่งทำ' },
  { id: 'doc_info', label: 'ดูข้อมูลไฟล์', hint: 'ขนาด · จำนวนเลเยอร์ · โหมดสี' },
];

export function presetPayload() {
  return {
    socialSizes: SOCIAL_SIZES,
    defaultSet: DEFAULT_SET,
    thaiFonts: THAI_FONTS,
    coverThemes: COVER_THEMES,
    quickActions: QUICK_ACTIONS,
  };
}
