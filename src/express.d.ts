import { IUser } from './src/models/user.model'; // Импортируй IUser, если используешь req.user

// Расширяем пространство имен Express глобально
declare global {
  namespace Express {
    interface Request {
      userId?: string; // ID пользователя из JWT (MongoDB ID)
      user?: IUser; // Опционально: полный объект пользователя
    }
  }
}

// Важно: Добавь пустой экспорт, чтобы TypeScript считал этот файл модулем
export {};
