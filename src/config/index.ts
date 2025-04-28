// src/config/index.ts
import dotenv from 'dotenv';

dotenv.config(); // В самом начале

// Интерфейс с правильными типами
interface Config {
  PORT: number;
  MONGODB_URI: string;
  CLIENT_URL: string[];
  GOOGLE_CLIENT_ID: string;
  GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME: string;
  GOOGLE_SHARED_CALENDAR_ID: string;
  TARGET_TIMEZONE: string;
  JWT_SECRET: string;
  JWT_REFRESH_SECRET: string;
  JWT_ACCESS_EXPIRES_IN: number; // <<< Тип number
  JWT_REFRESH_EXPIRES_IN: number; // <<< Тип number
}

// --- Проверка и получение секретов ---
const jwtSecret = process.env.JWT_SECRET;
const jwtRefreshSecret = process.env.JWT_REFRESH_SECRET;

if (!jwtSecret) {
  console.error('FATAL ERROR: Environment variable JWT_SECRET is missing.');
  process.exit(1);
}
if (!jwtRefreshSecret) {
  console.error('FATAL ERROR: Environment variable JWT_REFRESH_SECRET is missing.');
  process.exit(1);
}
// -------------------------------------

// --- Преобразование времени жизни в числа с default значениями ---
const defaultAccessExpiresIn = 900; // 15 минут
const defaultRefreshExpiresIn = 604800; // 7 дней

// Используем Number() и проверку на NaN
const accessExpiresInEnv = Number(process.env.JWT_ACCESS_EXPIRES_IN);
const refreshExpiresInEnv = Number(process.env.JWT_REFRESH_EXPIRES_IN);

const finalAccessExpiresIn = isNaN(accessExpiresInEnv)
  ? defaultAccessExpiresIn
  : accessExpiresInEnv;
const finalRefreshExpiresIn = isNaN(refreshExpiresInEnv)
  ? defaultRefreshExpiresIn
  : refreshExpiresInEnv;

// Выводим предупреждения, если переменные не были заданы в .env
if (isNaN(accessExpiresInEnv)) {
  console.warn(
    `WARN: Environment variable JWT_ACCESS_EXPIRES_IN is missing or not a number. Using default value: ${defaultAccessExpiresIn}s`,
  );
}
if (isNaN(refreshExpiresInEnv)) {
  console.warn(
    `WARN: Environment variable JWT_REFRESH_EXPIRES_IN is missing or not a number. Using default value: ${defaultRefreshExpiresIn}s`,
  );
}
// -------------------------------------------------------------

// --- Проверка остальных обязательных переменных из .env ---
const requiredEnvVarsForCheck = [
  // Имена как в .env
  'PORT',
  'MONGODB_URI',
  'CLIENT_URLS', // Используем имя из .env
  'GOOGLE_CLIENT_ID',
  'GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME',
  'GOOGLE_SHARED_CALENDAR_ID',
  'TARGET_TIMEZONE',
];

requiredEnvVarsForCheck.forEach((varName) => {
  if (!process.env[varName]) {
    console.error(`FATAL ERROR: Environment variable ${varName} is missing.`);
    process.exit(1);
  }
});
// ---------------------------------------------------------

// Получаем и обрабатываем CLIENT_URLS
const clientUrls = process.env.CLIENT_URLS!.split(',') || ['http://localhost:5173']; // Утверждение '!' после проверки

// --- Создаем объект config СРАЗУ с типом Config ---
const configValues: Config = {
  PORT: Number(process.env.PORT!), // Утверждение '!' после проверки
  MONGODB_URI: process.env.MONGODB_URI!,
  CLIENT_URL: clientUrls, // Обработанное значение
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID!,
  GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME!,
  GOOGLE_SHARED_CALENDAR_ID: process.env.GOOGLE_SHARED_CALENDAR_ID!,
  TARGET_TIMEZONE: process.env.TARGET_TIMEZONE || 'Asia/Yekaterinburg', // Default можно оставить строкой
  JWT_SECRET: jwtSecret, // Проверенная строка
  JWT_REFRESH_SECRET: jwtRefreshSecret, // Проверенная строка
  JWT_ACCESS_EXPIRES_IN: finalAccessExpiresIn, // <<< ЧИСЛО
  JWT_REFRESH_EXPIRES_IN: finalRefreshExpiresIn, // <<< ЧИСЛО
};
// ---------------------------------------------------

// Экспортируем готовый объект типа Config
export default configValues;
