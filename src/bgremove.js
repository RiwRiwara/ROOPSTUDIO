// bgremove.js — ตัดพื้นหลังด้วยโมเดล AI ที่รันในเครื่อง (ไม่ผ่าน API ภายนอก)
//
// ใช้ @imgly/background-removal-node (ONNX ผ่าน onnxruntime-node) ทำ matting จริง
// (ขอบขนฟุ้งได้ ไม่ใช่แค่ตัดตามสี) โมเดลถูกดาวน์โหลดมาแคชไว้ในเครื่องตอนเรียกครั้งแรก
// (ต้องต่อเน็ตครั้งแรกครั้งเดียว) หลังจากนั้นรันออฟไลน์ได้ทั้งหมด — ไม่มีข้อมูลภาพ
// ถูกส่งออกไปที่ไหนเลย

import { removeBackground } from '@imgly/background-removal-node';
import sharp from 'sharp';

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

/**
 * หา bounding box ของ "ตัวแบบหลัก" ในรูปแบบอัตโนมัติ — ใช้โมเดลตัดพื้นหลังตัวเดียวกัน
 * เพื่อหามวลพิกเซลทึบ (ไม่โปร่งใส) แล้วคืนกรอบสี่เหลี่ยมที่ครอบมันพอดี
 * มีประโยชน์ตอนจะจัดองค์ประกอบ/ครอป/วางข้อความหลบตัวแบบ โดยไม่ต้องกะพิกัดเอาเอง
 * @param {Buffer|string} input
 * @param {{model?: 'small'|'medium', alphaThreshold?: number}} opts
 * @returns {Promise<{x:number,y:number,width:number,height:number,imageWidth:number,imageHeight:number}|null>}
 */
export async function detectSubjectBBox(input, { model = 'medium', alphaThreshold = 10 } = {}) {
  const cutout = await removeBackgroundToPng(input, { model });
  const img = sharp(cutout);
  const { width, height } = await img.metadata();
  const { data } = await img.raw().ensureAlpha().toBuffer({ resolveWithObject: true });

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    const rowOffset = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (data[rowOffset + x * 4 + 3] > alphaThreshold) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null; // ไม่เจอตัวแบบ (พื้นหลังล้วน/โปร่งใสทั้งภาพ)
  return {
    x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1,
    imageWidth: width, imageHeight: height,
  };
}
