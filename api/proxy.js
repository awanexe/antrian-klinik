/**
 * ============================================================================
 * VERCEL SERVERLESS PROXY - api/proxy.js
 * ============================================================================
 * Meneruskan request dari frontend (Vercel) ke Google Apps Script Web App.
 * Menangani CORS, parsing JSON, dan error handling.
 *
 * Env var wajib: GAS_WEB_APP_URL (set di Vercel Dashboard > Settings > Env)
 * ============================================================================
 */

export default async function handler(req, res) {
  // CORS headers (untuk fleksibilitas dev lokal / multi-origin)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const GAS_URL = process.env.GAS_WEB_APP_URL;
  if (!GAS_URL) {
    return res.status(500).json({
      success: false,
      message: 'Environment variable GAS_WEB_APP_URL belum dikonfigurasi di Vercel.'
    });
  }

  try {
    let gasUrl = GAS_URL;
    const fetchOptions = { method: req.method };

    if (req.method === 'GET') {
      const params = new URLSearchParams();
      Object.keys(req.query || {}).forEach(k => {
        const v = req.query[k];
        if (Array.isArray(v)) v.forEach(item => params.append(k, String(item)));
        else params.append(k, String(v));
      });
      if (params.toString()) {
        gasUrl += (gasUrl.indexOf('?') === -1 ? '?' : '&') + params.toString();
      }
    } else if (req.method === 'POST') {
      let body = req.body;
      if (body === undefined || body === null) body = {};
      fetchOptions.headers = { 'Content-Type': 'application/json' };
      fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
    } else {
      return res.status(405).json({ success: false, message: 'Method not allowed' });
    }

    const gasResponse = await fetch(gasUrl, fetchOptions);
    const text = await gasResponse.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (parseErr) {
      return res.status(502).json({
        success: false,
        message: 'Invalid JSON response from Google Apps Script.',
        raw: text.substring(0, 500)
      });
    }

    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Proxy error: ' + (error && error.message ? error.message : String(error))
    });
  }
}