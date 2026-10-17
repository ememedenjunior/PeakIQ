const { Server } = require('socket.io');
const config = require('../config');
const User = require('../models/User');
const { verifyToken } = require('./tokens');
const { createLiveHub } = require('./liveHub');
const liveStore = require('./liveStore');

let io = null;
let hub = null;

function initSocket(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: (origin, cb) => cb(null, config.isAllowedOrigin(origin)) },
    maxHttpBufferSize: 64 * 1024, // signalling payloads are tiny; anything bigger is abuse
    pingInterval: 20000,
    pingTimeout: 20000,
  });

  // Authenticate every socket with the same JWT used by the REST API, and load who they are.
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth && socket.handshake.auth.token;
      const user = await User.findById(verifyToken(token)).select('name role');
      if (!user) throw new Error('No such user');
      socket.userId = String(user._id);
      socket.data.user = { id: String(user._id), name: user.name, role: user.role };
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  hub = createLiveHub({ io, store: liveStore, config });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);
    hub.register(socket);
  });

  return io;
}

function emitToUser(userId, event, payload) {
  if (io) io.to(`user:${userId}`).emit(event, payload);
}

const getHub = () => {
  if (!hub) throw new Error('Socket server is not initialised');
  return hub;
};

async function closeSocket() {
  if (hub) hub.shutdown();
  if (io) await new Promise((resolve) => io.close(resolve));
}

module.exports = { initSocket, emitToUser, getHub, closeSocket };
