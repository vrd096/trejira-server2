import { Request, Response, NextFunction } from 'express';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { User, IUser } from '../models/user.model'; // Убедись, что путь правильный
import config from '../config'; // Убедись, что путь правильный

// Используем Client ID из переменной окружения, которая должна быть ТАКОЙ ЖЕ, как на клиенте
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  console.error('FATAL ERROR: GOOGLE_CLIENT_ID in server environment variables.');
  process.exit(1); // Завершаем работу, если ID клиента не задан
}

const client = new OAuth2Client(GOOGLE_CLIENT_ID);

// Расширяем объект Request для добавления данных пользователя
declare global {
  namespace Express {
    interface Request {
      user?: IUser; // Можно добавить всего пользователя для удобства
      userId?: string; // Или только ID пользователя из нашей БД
    }
  }
}

export const authenticateWithGoogleToken = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    console.warn('Auth Middleware: No Bearer token provided.');
    return res
      .status(401)
      .json({ message: 'Authorization header missing or invalid (Bearer token required)' });
  }

  const googleToken = authHeader.split(' ')[1];

  try {
    // 1. Верифицируем Google ID токен
    const ticket = await client.verifyIdToken({
      idToken: googleToken,
      audience: GOOGLE_CLIENT_ID,
    });
    const payload: TokenPayload | undefined = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email) {
      console.warn('Auth Middleware: Invalid Google token payload.');
      return res.status(401).json({ message: 'Invalid Google token payload' });
    }

    const { sub: googleId, email, name, picture: avatar } = payload;

    // 2. Ищем пользователя в нашей базе данных по googleId
    let user = await User.findOne({ googleId: googleId });

    if (!user) {
      // --- Автоматическое создание пользователя (ОПЦИОНАЛЬНО) ---
      // Если пользователя нет, можно его создать.
      // В продакшене может потребоваться более сложная логика
      // (например, разрешать доступ только заранее добавленным email).
      console.log(`Auth Middleware: User with googleId ${googleId} not found. Creating new user.`);
      try {
        user = await User.create({
          googleId: googleId,
          email: email,
          // Используем имя и аватар из Google токена
          name: name || 'Google User', // Имя может отсутствовать
          avatar: avatar,
        });
        console.log(`Auth Middleware: Created new user with ID: ${user._id}`);
      } catch (createError: any) {
        console.error('Auth Middleware: Failed to create user:', createError);
        // Проверяем на дубликат email (если уникальный индекс на email)
        if (createError.code === 11000 && createError.keyPattern?.email) {
          return res.status(409).json({
            message: `User with email ${email} already exists but is linked to a different Google account.`,
          });
        }
        return res
          .status(500)
          .json({ message: 'Failed to create user profile during authentication.' });
      }
      // --- Конец блока автоматического создания ---

      // --- ИЛИ Просто отказ, если пользователь не найден ---
      // console.warn(`Auth Middleware: User with googleId ${googleId} not found in DB.`);
      // return res.status(403).json({ message: 'User not registered in this application' });
      // --- Конец блока отказа ---
    } else {
      // Опционально: Обновить имя/аватар, если они изменились в Google
      let updated = false;
      if (name && user.name !== name) {
        user.name = name;
        updated = true;
      }
      if (avatar && user.avatar !== avatar) {
        user.avatar = avatar;
        updated = true;
      }
      if (updated) {
        await user.save();
        console.log(`Auth Middleware: Updated user profile for ${user.email}`);
      }
    }

    // 3. Прикрепляем ID пользователя из НАШЕЙ базы данных к запросу

    // Добавляем проверку, чтобы TypeScript был уверен, что user не null и имеет _id
    if (!user || !user._id) {
      // Эта ситуация логически не должна произойти, если код выше корректен,
      // но эта проверка удовлетворит компилятор и добавит слой защиты.
      console.error(
        'Auth Middleware Critical Error: User object or user._id is missing after find/create!',
      );
      return res.status(500).json({ message: 'Internal server error during user processing' });
    }

    // Теперь TypeScript знает, что user и user._id существуют
    req.userId = user._id.toString();
    req.user = user; // Тип req.user должен быть IUser в объявлении Request

    // Логируем email. Убедимся, что user.email тоже точно есть.
    const userEmail = user.email || 'email_not_found';
    console.log(
      `Auth Middleware: User ${userEmail} (ID: ${req.userId}) authenticated successfully.`,
    );
    next(); // Передаем управление следующему middleware или обработчику роута
  } catch (error: any) {
    console.error('Auth Middleware: Google token verification failed:', error.message);
    // Обрабатываем конкретные ошибки верификации
    if (error.message.includes('Token used too late') || error.message.includes('expired')) {
      return res.status(401).json({ message: 'Google token expired' });
    }
    if (error.message.includes('audience')) {
      return res.status(401).json({ message: 'Invalid Google token audience' });
    }
    return res.status(401).json({ message: 'Invalid Google token or authentication failed' });
  }
};
