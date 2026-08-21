# 📦 ReadyStock — ระบบคลังสินค้าสำนักงาน

เว็บแอปสำหรับบันทึกและติดตามของใช้/อุปกรณ์ในแต่ละสำนักงาน (SH666, SH999, UB89, 88F)
ใช้งานง่าย หน้าจอภาษาไทยทั้งหมด ออกแบบมาให้ใช้บนจอโน้ตบุ๊ก

## คุณสมบัติ

- **รายการสินค้า** — ตารางแสดง ชื่อ / หมวดหมู่ / สำนักงาน / จำนวน / หน่วย / หมายเหตุ / ผู้แก้ไขล่าสุด
  - ค้นหาด้วยชื่อ กรองตามสำนักงานและหมวดหมู่ กรองเฉพาะของที่หมด
  - แถบสรุป: จำนวนรายการที่พบ จำนวนรวม และจำนวนสินค้าที่หมด
  - สินค้าที่จำนวนเป็น 0 จะขึ้นป้ายแดง **"หมด"** และไฮไลต์ทั้งแถว
  - รองรับสินค้าหลักพันรายการ แบ่งหน้าละ 50
- **เพิ่ม / แก้ไข / ลบสินค้า** — ลบต้องยืนยันก่อนเสมอ ทุกการกระทำถูกบันทึกไว้
- **ประวัติการใช้งาน** — ดูได้ว่าใครทำอะไรกับสินค้าตัวไหน เมื่อไหร่ (ผู้ใช้ทุกคนดูได้)
- **หน้าจัดการระบบ (เฉพาะ admin)** — เพิ่ม/แก้ชื่อ/ลบ สำนักงานและหมวดหมู่, จัดการผู้ใช้ (ตั้งรหัสผ่านใหม่ / เปลี่ยนสิทธิ์ / ลบ)
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
  session-store.js     เก็บ session ไว้ในตาราง sessions ของ SQLite
  routes/              auth, items (+export), logs, admin
  services/            logic หลัก: users, items, taxonomy, logs
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
| `categories` | id, name (unique), created_at — ตั้งต้น: โทรศัพท์, คอมพิวเตอร์, อื่นๆ |
| `items` | id, name, category_id, office_id, quantity (>= 0), unit, note, created_at, updated_at, updated_by |
| `activity_logs` | id, user_id, action (create/update/delete), item_name, detail, created_at |
| `sessions` | sid, data, expires_at (ใช้เก็บ session ของ express-session) |

## การสมัครสมาชิกและสิทธิ์

1. ตั้ง `INVITE_CODE` ในไฟล์ `.env` แล้วบอกรหัสนี้กับคนที่จะให้ใช้ระบบ
2. เข้าหน้า `/register` กรอกชื่อผู้ใช้ + รหัสผ่าน + รหัสเชิญ
3. **ผู้ใช้คนแรกที่สมัครสำเร็จจะได้สิทธิ์ admin โดยอัตโนมัติ** คนถัดไปจะเป็น user ธรรมดา
   (admin เปลี่ยนสิทธิ์ให้คนอื่นได้ทีหลังที่หน้า "จัดการระบบ")

ความปลอดภัยที่ใส่ไว้ให้:
- รหัสผ่านเก็บเป็น scrypt hash พร้อม salt สุ่มรายคน
- กรอกรหัสผิดครบ 5 ครั้ง IP นั้นจะถูกล็อก 15 นาที
- ทุกฟอร์มมี CSRF token
- ระบบไม่ยอมให้ลบ/ลดสิทธิ์จนไม่เหลือ admin ในระบบ

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

ต้องแก้อย่างน้อย 2 ค่านี้:

```bash
# สร้าง SESSION_SECRET แบบสุ่ม แล้ววางลงไฟล์ .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

```ini
PORT=3300
SESSION_SECRET=<ค่าสุ่มที่ได้จากคำสั่งด้านบน>
INVITE_CODE=<รหัสเชิญที่จะแจกให้พนักงาน>
NODE_ENV=production
```

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
cp .env.example .env      # แก้ SESSION_SECRET, INVITE_CODE และใส่ COOKIE_SECURE=false
npm run dev               # เปิดที่ http://127.0.0.1:3300
```

## รันเทสต์

```bash
npm test
```

ครอบคลุม: การ hash/verify รหัสผ่านด้วย scrypt, การล็อก IP เมื่อ login ผิดหลายครั้ง,
การสมัครสมาชิก/รหัสเชิญ/สิทธิ์ admin, CRUD สินค้าและการบันทึก activity log,
การค้นหา-กรอง-แบ่งหน้า, การกันลบสำนักงาน/หมวดหมู่ที่ยังมีสินค้าใช้อยู่,
สิทธิ์การเข้าหน้า admin, CSRF และการ export ไฟล์ Excel

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
| --- | --- |
| login แล้วเด้งกลับหน้า login ตลอด | เปิดผ่าน `http://` แต่ cookie ตั้งเป็น Secure — ใส่ `COOKIE_SECURE=false` ใน `.env` แล้ว `pm2 restart readystock` |
| ขึ้น "ยังไม่ได้ตั้งค่า SESSION_SECRET" | ยังไม่ได้สร้างไฟล์ `.env` หรือยังไม่ได้ใส่ค่า `SESSION_SECRET` |
| สมัครไม่ได้ บอกว่ารหัสเชิญไม่ถูกต้อง | ตรวจค่า `INVITE_CODE` ใน `.env` ต้องตรงเป๊ะ (ตัวพิมพ์เล็ก-ใหญ่มีผล) |
| ลืมรหัสผ่านของ user | ให้ admin เข้าหน้า "จัดการระบบ" แล้วกดตั้งรหัสผ่านใหม่ให้ |
| ลืมรหัสผ่าน admin ทุกคน | ลบผู้ใช้ออกจากฐานข้อมูลแล้วสมัครใหม่: `sqlite3 data/readystock.sqlite "DELETE FROM users;"` แล้ว `pm2 restart readystock` |
| ลบสำนักงาน/หมวดหมู่ไม่ได้ | ยังมีสินค้าใช้อยู่ ระบบจะบอกจำนวน ให้ย้ายหรือลบสินค้าเหล่านั้นก่อน |
