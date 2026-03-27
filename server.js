const https = require('https');

const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;

const server = require('http').createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== '/api/tmdb') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  if (!TMDB_KEY) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'TMDB_API_KEY tanımlı değil.' }));
    return;
  }

  const path = url.searchParams.get('path');
  const query = url.searchParams.get('query') || '';

  if (!path) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'path parametresi eksik.' }));
    return;
  }

  const tmdbUrl = `https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}&${query}`;

  https.get(tmdbUrl, (tmdbRes) => {
    let data = '';
    tmdbRes.on('data', chunk => data += chunk);
    tmdbRes.on('end', () => {
      res.writeHead(tmdbRes.statusCode, { 'Content-Type': 'application/json' });
      res.end(data);
    });
  }).on('error', (e) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: e.message }));
  });
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
