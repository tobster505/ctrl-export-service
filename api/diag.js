// either delete this line completely...
export const config = { runtime: 'nodejs' };   // ← if you keep it, it must be exactly 'nodejs'

// ...rest of your diag code
export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ ok: true, runtime: 'nodejs' }));
}
