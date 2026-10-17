/** Throwable HTTP error. `extra` is merged onto the error (e.g. { problems: [...] }). */
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });

module.exports = { fail };
