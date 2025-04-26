// src/config/index.ts
import dotenv from 'dotenv';

dotenv.config(); // В самом начале

interface Config {
  PORT: number;
  MONGODB_URI: string;
  CLIENT_URL: string[];
  GOOGLE_CLIENT_ID: string; // Для аутентификации HTTP/WS
  GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME: string; // Имя файла ключа сервисного аккаунта
  GOOGLE_SHARED_CALENDAR_ID: string; // ID общего календаря
  TARGET_TIMEZONE: string; // Целевой часовой пояс
}

// Проверки наличия критически важных переменных
const requiredEnvVars: Array<keyof Config> = [
  'PORT',
  'MONGODB_URI',
  'CLIENT_URL', // Имя в .env может быть CLIENT_URLS
  'GOOGLE_CLIENT_ID',
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME',
  'GOOGLE_SHARED_CALENDAR_ID',
  'TARGET_TIMEZONE',
];

// Проверяем .env имя CLIENT_URLS, но в config будет CLIENT_URL
const clientUrls = process.env.CLIENT_URLS?.split(',') || ['http://localhost:5173'];

const configValues: Partial<Config> = {
  PORT: Number(process.env.PORT) || 3000,
  MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017/task-board',
  CLIENT_URL: clientUrls,
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME,
  GOOGLE_SHARED_CALENDAR_ID: process.env.GOOGLE_SHARED_CALENDAR_ID,
  TARGET_TIMEZONE: process.env.TARGET_TIMEZONE || 'Asia/Yekaterinburg', // Значение по умолчанию
};

// Проверка, что все необходимые переменные установлены
requiredEnvVars.forEach((varName) => {
  const keyToCheck = varName === 'CLIENT_URL' ? 'CLIENT_URLS' : varName; // Особый случай для CLIENT_URLS
  if (!process.env[keyToCheck] && !configValues[varName]) {
    console.error(`FATAL ERROR: Environment variable ${keyToCheck} is missing.`);
    process.exit(1);
  }
});

export default configValues as Config;
