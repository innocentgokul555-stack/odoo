class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}
const badRequest = (m, fields) => new HttpError(400, m, fields);
const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
const conflict = (m) => new HttpError(409, m);
const forbidden = (m = 'You do not have permission to do that') => new HttpError(403, m);

module.exports = { HttpError, badRequest, notFound, conflict, forbidden };
