import dotenv from 'dotenv';

dotenv.config();

interface Config {
  PORT: number;
  MONGODB_URI: string;
  CLIENT_URL: string[];
  JWT_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: string;
}

export default {
  PORT: Number(process.env.PORT) || 3000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/task-board',
  CLIENT_URL: process.env.CLIENT_URLS?.split(',') || ['http://localhost:5173'],
  JWT_SECRET: process.env.JWT_SECRET || 'your_jwt_secret_here',
  JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
} as Config;
