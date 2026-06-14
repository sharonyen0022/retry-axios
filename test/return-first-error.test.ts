import { describe, it, expect } from 'vitest';
import axios from 'axios';
import nock from 'nock';
import { attach } from '../src/index.js';

describe('returnFirstError', () => {
it('should retry exactly the configured number of times (problem #5)', async () => {
  let attempt = 0;
  nock('http://test.com')
    .get('/exact-retry')   // یا هر متد/آدرسی که استفاده می‌کنید
    .times(4)              // 👈 حتماً اضافه شود (اجازه ۴ بار پاسخ)
    .reply(() => {
      attempt++;
      return [500, {}];
    });

  const raxConfig = { retry: 3 }; // ۳ بار تکرار -> مجموعاً ۴ تلاش
  const instance = axios.create();
  instance.defaults.raxConfig = raxConfig;
  attach(instance);

  try {
    await instance.get('http://test.com/exact-retry');
  } catch (err) {
    expect(attempt).toBe(4);
  }
});
});