import express from 'express';
import cors from 'cors';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import mongoose from 'mongoose';
import config from './config';
import apiRouter from './routes/api';
import { setupWebSocket } from './services/websocket.service';
import { errorHandler } from './middleware/errorHandler';
// import { authenticateUser } from './middleware/authMiddleware';

const app = express();
const server = createServer(app);

// MongoDB connection
mongoose.set('debug', (collectionName, method, query, doc) => {
  console.debug(`Mongoose: ${collectionName}.${method}`, { query, doc });
});

const connectToDatabase = async () => {
  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    console.log('✅ Connected to MongoDB');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err);
    process.exit(1);
  }
};

// Middleware
app.use(
  cors({
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Routes
// app.use('/api', authenticateUser, apiRouter);
app.use('/api', apiRouter);

// Health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    mongo: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

// WebSocket
const io = new Server(server, {
  cors: {
    origin: config.CLIENT_URL,
    methods: ['GET', 'POST'],
    credentials: true,
  },
  connectionStateRecovery: {
    maxDisconnectionDuration: 2 * 60 * 1000,
    skipMiddlewares: true,
  },
  pingInterval: 10000,
  pingTimeout: 5000,
});

// Error handling
app.use(errorHandler);

// Initialize app
const initializeApp = async () => {
  await connectToDatabase();
  setupWebSocket(io);
};

initializeApp();

export { app, server, io };
