# RoopStudio (รูปสตูดิโอ)

MCP server ที่ให้ AI สั่ง **Photopea** (Photoshop ในเบราว์เซอร์ ใช้ฟรี) แต่งรูปให้ —
พร้อม **หน้า Studio ที่เห็นทุกขั้นที่ AI ทำ และกดทำเองได้ด้วย**

ต่อยอดจาก [attalla1/photopea-mcp-server](https://github.com/attalla1/photopea-mcp-server) (MIT)
ซึ่งพิสูจน์ว่าสถาปัตยกรรม MCP → WebSocket → postMessage → Photopea ใช้ได้จริง

## ต่างจากต้นทางตรงไหน

| | ต้นทาง | RoopStudio |
|---|---|---|
| หน้าเว็บ | สะพานเปล่า ๆ (สถานะ + log) | Studio: ไทม์ไลน์ภาษาไทย, แกลเลอรีรูปที่ export, ปุ่มลัดกดเอง |
| tools | 34 คำสั่งดิบ | 16 — มี**คำสั่งระดับงาน** เช่น ทำภาพปกโพสต์ครบทุกขนาดในคำสั่งเดียว |
| ภาษาไทย | ไม่มี | โหลดฟอนต์ไทยให้อัตโนมัติ + UI ไทย + สูตรจัดหน้าที่เผื่อความสูงบรรทัดไทย |
| ไฟล์ต่อหนึ่งงาน | 1 ไฟล์ | หลายไฟล์ (export หลายขนาดในสคริปต์เดียว) |
| สคริปต์พัง | รายงานว่า "สำเร็จ" | ห่อ try/catch แล้วรายงานข้อความ error จริง |
| คิวงาน | ไม่มี — ผู้ใช้แตะอะไรระหว่าง AI ทำงานแล้วชนกัน | คิวเดียวฝั่งเบราว์เซอร์ ทั้งงาน AI และปุ่มที่คนกด |
| ทดสอบ/เดโม | ต้องต่อเน็ต + Photopea จริง | มี `--mock` จำลอง Photopea ทั้ง object model รันออฟไลน์ได้ |

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
ตัวหนังสือจึงไม่โดนครอป), `roop_export_social_set` (ภาพเดียว → หลายขนาด ครอปกลาง)

**ชิ้นส่วน** — `roop_status`, `roop_create_document`, `roop_document_info`,
`roop_open_image`, `roop_place_image`, `roop_add_text`, `roop_add_rect`,
`roop_adjust`, `roop_resize`, `roop_export`, `roop_load_thai_fonts`,
`roop_list_fonts`, `roop_undo`, `roop_run_script`

## ทำไมต้องโหลดฟอนต์ไทยเอง

ฟอนต์ที่ Photopea มีมาให้รองรับภาษาไทยน้อยมาก พิมพ์ไทยแล้วได้กล่องสี่เหลี่ยม
RoopStudio จึงโหลด TTF ชุดเต็มจาก Google Fonts เข้า Photopea ให้ (IBM Plex Sans Thai,
Sarabun, Kanit, Prompt) — ใช้ไฟล์ TTF ไม่ใช่ woff2 แบบ subset เพราะ subset "thai"
ไม่มีอักษรละตินติดมาด้วย พาดหัวที่ปนอังกฤษจะพัง

## ความปลอดภัย

server ฟังเฉพาะ `127.0.0.1` · ไฟล์ที่อ่าน/เขียนคือพาธที่ระบุในคำสั่งเท่านั้น ·
รูปทั้งหมดประมวลผลในเบราว์เซอร์ของคุณกับ Photopea ไม่ผ่านเซิร์ฟเวอร์ใครทั้งนั้น

## ที่ยังต้องยืนยันกับ Photopea จริง

โค้ดทั้งหมดทดสอบผ่าน mock ที่ล้อ object model ของ Photopea (สคริปต์ที่ผิดพลาดจะพัง
ตั้งแต่ตรงนั้น) แต่สามข้อนี้ต้องลองกับของจริง: ลำดับการส่งไฟล์เมื่อ `saveToOE` หลายครั้ง
ในสคริปต์เดียว, ชื่อ PostScript ของฟอนต์หลังโหลด และผลการเรนเดอร์สระ/วรรณยุกต์ไทย

## License

MIT — งานต่อยอดจาก photopea-mcp-server (MIT, © attalla1)
