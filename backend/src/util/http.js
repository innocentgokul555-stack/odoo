// Wraps async route handlers so errors reach the error middleware.
const h = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res, next)).catch(next);

function paging(req, defaultSize = 20) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.page_size, 10) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}
const meta = (page, pageSize, total) => ({
  page, page_size: pageSize, total, total_pages: Math.max(1, Math.ceil(total / pageSize)),
});
const likeTerm = (s) => `%${String(s).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;

module.exports = { h, paging, meta, likeTerm };
