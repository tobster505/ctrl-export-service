// Quick environment check for headless Chrome
export const config = { runtime: 'nodejs20.x' };

import chromium from '@sparticuz/chromium';

export default async function handler(req, res) {
  try {
    const execPath = await chromium.executablePath();
    res.status(200).json({
      node: process.version,
      headless: chromium.headless,
      hasExecPath: Boolean(execPath),
      execPath
    });
  } catch (e) {
    res.status(500).json({ error: e?.message || String(e) });
  }
}
