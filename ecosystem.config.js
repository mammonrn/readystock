// ไฟล์ตั้งค่าสำหรับ PM2 — ใช้คำสั่ง: pm2 start ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'readystock',
      script: 'src/server.js',
      cwd: __dirname,
      instances: 1,
      // ต้องเป็น 1 instance เท่านั้น เพราะ SQLite เป็นไฟล์เดียว และตัวนับ rate limit เก็บใน memory
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 10,
      watch: false,
      max_memory_restart: '400M',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/error.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
    },
  ],
};
