'use strict';

/** ข้อผิดพลาดที่คาดไว้แล้ว — ข้อความในนี้เอาไปแสดงให้ผู้ใช้เห็นได้เลย */
class AppError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AppError';
    this.expected = true;
  }
}

module.exports = { AppError };
