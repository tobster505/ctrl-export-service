module.exports = async (req, res) => {
  try {
    const name = String((req.query && req.query.name) || 'ctrl.csv')
      .replace(/[^\w.\-]+/g, '_');
    const b64 = String((req.query && req.query.data) || '');
    if (!b64) {
      res.statusCode = 400;
      return res.end('Missing data');
    }
    const csv = Buffer.from(b64, 'base64').toString('utf8');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.statusCode = 200;
    res.end(csv);
  } catch (e) {
    console.error('CSV error', e);
    res.statusCode = 500;
    res.end('Error generating file');
  }
};
