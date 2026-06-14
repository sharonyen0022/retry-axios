import { describe, it, expect, beforeEach } from 'vitest';
import axios, { AxiosInstance } from 'axios';
import nock from 'nock';
import { attach } from '../src/index.js';

describe('Core functionality of retry-axios (with our fixes)', () => {
  let instance: AxiosInstance;
  let interceptorId: number;

  beforeEach(() => {
    instance = axios.create();
    interceptorId = attach(instance);
    nock.cleanAll();
  });

  it('should retry up to configured number of times on 5xx errors', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/basic')
      .times(4)
      .reply(() => {
        attempts++;
        return [500];
      });

    const config = { retry: 3 };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/basic');
    } catch (err) {
      expect(attempts).toBe(4);
    }
  });

  it('should succeed after a retry when server responds with success', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/success-after-retry')
      .times(2)
      .reply(() => {
        attempts++;
        if (attempts === 1) return [500];
        return [200, { ok: true }];
      });

    const config = { retry: 1 };
    instance.defaults.raxConfig = config;

    const response = await instance.get('http://test.com/success-after-retry');
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it('should return first error when returnFirstError: true', async () => {
    let attempts = 0;
    nock('http://test.com')
      .post('/return-first')
      .times(2)
      .reply(() => {
        attempts++;
        if (attempts === 1) return [403, { msg: 'forbidden' }];
        return [500, { msg: 'internal' }];
      });

    const config = {
      retry: 1,
      returnFirstError: true,
      httpMethodsToRetry: ['POST'],
      statusCodesToRetry: [[403, 403], [500, 599]],
    };
    instance.defaults.raxConfig = config;

    try {
      await instance.post('http://test.com/return-first');
    } catch (err: any) {
      expect(err.response?.status).toBe(403);
      expect(attempts).toBe(2);
    }
  });

  it('should preserve custom headers after retry', async () => {
    let attempts = 0;
    nock('http://test.com')
      .post('/headers')
      .matchHeader('X-Custom', 'my-value')
      .times(2)
      .reply(() => {
        attempts++;
        if (attempts === 1) return [500];
        return [200];
      });

    const config = {
      retry: 1,
      httpMethodsToRetry: ['POST'],
    };
    instance.defaults.raxConfig = config;

    const response = await instance.post(
      'http://test.com/headers',
      {},
      { headers: { 'X-Custom': 'my-value' } }
    );
    expect(response.status).toBe(200);
    expect(attempts).toBe(2);
  });

  it('should respect retry limit even when shouldRetry always returns true', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/should-retry-limit')
      .times(4)
      .reply(() => {
        attempts++;
        return [500];
      });

    const config = {
      retry: 3,
      shouldRetry: () => true,
    };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/should-retry-limit');
    } catch (err) {
      expect(attempts).toBe(4);
    }
  });

  it('should not retry on 4xx client errors by default', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/client-error')
      .reply(() => {
        attempts++;
        return [400];
      });

    const config = { retry: 2 };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/client-error');
    } catch (err) {
      expect(attempts).toBe(1);
    }
  });

  it('should retry on 429 status code by default', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/too-many-requests')
      .times(2)
      .reply(() => {
        attempts++;
        return [429];
      });

    const config = { retry: 1 };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/too-many-requests');
    } catch (err) {
      expect(attempts).toBe(2);
    }
  });

  it('should retry POST request if httpMethodsToRetry includes POST', async () => {
    let attempts = 0;
    nock('http://test.com')
      .post('/post-test')
      .times(2)
      .reply(() => {
        attempts++;
        return [500];
      });

    const config = {
      retry: 1,
      httpMethodsToRetry: ['POST', 'GET'],
    };
    instance.defaults.raxConfig = config;

    try {
      await instance.post('http://test.com/post-test');
    } catch (err) {
      expect(attempts).toBe(2);
    }
  });

  it('should accumulate all errors in config.errors', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/errors-array')
      .times(2)
      .reply(() => {
        attempts++;
        return [500];
      });

    const config = { retry: 1 };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/errors-array');
    } catch (err: any) {
      const raxConfig = (err.config as any).raxConfig;
      expect(raxConfig.errors).toHaveLength(2);
      expect(raxConfig.errors[0].response?.status).toBe(500);
      expect(raxConfig.errors[1].response?.status).toBe(500);
    }
  });

  it('should work with linear backoff type', async () => {
    let attempts = 0;
    nock('http://test.com')
      .get('/linear')
      .times(2)
      .reply(() => {
        attempts++;
        return [500];
      });

    const config = { retry: 1, backoffType: 'linear' as const };
    instance.defaults.raxConfig = config;

    try {
      await instance.get('http://test.com/linear');
    } catch (err) {
      expect(attempts).toBe(2);
    }
  });
});