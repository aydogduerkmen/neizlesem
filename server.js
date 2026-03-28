const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3000;
const TMDB_KEY = process.env.TMDB_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch(e) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

function supabaseRequest(path, method = 'GET', body = null) {
  const url = `${SUPABASE_URL}/rest/v1/${path}`;
  const options = {
    method,
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : ''
    }
  };
  if (body) options.body = JSON.stringify(body);
  return fetchJson(url, options);
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const url = new URL(req.url, `http://localhost:${PORT}`);
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  // TMDB proxy
  if (url.pathname === '/api/tmdb') {
    if (!TMDB_KEY) return json(500, { error: 'TMDB_API_KEY eksik.' });
    const path = url.searchParams.get('path');
    const query = url.searchParams.get('query') || '';
    if (!path) return json(400, { error: 'path eksik.' });
    const tmdbUrl = `https://api.themoviedb.org/3${path}?api_key=${TMDB_KEY}&${query}`;
    try {
      const result = await fetchJson(tmdbUrl);
      res.writeHead(result.status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(result.body));
    } catch(e) { json(500, { error: e.message }); }
    return;
  }

  // Watchlist kaydet
  if (url.pathname === '/api/watchlist' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const { email, movie_id, movie_title, movie_type } = JSON.parse(body);
        if (!email || !movie_id) return json(400, { error: 'email ve movie_id zorunlu.' });

        // Email format kontrolü
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return json(400, { error: 'Geçersiz email adresi.' });
        }

        // Zaten kayıtlı mı?
        const check = await supabaseRequest(
          `watchlist?email=eq.${encodeURIComponent(email)}&movie_id=eq.${movie_id}`
        );
        if (check.body && check.body.length > 0) {
          return json(200, { message: 'Bu film için zaten bildirim kaydın var.' });
        }

        const result = await supabaseRequest('watchlist', 'POST', {
          email, movie_id, movie_title, movie_type, notified: false
        });
        json(201, { message: 'Bildirim kaydedildi!' });
      } catch(e) { json(500, { error: e.message }); }
    });
    return;
  }

  // Cron: platformları kontrol et ve mail at
  if (url.pathname === '/api/check-watchlist' && req.method === 'GET') {
    const secret = url.searchParams.get('secret');
    if (secret !== process.env.CRON_SECRET) return json(401, { error: 'Yetkisiz.' });

    try {
      // Henüz bildirilmemiş kayıtları al
      const { body: watchlist } = await supabaseRequest(
        'watchlist?notified=eq.false&select=*'
      );

      if (!watchlist || !watchlist.length) return json(200, { message: 'Kontrol edilecek kayıt yok.' });

      let notified = 0;
      for (const item of watchlist) {
        // TMDB'den provider bilgisini çek
        const endpoint = item.movie_type === 'tv' ? 'tv' : 'movie';
        const providerRes = await fetchJson(
          `https://api.themoviedb.org/3/${endpoint}/${item.movie_id}/watch/providers?api_key=${TMDB_KEY}`
        );
        const tr = providerRes.body?.results?.TR;
        const providers = tr ? [...(tr.flatrate || []), ...(tr.ads || [])] : [];

        if (providers.length > 0) {
          // Platform bulundu, mail at
          const platformNames = [...new Set(providers.map(p => p.provider_name))].join(', ');

          if (RESEND_KEY) {
            await fetchJson('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${RESEND_KEY}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                from: 'ne izlesem <bildirim@neizlesem.co>',
                to: item.email,
                subject: `${item.movie_title} artık Türkiye'de izlenebilir!`,
                html: `
                  <div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
                    <h2 style="color:#e8c87a;">ne izlesem</h2>
                    <p>Merhaba,</p>
                    <p><strong>${item.movie_title}</strong> artık Türkiye'de şu platformlarda izlenebilir:</p>
                    <p style="font-size:18px;font-weight:bold;">${platformNames}</p>
                    <a href="https://neizlesem.co?id=${item.movie_id}&type=${item.movie_type}" 
                       style="display:inline-block;background:#e8c87a;color:#1a1500;padding:12px 24px;text-decoration:none;border-radius:8px;margin-top:16px;">
                      Hemen izle
                    </a>
                    <p style="color:#888;font-size:12px;margin-top:24px;">
                      neizlesem.co — film seçmekten film izleyemeyenler için.
                    </p>
                  </div>
                `
              })
            });
          }

          // Notified olarak işaretle
          await supabaseRequest(
            `watchlist?email=eq.${encodeURIComponent(item.email)}&movie_id=eq.${item.movie_id}`,
            'PATCH',
            { notified: true }
          );
          notified++;
        }
      }

      json(200, { message: `${watchlist.length} kayıt kontrol edildi, ${notified} bildirim gönderildi.` });
    } catch(e) { json(500, { error: e.message }); }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
