# 📦 ReadyStock — ระบบคลังสินค้าสำนักงาน

เว็บแอปสำหรับบันทึกและติดตามของใช้/อุปกรณ์ในแต่ละสำนักงาน (SH666, SH999, UB89, 88F)
ใช้งานง่าย หน้าจอภาษาไทยทั้งหมด ออกแบบมาให้ใช้บนจอโน้ตบุ๊ก

## คุณสมบัติ

- **รายการสินค้า** — ตารางแสดง รหัสสินค้า / ชื่อ / หมวดหมู่ / สำนักงาน / จำนวน / หน่วย / หมายเหตุ / ผู้แก้ไขล่าสุด
  - **รหัสสินค้าออกให้อัตโนมัติต่อหมวดหมู่** เช่น `TLP0001`, `COM0001`
  - ค้นหาได้ทั้งชื่อและรหัสสินค้า กรองตามสำนักงานและหมวดหมู่ กรองเฉพาะของที่หมด
  - แถบสรุป: จำนวนรายการที่พบ จำนวนรวม และจำนวนสินค้าที่หมด
  - สินค้าที่จำนวนเป็น 0 จะขึ้นป้ายแดง **"หมด"** และไฮไลต์ทั้งแถว
  - รองรับสินค้าหลักพันรายการ แบ่งหน้าละ 50
- **เพิ่ม / แก้ไข / ลบสินค้า** — ลบต้องยืนยันก่อนเสมอ ทุกการกระทำถูกบันทึกไว้
- **ประวัติการใช้งาน** — ดูได้ว่าใครทำอะไรกับสินค้าตัวไหน เมื่อไหร่ (ผู้ใช้ทุกคนดูได้)
- **หน้าจัดการระบบ (เฉพาะ admin)** — เพิ่ม/แก้ชื่อ/ลบ สำนักงานและหมวดหมู่, **จัดลำดับหมวดหมู่ด้วยการลากหรือปุ่ม ↑ ↓**,
  ตั้งรหัสนำหน้าของแต่ละหมวดหมู่, จัดการผู้ใช้ (ตั้งรหัสผ่านใหม่ / เปลี่ยนสิทธิ์ / ลบ),
  สร้างรหัสเชิญแบบสุ่มทีละหลายรหัสพร้อมปุ่มคัดลอก
- **Export Excel (.xlsx)** — ดาวน์โหลดรายการสินค้าตามตัวกรองที่เลือกอยู่
- **Health check** — `GET /healthz` สำหรับ monitoring

## เทคโนโลยีที่ใช้

| ส่วน | เทคโนโลยี |
| --- | --- |
| Runtime | Node.js 20+ |
| Web framework | Express 4 |
| ฐานข้อมูล | SQLite ผ่าน better-sqlite3 (ไฟล์เดียว ไม่ต้องติดตั้ง DB server) |
| หน้าเว็บ | EJS render ฝั่งเซิร์ฟเวอร์ + vanilla JS/CSS (ไม่มี build step) |
| รหัสผ่าน | scrypt จาก `node:crypto` (ไม่ใช้ bcrypt จึงไม่ต้อง compile เพิ่ม) |
| Session | express-session เก็บใน SQLite, cookie แบบ HttpOnly + SameSite=Lax + Secure |
| Excel | exceljs |
| ตัวจัดการโปรเซส | PM2 |

## โครงสร้างโปรเจกต์

```
src/
  server.js            จุดเริ่มต้น (อ่าน .env, เปิดฐานข้อมูล, listen)
  app.js               ประกอบ Express app + middleware
  db.js                เปิด SQLite, สร้าง schema, ใส่ข้อมูลตั้งต้น
  auth.js              scrypt hash/verify + ตัวจำกัดจำนวนครั้ง login
  middleware.js        requireAuth / requireAdmin / CSRF / flash
  format.js            แปลงเวลา UTC ในฐานข้อมูลเป็นเวลาไทยสำหรับแสดงผล
  codes.js             สร้างรหัสนำหน้าหมวดหมู่ และออกเลขรหัสสินค้า
  session-store.js     เก็บ session ไว้ในตาราง sessions ของ SQLite
  routes/              auth, items (+export), logs, admin
  services/            logic หลัก: users, invites, items, taxonomy, logs
  views/               หน้าเว็บ EJS ภาษาไทย
  public/              CSS และ JS ฝั่ง client
test/                  unit test + test ระดับ HTTP (node:test)
data/                  ไฟล์ฐานข้อมูล readystock.sqlite (ไม่ commit ขึ้น git)
ecosystem.config.js    ไฟล์ตั้งค่า PM2
```

## ฐานข้อมูล

สร้างอัตโนมัติตอนรันครั้งแรก ไม่ต้องรันสคริปต์ migration เอง

| ตาราง | คอลัมน์ |
| --- | --- |
| `users` | id, username (unique), password_hash, role (admin/user), created_at |
| `offices` | id, name (unique), created_at — ตั้งต้น: SH666, SH999, UB89, 88F |
| `categories` | id, name (unique), code_prefix (unique), sort_order, created_at — ตั้งต้น: โทรศัพท์ (TLP), คอมพิวเตอร์ (COM), อื่นๆ (OTH) |
| `items` | id, item_code (unique), name, category_id, office_id, quantity (>= 0), unit, note, created_at, updated_at, updated_by |
| `activity_logs` | id, user_id, action (create/update/delete), item_name, detail, created_at |
| `invite_codes` | id, code (unique), created_by, created_at, expires_at, used_by, used_at |
| `sessions` | sid, data, expires_at (ใช้เก็บ session ของ express-session) |

## รหัสสินค้าอัตโนมัติ

สินค้าทุกชิ้นได้ **รหัสสินค้า (item_code)** ให้อัตโนมัติตอนเพิ่มเข้าระบบ ไม่ต้องกรอกเอง
รูปแบบคือ `{รหัสนำหน้าของหมวดหมู่}{เลข 4 หลัก}` เช่น `TLP0001`, `TLP0002`, `COM0001`

- **เลขนับแยกอิสระต่อหมวดหมู่** — โทรศัพท์นับ TLP0001, TLP0002... ส่วนคอมพิวเตอร์นับ COM0001 ของตัวเอง
- **รหัสนำหน้า (code_prefix)** ของแต่ละหมวดหมู่สร้างให้อัตโนมัติตอนเพิ่มหมวดหมู่ใหม่
  - ชื่อภาษาอังกฤษ → ใช้ 3 ตัวแรก เช่น `Furniture` → `FUR`
  - ชื่อภาษาไทย → ถอดพยัญชนะเป็นอักษรโรมัน เช่น `เครื่องเขียน` → `KRO`
  - ชื่อสั้นหรือไม่มีตัวอักษรที่ใช้ได้ → ใช้ค่าสำรอง `CAT`
  - **ถ้าชนกับหมวดหมู่ที่มีอยู่แล้วจะต่อเลขท้ายให้เอง** เช่น `TLP`, `TLP2`, `TLP3`
  - แอดมินพิมพ์รหัสนำหน้าที่ต้องการเองได้ตอนสร้าง หรือแก้ทีหลังที่หน้า "จัดการระบบ"
- **ย้ายหมวดหมู่แล้วรหัสเดิมไม่เปลี่ยน** — สินค้าที่ออกรหัส `TLP0001` ไปแล้ว ต่อให้ย้ายไปหมวดคอมพิวเตอร์
  รหัสก็ยังเป็น `TLP0001` เหมือนเดิม (ไม่ออกรหัสใหม่ให้) และเลขนั้นจะไม่ถูกนำไปใช้ซ้ำในหมวดเดิม
- **เปลี่ยนรหัสนำหน้าของหมวดหมู่** มีผลกับสินค้าที่เพิ่มใหม่เท่านั้น ของเดิมยังใช้รหัสเดิม
- **ค้นหาด้วยรหัสได้** — ช่องค้นหาในหน้ารายการสินค้าค้นได้ทั้งชื่อและรหัส พิมพ์บางส่วนก็ได้
  (เช่น พิมพ์ `TLP` เพื่อดูทั้งหมวด หรือ `tlp0001` โดยไม่ต้องสนตัวพิมพ์เล็ก-ใหญ่)
- รหัสสินค้าแสดงเป็นคอลัมน์แรกของตาราง และมีอยู่ในไฟล์ Excel ที่ export ด้วย

> หมายเหตุ: เลขลำดับถัดไปนับจาก "เลขสูงสุดที่มีอยู่จริงในหมวดนั้น"
> ถ้าลบสินค้าตัวที่เลขสูงสุดออกไป เลขนั้นจะว่างลงและถูกนำมาใช้กับสินค้าใหม่ที่เพิ่มถัดไป
> (ประวัติการใช้งานยังบันทึกไว้ครบว่ารหัสนั้นเคยเป็นของอะไรและถูกลบเมื่อไหร่)

การออกรหัสทำอยู่ใน transaction แบบ IMMEDIATE ร่วมกับ UNIQUE index บน `items.item_code`
ต่อให้มีคนกดเพิ่มสินค้าหมวดเดียวกันพร้อมกัน ก็จะไม่ได้รหัสซ้ำกัน

## ลำดับการแสดงหมวดหมู่

หมวดหมู่มีคอลัมน์ `sort_order` กำหนดลำดับการแสดงผลเอง (ไม่ได้เรียงตามชื่อหรือ id)

- แอดมินจัดลำดับได้ที่หน้า "จัดการระบบ → หมวดหมู่" โดย **ลากแถวสลับตำแหน่ง** แล้วกด "บันทึกลำดับใหม่"
  หรือใช้ **ปุ่ม ↑ ↓** เลื่อนทีละอันดับ (ปุ่มใช้ได้แม้ปิด JavaScript)
- ลำดับนี้มีผลกับ **ดรอปดาวน์เลือกหมวดหมู่ทุกที่** ทั้งฟอร์มเพิ่ม/แก้ไขสินค้า และตัวกรองหน้ารายการสินค้า
- หมวดหมู่ที่สร้างใหม่จะต่อท้ายลำดับล่าสุดให้อัตโนมัติ
- สำนักงานยังเรียงตามชื่อเหมือนเดิม

## การสมัครสมาชิกและสิทธิ์ (ระบบรหัสเชิญแบบใช้ครั้งเดียว)

การสมัครใช้ **รหัสเชิญแบบสุ่ม 1 รหัสต่อ 1 คน** ที่ผู้ดูแลระบบกดสร้างจากหน้าเว็บ
(ไม่ใช่รหัสเดียวใช้ร่วมกันทุกคนแบบเดิม จึงรู้ได้ว่ารหัสไหนใครเอาไปใช้ และรหัสที่หลุดออกไปก็ใช้ได้แค่ครั้งเดียว)

**ผู้ใช้คนแรกของระบบ** สมัครได้ทันทีโดยไม่ต้องใช้รหัสเชิญ (เพราะยังไม่มีใครสร้างรหัสให้ได้)
และจะได้สิทธิ์ **admin** โดยอัตโนมัติ

**ขั้นตอนรับพนักงานคนถัดไป**

1. admin เข้าหน้า **จัดการระบบ → รหัสเชิญ** ใส่จำนวนที่ต้องการ (เช่น พิมพ์ `15` แล้วกดครั้งเดียวได้ 15 รหัส) กด "สร้างรหัสเชิญ"
2. กดปุ่ม "คัดลอก" ข้างรหัส แล้วส่งให้พนักงานคนละรหัส
3. พนักงานเข้าหน้า `/register` กรอกชื่อผู้ใช้ + รหัสผ่าน + รหัสเชิญ
4. สมัครสำเร็จ รหัสนั้นจะถูกทำเครื่องหมายว่า "ใช้แล้ว" พร้อมชื่อคนที่ใช้และเวลาที่ใช้ — ใช้ซ้ำไม่ได้อีก

**คุณสมบัติของรหัสเชิญ**

- สุ่มด้วย `crypto.randomBytes` ยาว 8 ตัวอักษรแบบ base32 ที่ตัดตัวสับสนออกแล้ว (ไม่มี `0`, `O`, `1`, `I`, `L`)
- **หมดอายุใน 24 ชั่วโมง** นับจากเวลาที่สร้าง
- **ใช้ได้ครั้งเดียว** — สมัครสำเร็จแล้วรหัสจะถูกปิดทันที
- ตอนสมัคร ระบบไม่สนตัวพิมพ์เล็ก-ใหญ่ และตัดช่องว่าง/ขีดคั่นให้อัตโนมัติ
- ตารางในหน้า admin แสดงทุกรหัสพร้อมสถานะ (ยังไม่ใช้ / ใช้แล้วโดยใคร / หมดอายุแล้ว) โดยเรียงรหัสที่ยังใช้ได้ไว้บนสุด
- ข้อความ error ตอนสมัครแยกกรณีชัดเจน: รหัสไม่ถูกต้อง / รหัสถูกใช้ไปแล้ว / รหัสหมดอายุแล้ว

ความปลอดภัยที่ใส่ไว้ให้:
- รหัสผ่านเก็บเป็น scrypt hash พร้อม salt สุ่มรายคน
- กรอกรหัสผิดครบ 5 ครั้ง IP นั้นจะถูกล็อก 15 นาที
- ทุกฟอร์มมี CSRF token
- ระบบไม่ยอมให้ลบ/ลดสิทธิ์จนไม่เหลือ admin ในระบบ
- รหัสเชิญที่ใช้ไปแล้วยังคงสถานะ "ใช้แล้ว" ตลอดไป แม้ผู้ใช้คนนั้นจะถูกลบไปแล้วก็ตาม

---

# วิธีติดตั้งบน VPS (Ubuntu 24.04 + PM2 + nginx)

## 1. เตรียมเครื่อง

```bash
# ติดตั้ง Node.js 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs build-essential git nginx

# ติดตั้ง PM2 แบบ global
sudo npm install -g pm2
```

## 2. ดึงโค้ดและติดตั้ง dependencies

```bash
sudo mkdir -p /var/www && sudo chown "$USER" /var/www
cd /var/www
git clone https://github.com/mammonrn/readystock.git
cd readystock
npm install --omit=dev
```

## 3. ตั้งค่า .env

```bash
cp .env.example .env
nano .env
```

ต้องแก้อย่างน้อยค่านี้:

```bash
# สร้าง SESSION_SECRET แบบสุ่ม แล้ววางลงไฟล์ .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```ini
PORT=3300
SESSION_SECRET=<ค่าสุ่มที่ได้จากคำสั่งด้านบน>
NODE_ENV=production
```

> ไม่ต้องตั้งรหัสเชิญในไฟล์นี้แล้ว — หลังติดตั้งเสร็จให้สมัครผู้ใช้คนแรก (ได้ admin อัตโนมัติ)
> แล้วสร้างรหัสเชิญให้พนักงานคนอื่นจากหน้า "จัดการระบบ" ในเว็บ

> ⚠️ ถ้ายังไม่ได้ติดตั้ง SSL (ยังเปิดผ่าน `http://` อยู่) ให้ใส่ `COOKIE_SECURE=false` ไว้ก่อน
> ไม่งั้นเบราว์เซอร์จะไม่เก็บ cookie ทำให้ login ไม่ผ่าน พอติดตั้ง SSL แล้วค่อยลบบรรทัดนี้ออก

## 4. รันด้วย PM2

```bash
pm2 start ecosystem.config.js
pm2 save                  # จำ process list ไว้
pm2 startup               # ทำตามคำสั่งที่ขึ้นมา เพื่อให้รันเองหลังรีบูต
pm2 logs readystock       # ดู log
```

ทดสอบว่าแอปขึ้นแล้ว:

```bash
curl http://127.0.0.1:3300/healthz
# {"status":"ok","uptime":3,"time":"..."}
```

## 5. ตั้งค่า nginx (โดเมน win89.co)

สร้างไฟล์ `/etc/nginx/sites-available/win89.co`:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name win89.co www.win89.co;

    # ให้ certbot ใช้ตอนขอ/ต่ออายุใบรับรอง
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://$host$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name win89.co www.win89.co;

    ssl_certificate     /etc/letsencrypt/live/win89.co/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/win89.co/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;

    access_log /var/log/nginx/readystock.access.log;
    error_log  /var/log/nginx/readystock.error.log;

    # เผื่อ export ไฟล์ Excel ขนาดใหญ่
    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:3300;
        proxy_http_version 1.1;

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";

        proxy_read_timeout 120s;
    }

    # health check ไม่ต้องเขียน log
    location = /healthz {
        access_log off;
        proxy_pass http://127.0.0.1:3300/healthz;
        proxy_set_header Host $host;
    }
}
```

เปิดใช้งานและขอใบรับรอง SSL:

```bash
sudo ln -s /etc/nginx/sites-available/win89.co /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

sudo apt-get install -y certbot python3-certbot-nginx
sudo certbot --nginx -d win89.co -d www.win89.co
```

เปิดไฟร์วอลล์เฉพาะพอร์ตที่ต้องใช้ (พอร์ต 3300 ไม่ต้องเปิดออกอินเทอร์เน็ต เพราะแอปฟังแค่ 127.0.0.1):

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
```

จากนั้นเปิด `https://win89.co` แล้วสมัครผู้ใช้คนแรก (จะได้สิทธิ์ admin ทันที)

## 6. อัปเดตเวอร์ชันใหม่

```bash
cd /var/www/readystock
git pull
npm install --omit=dev
pm2 restart readystock
```

## 7. สำรองข้อมูล

ข้อมูลทั้งหมดอยู่ในไฟล์เดียวคือ `data/readystock.sqlite` สำรองด้วยคำสั่ง:

```bash
cd /var/www/readystock
sqlite3 data/readystock.sqlite ".backup '/home/$USER/backup-readystock-$(date +%F).sqlite'"
```

ตั้ง cron ให้สำรองทุกคืนตี 2:

```bash
crontab -e
# 0 2 * * * sqlite3 /var/www/readystock/data/readystock.sqlite ".backup '/home/ubuntu/backup-readystock-$(date +\%F).sqlite'"
```

---

## รันบนเครื่องตัวเอง (สำหรับพัฒนา)

```bash
npm install
cp .env.example .env      # แก้ SESSION_SECRET และใส่ COOKIE_SECURE=false
npm run dev               # เปิดที่ http://127.0.0.1:3300
```

## รันเทสต์

```bash
npm test
```

ครอบคลุม: การ hash/verify รหัสผ่านด้วย scrypt, การล็อก IP เมื่อ login ผิดหลายครั้ง,
การสมัครสมาชิกและระบบรหัสเชิญ (สร้างทีละหลายรหัส, ใช้ได้ครั้งเดียว, รหัสที่ใช้ไปแล้ว/หมดอายุ/ไม่มีอยู่จริงต้องถูกปฏิเสธ),
สิทธิ์ admin, CRUD สินค้าและการบันทึก activity log,
การออกรหัสสินค้าอัตโนมัติ (นับแยกต่อหมวดหมู่, ชน prefix, ย้ายหมวดหมู่, กันรหัสซ้ำเมื่อเขียนพร้อมกัน),
การค้นหาด้วยรหัสสินค้า, การจัดลำดับหมวดหมู่, การอัปเกรดฐานข้อมูลเดิม,
การค้นหา-กรอง-แบ่งหน้า, การกันลบสำนักงาน/หมวดหมู่ที่ยังมีสินค้าใช้อยู่,
สิทธิ์การเข้าหน้า admin, CSRF และการ export ไฟล์ Excel

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| login แล้วเด้งกลับหน้า login ตลอด | เปิดผ่าน `http://` แต่ cookie ตั้งเป็น Secure — ใส่ `COOKIE_SECURE=false` ใน `.env` แล้ว `pm2 restart readystock` |
| ขึ้น "ยังไม่ได้ตั้งค่า SESSION_SECRET" | ยังไม่ได้สร้างไฟล์ `.env` หรือยังไม่ได้ใส่ค่า `SESSION_SECRET` |
| สมัครไม่ได้ บอกว่ารหัสเชิญไม่ถูกต้อง | รหัสพิมพ์ผิด หรือเป็นรหัสที่ไม่มีในระบบ ให้ admin สร้างรหัสใหม่ให้ที่หน้า "จัดการระบบ" |
| สมัครไม่ได้ บอกว่ารหัสถูกใช้ไปแล้ว / หมดอายุแล้ว | รหัสหนึ่งรหัสใช้ได้ครั้งเดียวและมีอายุ 24 ชั่วโมง ให้ admin สร้างรหัสใหม่ |
| ยังตั้ง `INVITE_CODE` ไว้ในไฟล์ `.env` เดิม | ไม่มีผลแล้ว ระบบไม่อ่านค่านี้อีกต่อไป ลบทิ้งได้เลย |
| ลืมรหัสผ่านของ user | ให้ admin เข้าหน้า "จัดการระบบ" แล้วกดตั้งรหัสผ่านใหม่ให้ |
| ลืมรหัสผ่าน admin ทุกคน | ลบผู้ใช้ออกจากฐานข้อมูลแล้วสมัครใหม่: `sqlite3 data/readystock.sqlite "DELETE FROM users;"` แล้ว `pm2 restart readystock` |
| ลบสำนักงาน/หมวดหมู่ไม่ได้ | ยังมีสินค้าใช้อยู่ ระบบจะบอกจำนวน ให้ย้ายหรือลบสินค้าเหล่านั้นก่อน |
| อยากเปลี่ยนรหัสนำหน้าของหมวดหมู่ | แก้ได้ที่หน้า "จัดการระบบ → หมวดหมู่" แต่มีผลกับสินค้าที่เพิ่มใหม่เท่านั้น รหัสเดิมไม่เปลี่ยน |
| ตั้งรหัสนำหน้าซ้ำกับหมวดหมู่อื่นไม่ได้ | รหัสนำหน้าต้องไม่ซ้ำ เพราะใช้แยกเลขรหัสสินค้าของแต่ละหมวด ระบบจะบอกว่าซ้ำกับหมวดไหน |
| ลากสลับลำดับหมวดหมู่ไม่ได้ (ปิด JavaScript) | ใช้ปุ่ม ↑ ↓ ข้างแต่ละหมวดหมู่แทนได้ ทำงานได้โดยไม่ต้องใช้ JavaScript |
