import http from 'http';

let requestCount = 0;

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/test') {
    requestCount++;
    console.log(`Request #${requestCount} received`);

    if (requestCount === 1) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('First error (500)');
    } else if (requestCount === 2) {
      res.writeHead(503, { 'Content-Type': 'text/plain' });
      res.end('Second error (503)');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('Success after retries');
    }
  } else {
    res.writeHead(404);
    res.end();
  }
});

server.listen(3000, () => {
  console.log('Test server running on http://localhost:3000');
});