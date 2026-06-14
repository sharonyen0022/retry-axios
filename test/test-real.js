// import axios from 'axios';
// import { attach } from './build/src/index.js';

// const raxConfig = {
//   retry: 2,
//   returnFirstError: true,
//   httpMethodsToRetry: ['POST'],
//   statusCodesToRetry: [[500, 599]],
// };
// axios.defaults.raxConfig = raxConfig;
// attach(axios);

// async function test() {
//   try {
//     await axios.post('http://localhost:3000/test');
//   } catch (err) {
//     console.log('Final error status:', err.response?.status);
//     console.log('Total attempts:', (err.config?.raxConfig?.currentRetryAttempt ?? 0) + 1);
//     console.log('Errors array:', err.config?.raxConfig?.errors?.map(e => e.response?.status));
//   }
// }
// test();