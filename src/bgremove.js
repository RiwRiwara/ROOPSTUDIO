// bgremove.js — ตัดพื้นหลังด้วยโมเดล AI ที่รันในเครื่อง (ไม่ผ่าน API ภายนอก)
//
// ใช้ @imgly/background-removal-node (ONNX ผ่าน onnxruntime-node) ทำ matting จริง
// (ขอบขนฟุ้งได้ ไม่ใช่แค่ตัดตามสี) โมเดลถูกดาวน์โหลดมาแคชไว้ในเครื่องตอนเรียกครั้งแรก
// (ต้องต่อเน็ตครั้งแรกครั้งเดียว) หลังจากนั้นรันออฟไลน์ได้ทั้งหมด — ไม่มีข้อมูลภาพ
// ถูกส่งออกไปที่ไหนเลย

import { removeBackground } from '@imgly/background-removal-node';

/**
 * ตัดพื้นหลังออกจากรูป คืนค่าเป็น PNG buffer ที่มี alpha channel จริง
 * @param {Buffer|string} input - buffer ของรูป หรือพาธ/URL
 * @param {{model?: 'small'|'medium'|'large'}} opts
 * @returns {Promise<Buffer>}
 */
export async function removeBackgroundToPng(input, { model = 'medium' } = {}) {
  // Buffer เป็น Uint8Array — ไลบรารีห่อเป็น Blob เองถ้าเจอ ArrayBuffer/TypedArray
  // แต่ไม่ใส่ type ให้ (blob.type ว่าง) ทำให้ตัว sniff format ข้างในพังด้วย
  // "Unsupported format:" ต้องห่อเป็น Blob พร้อมระบุ type ให้เองก่อน
  const image = Buffer.isBuffer(input) ? new Blob([input], { type: 'image/png' }) : input;
  const blob = await removeBackground(image, {
    model,
    output: { format: 'image/png', quality: 1 },
  });
  return Buffer.from(await blob.arrayBuffer());
}
