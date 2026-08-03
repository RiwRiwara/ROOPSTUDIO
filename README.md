# RoopStudio (รูปสตูดิโอ)

MCP server ที่ให้ AI สั่ง **Photopea** (Photoshop ในเบราว์เซอร์ ใช้ฟรี) แต่งรูปให้ —
พร้อม **หน้า Studio ที่เห็นทุกขั้นที่ AI ทำ และกดทำเองได้ด้วย**

แรงบันดาลใจจาก [attalla1/photopea-mcp-server](https://github.com/attalla1/photopea-mcp-server) (MIT)
ซึ่งพิสูจน์ว่าสถาปัตยกรรม MCP → WebSocket → postMessage → Photopea ใช้ได้จริง

> **คู่มือใช้งานเต็ม + ตัวอย่างสั่งงานจริง + วิธีต่อกับ Claude Code / Claude Desktop:
> [USAGE.md](USAGE.md)**

## เริ่มใช้

```bash
pnpm install          # ต้องมี Node >= 18
```

ต่อกับ **Claude Code** (คำสั่งเดียวจบ):

```bash
claude mcp add --scope user roopstudio -- node "/path/to/roopstudio/app/src/index.js"
claude mcp list        # ควรขึ้น  ✔ Connected: roopstudio
```

ต่อกับ **Claude Desktop** — แก้ `claude_desktop_config.json`
(macOS: `~/Library/Application Support/Claude/`, Windows: `%APPDATA%\Claude\`)
แล้วปิด-เปิดแอปใหม่:

```json
{
  "mcpServers": {
    "roopstudio": { "command": "node", "args": ["/path/to/roopstudio/app/src/index.js"] }
  }
}
```

แล้วสั่งเป็นภาษาคนได้เลย เช่น
*"ทำภาพปกโพสต์ พาดหัวว่า 'โค้ดเสร็จแล้วแต่ไปต่อไม่เป็น' ใส่รูป ~/Desktop/bg.jpg เป็นพื้นหลัง เอาทุกขนาด เซฟลง ~/Desktop/covers"*

เบราว์เซอร์จะเปิดหน้า Studio ให้เองตอนมีคำสั่งแรก — ดูมันทำงานสด ๆ ได้ที่นั่น

### ลองแบบไม่ต้องมี AI

```bash
pnpm mock     # Photopea จำลอง (ออฟไลน์) + MCP
pnpm ui       # เปิดหน้า Studio อย่างเดียว ไม่เริ่ม MCP
node src/index.js            # ของจริง: Photopea จริง + MCP
node src/index.js --port 5000
```

## Tools

**งานสำเร็จรูป** — `roop_make_post_cover` (ภาพปกโพสต์ทุกขนาด จัดหน้าใหม่ต่อขนาด
ตัวหนังสือจึงไม่โดนครอป), `roop_export_social_set` (ภาพเดียว → หลายขนาด ครอปกลาง),
`roop_remove_background` (ตัดพื้นหลังด้วย AI ในคำสั่งเดียว — ดูหัวข้อด้านล่าง)

**เลเยอร์ / เอฟเฟกต์** — `roop_layer` (list/add/duplicate/rename/delete/select/reorder/set
opacity-blendMode-visible-lock ของเลเยอร์ — ระบุ `action`), `roop_filter`
(gaussianBlur/sharpen/sharpenMore/unsharpMask/addNoise/motionBlur/highPass/despeckle
บนเลเยอร์ที่กำลังเลือกอยู่)

**Selection** — `roop_select` (rect/ellipse/polygon/all), `roop_magic_wand`
(เลือกตามสีใกล้เคียง เหมาะกับพื้นหลังสีล้วน), `roop_modify_selection`
(expand/contract/feather/invert), `roop_fill_selection`, `roop_erase_selection`,
`roop_deselect`

**ชิ้นส่วนอื่น** — `roop_status`, `roop_create_document`, `roop_document_info`,
`roop_open_image`, `roop_place_image`, `roop_add_text`, `roop_add_rect`,
`roop_adjust`, `roop_resize`, `roop_export`, `roop_load_thai_fonts`,
`roop_list_fonts`, `roop_undo`, `roop_run_script`

## ตัดพื้นหลังด้วย AI (`roop_remove_background`)

`roop_magic_wand` ใช้ได้ดีเฉพาะพื้นหลังสีล้วน/ใกล้เคียงกัน (เช่นฉากสตูดิโอ) —
พื้นหลังซับซ้อนอย่างท้องฟ้า กิ่งไม้ หรือฉากเปิด ต้องนั่งลากหลายเหลี่ยมเอง ได้ขอบไม่เนียน
`roop_remove_background` แก้ปัญหานี้ด้วยโมเดล AI (ผ่าน [`@imgly/background-removal-node`](https://github.com/imgly/background-removal-js),
ONNX รันบน `onnxruntime-node`) ทำ **matting จริง** — ขอบขนสัตว์/เส้นผมฟุ้งได้ตามภาพจริง
ไม่ใช่แค่ threshold สี

- ไม่ระบุ `source` → ตัดเอกสารที่เปิดอยู่ตอนนี้ แล้วแทนที่เลเยอร์เดิมด้วยผลลัพธ์
  (ชื่อ/ขนาดเอกสารเดิม พร้อม export ต่อได้เลย)
- ระบุ `source` (พาธไฟล์/URL) → เปิดรูปนั้นเป็นเอกสารใหม่ที่ตัดพื้นหลังแล้ว
- เลือกขนาดโมเดลด้วย `model`: `small` (เร็ว/หยาบ) · `medium` (ค่าเริ่มต้น) · `large` (แม่น/ช้า)

**ครั้งแรกที่เรียกต้องต่อเน็ต** เพื่อดาวน์โหลดน้ำหนักโมเดล (แคชไว้ในเครื่องอัตโนมัติ)
หลังจากนั้นรันได้แบบออฟไลน์ทั้งหมด — ไฟล์ภาพไม่ถูกส่งออกไปที่ไหนเลย ประมวลผลในเครื่องล้วน ๆ

ติดตั้งครั้งแรกอาจต้องคอมไพล์/ดาวน์โหลด native binary ของ `sharp` และ `onnxruntime-node`
— `pnpm-workspace.yaml` อนุมัติ build script ของสองแพ็กเกจนี้ไว้ล่วงหน้าแล้ว (`allowBuilds`)
ถ้าใช้ npm/yarn แทน pnpm อาจต้องอนุมัติ postinstall เอง

## ทำไมต้องโหลดฟอนต์ไทยเอง

ฟอนต์ที่ Photopea มีมาให้รองรับภาษาไทยน้อยมาก พิมพ์ไทยแล้วได้กล่องสี่เหลี่ยม
RoopStudio จึงโหลด TTF ชุดเต็มจาก Google Fonts เข้า Photopea ให้ (IBM Plex Sans Thai,
Sarabun, Kanit, Prompt) — ใช้ไฟล์ TTF ไม่ใช่ woff2 แบบ subset เพราะ subset "thai"
ไม่มีอักษรละตินติดมาด้วย พาดหัวที่ปนอังกฤษจะพัง

## ความปลอดภัย

server ฟังเฉพาะ `127.0.0.1` · ไฟล์ที่อ่าน/เขียนคือพาธที่ระบุในคำสั่งเท่านั้น ·
รูปทั้งหมดประมวลผลในเบราว์เซอร์ของคุณกับ Photopea ไม่ผ่านเซิร์ฟเวอร์ใครทั้งนั้น ·
`roop_remove_background` ก็เช่นกัน — โมเดล AI รันในเครื่อง (ผ่าน `onnxruntime-node`)
เน็ตถูกใช้แค่ครั้งแรกตอนดาวน์โหลดน้ำหนักโมเดลมาแคช ไม่มีภาพหลุดออกไปไหน

## ที่ยังต้องยืนยันกับ Photopea จริง

โค้ดทั้งหมดทดสอบผ่าน mock ที่ล้อ object model ของ Photopea (สคริปต์ที่ผิดพลาดจะพัง
ตั้งแต่ตรงนั้น) แต่สามข้อนี้ต้องลองกับของจริง: ลำดับการส่งไฟล์เมื่อ `saveToOE` หลายครั้ง
ในสคริปต์เดียว, ชื่อ PostScript ของฟอนต์หลังโหลด และผลการเรนเดอร์สระ/วรรณยุกต์ไทย

โมเดลตัดพื้นหลังของ `roop_remove_background` (ส่วน Node ล้วน ไม่แตะ Photopea) ทดสอบแล้วว่า
ได้ผลลัพธ์ PNG ที่มี alpha จริง — แต่ `replaceWithLoaded`, `roop_layer`, และ `roop_filter`
(ส่วนที่ต้องรันสคริปต์ผ่าน Photopea จริง) ยังทดสอบแค่ผ่าน mock ยังไม่ได้ยืนยันกับ Photopea จริง

## License

MIT — งานต่อยอดจาก photopea-mcp-server (MIT, © attalla1)
