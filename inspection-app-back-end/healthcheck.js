const http = require('http');

const port = process.env.PORT || 3000;
const options = {
  host: 'localhost',
  port: port,
  path: '/health',
};

const request = http.request(options, (res) => {
  console.log(`Health check status: ${res.statusCode}`);
  if (res.statusCode === 200) {
    process.exit(0);
  } else {
    process.exit(1);
  }
});

request.on('error', (err) => {
  console.error('Health check failed:', err.message);
  process.exit(1);
});

request.setTimeout(2000, () => {
  console.error('Health check timeout');
  request.destroy();
  process.exit(1);
});

request.end();

