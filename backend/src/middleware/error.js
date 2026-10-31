const { HttpError } = require('../util/errors');

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, fields: err.fields });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Request body is not valid JSON' });
  }
  if (err && /UNIQUE constraint failed/.test(err.message || '')) {
    return res.status(409).json({ error: 'That record already exists' });
  }
  console.error(err);
  return res.status(500).json({ error: 'Something went wrong on the server' });
}

module.exports = { errorHandler };
