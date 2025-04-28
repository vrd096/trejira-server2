// src/middleware/authenticateWithJWT.ts
import { Request, Response, NextFunction } from 'express';
import jwt, { JwtPayload, Secret } from 'jsonwebtoken'; // Импортируем Secret
import config from '../config';
import { IUser } from '../models/user.model'; // Импортируем IUser, если нужно добавить req.user

// --- Определяем расширенный тип Request ---
interface AuthenticatedRequest extends Request {
  userId?: string;
  // user?: IUser; // Опционально
}
// ----------------------------------------

export const authenticateWithJWT = (req: Request, res: Response, next: NextFunction) => {
  // Оставляем стандартный Request здесь
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: 'Authorization header missing or invalid' });
  }

  const accessToken = authHeader.split(' ')[1];

  try {
    // Проверяем Access Token
    const decoded = jwt.verify(accessToken, config.JWT_SECRET as Secret) as JwtPayload; // Утверждение для секрета

    const userId = decoded.userId;
    if (!userId) {
      console.warn('JWT Middleware: userId missing in token payload.');
      return res.status(401).json({ message: 'Invalid token payload' });
    }

    // --- Присваиваем userId к req, используя утверждение типа ---
    // Говорим TS, что мы знаем, что у объекта req есть это свойство (из нашего интерфейса)
    (req as AuthenticatedRequest).userId = userId; // <<< Утверждение типа здесь
    // ---------------------------------------------------------

    // Если нужно добавить пользователя (потребует запроса к базе):
    // const user = await User.findById(userId);
    // if (user) {
    //    (req as AuthenticatedRequest).user = user;
    // }

    console.log(`JWT Middleware: User ${userId} authenticated.`);
    next();
  } catch (error: any) {
    console.error('JWT Middleware: Token verification failed:', error.message);
    if (error instanceof jwt.TokenExpiredError) {
      return res.status(401).json({ message: 'Access token expired' });
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: 'Invalid access token' });
    }
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
