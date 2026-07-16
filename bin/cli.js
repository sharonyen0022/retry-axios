#!/usr/bin/env node

import axios from 'axios';
import * as rax from '../build/src/index.js'; 

const url = process.argv[2];

if (!url) {
  console.log('⚠️ Please provide a URL.');
  console.log('Example: npx @sharonyen/retry-axios https://example.com');
  process.exit(1);
}

console.log(`🚀 Testing connection to: ${url} (with Retry enabled)`);

const client = axios.create();


rax.attach(client);

client.defaults.raxConfig = {
  retry: 3,
  noResponseRetries: 3,
  onRetryAttempt: (err) => {
    const cfg = rax.getConfig(err);
    console.log(`⏱️ Retry attempt #${cfg.currentRetryAttempt} due to error: ${err.message}`);
  }
};

client.get(url)
  .then((response) => {
    console.log(`✅ Success! Status code: ${response.status}`);
  })
  .catch((error) => {
    console.error(`❌ Failed after all retry attempts: ${error.message}`);
    process.exit(1);
  });