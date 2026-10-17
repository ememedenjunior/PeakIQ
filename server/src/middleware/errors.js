const notFound = (_req, res) => res.status(404).json({ message: 'Not found' });

// One place that turns every failure into a safe JSON response. Server faults never leak internals.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);

  if (err.type === 'entity.too.large') return res.status(413).json({ message: 'That request is too large.' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'The request body is not valid JSON.' });
  if (err.name === 'ValidationError' && err.errors) {
    return res.status(400).json({ message: Object.values(err.errors)[0]?.message || 'Some of that data is not valid' });
  }
  if (err.name === 'CastError') return res.status(400).json({ message: 'That identifier is not valid.' });
  if (err.code === 11000) return res.status(409).json({ message: 'That already exists.' });

  if (err.status && err.status < 500) {
    const body = { message: err.message };
    if (err.problems) body.problems = err.problems;
    if (err.sessionId) body.sessionId = err.sessionId;
    return res.status(err.status).json(body);
  }

  console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  const status = err.status && err.status >= 500 ? err.status : 500;
  res.status(status).json({ message: 'Something went wrong on our side. Please try again.' });
}

module.exports = { notFound, errorHandler };
