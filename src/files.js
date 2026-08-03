// files.js — อ่าน/เขียนไฟล์ฝั่งเครื่องผู้ใช้ และดึงรูปจาก URL
import { readFile, writeFile, mkdir } from 'fs/promises';
import { homedir } from 'os';
import { dirname, resolve, extname } from 'path';

export function expandPath(p) {
  if (!p) return p;
  const s = p.startsWith('~') ? p.replace(/^~/, homedir()) : p;
  return resolve(s);
}

export function isUrl(s) {
  return /^https?:\/\//i.test(String(s));
}

export async function readSource(source) {
  if (isUrl(source)) {
    const res = await fetch(source);
    if (!res.ok) throw new Error(`โหลด URL ไม่สำเร็จ (${res.status}): ${source}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const p = expandPath(source);
  try {
    return await readFile(p);
  } catch {
    throw new Error(`อ่านไฟล์ไม่ได้: ${p}`);
  }
}

export async function writeOut(path, buffer) {
  const p = expandPath(path);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, buffer);
  return p;
}

export function extFor(mimeType, fallback = 'png') {
  const map = {
    'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp',
    'image/svg+xml': 'svg', 'application/photoshop': 'psd', 'image/vnd.adobe.photoshop': 'psd',
  };
  return map[mimeType] || fallback;
}

export function withExt(path, ext) {
  return extname(path) ? path : `${path}.${ext}`;
}
