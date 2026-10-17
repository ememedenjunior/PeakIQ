const http = require('http');
const mongoose = require('mongoose');
const config = require('./config');
config.assertValid();

const { createApp } = require('./app');
const { initSocket, getHub, closeSocket } = require('./lib/socket');

mongoose.set('strictQuery', true);

const app = createApp();
const server = http.createServer(app);
initSocket(server);

let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal} received, shutting down`);
  // Hard stop if something hangs. Live sessions stay marked live in the database and are
  // recovered on the next boot, so the instructor can reconnect within the grace period.
  setTimeout(() => process.exit(1), 10000).unref();
  try {
    await closeSocket(); // also closes the HTTP server
    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown', err);
    process.exit(1);
  }
}
['SIGTERM', 'SIGINT'].forEach((s) => process.on(s, () => shutdown(s)));
process.on('unhandledRejection', (err) => console.error('[unhandledRejection]', err));
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  shutdown('uncaughtException');
});

mongoose
  .connect(config.mongoUri, { maxPoolSize: 20, serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    const recovered = await getHub().recover();
    server.listen(config.port, () => {
      console.log(`PeakIQ API running on port ${config.port} (${config.env})${config.serveClient ? ', serving the client' : ''}`);
      if (recovered) console.log(`Recovered ${recovered} live session(s); instructors have ${config.live.hostGraceSeconds}s to reconnect`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection failed', err.message);
    process.exit(1);
  });
