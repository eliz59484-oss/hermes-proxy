export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

export default async function handler(req, res) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path;
  const targetUrl = `https://openrouter.ai/api/v1/${path}`;

  const headers = {
    'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
    'Content-Type': req.headers['content-type'] || 'application/json',
    'HTTP-Referer': 'https://hermes-proxy.vercel.app',
    'X-Title': 'Hermes Agent',
  };

  // Read body
  let body = null;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    body = Buffer.concat(chunks);
  }

  const response = await fetch(targetUrl, { method: req.method, headers, body });

  const contentType = response.headers.get('content-type') || 'application/json';
  res.setHeader('Content-Type', contentType);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.status(response.status);

  // Stream response (для SSE/streaming)
  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) { res.end(); break; }
      res.write(value);
    }
  } catch { res.end(); }
}
