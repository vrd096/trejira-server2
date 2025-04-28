// src/controllers/auth.controller.ts
import { Request, Response } from 'express';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import jwt, { JwtPayload, Secret, SignOptions } from 'jsonwebtoken'; // Импортируем SignOptions
import { User, IUser } from '../models/user.model';
import config from '../config';

const googleClient = new OAuth2Client(config.GOOGLE_CLIENT_ID);

// Опции для установки cookie (вынесем для переиспользования)
const refreshTokenCookieOptions = {
  httpOnly: true, // Недоступен для JavaScript
  secure: process.env.NODE_ENV === 'production', // Отправлять только по HTTPS в production
  sameSite: 'strict' as const, // Используем 'strict' или 'lax'. Добавляем 'as const' для TypeScript
  maxAge: config.JWT_REFRESH_EXPIRES_IN * 1000, // Время жизни из конфига (в миллисекундах!)
  path: '/api/auth', // Путь для cookie (только для роутов /api/auth/...)
  // domain: 'yourdomain.com' // Указывать domain только для production, если нужно
};
// Переводим строковое время жизни в миллисекунды
// (Предполагаем, что config.JWT_REFRESH_EXPIRES_IN - это число секунд)
// Если config.JWT_REFRESH_EXPIRES_IN - строка ('7d'), нужна библиотека ms
// import ms from 'ms';
// refreshTokenCookieOptions.maxAge = ms(config.JWT_REFRESH_EXPIRES_IN);

// --- Контроллер для обмена Google ID Token на JWT ---
export const googleLoginController = async (req: Request, res: Response) => {
  const { token } = req.body; // Ожидаем Google ID token

  if (!token) {
    return res.status(400).json({ message: 'Google ID token is required' });
  }

  try {
    // 1. Верификация Google ID токена
    console.log('Google Login: Verifying Google ID token...');
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: config.GOOGLE_CLIENT_ID,
    });
    const payload: TokenPayload | undefined = ticket.getPayload();

    if (!payload?.sub || !payload?.email) {
      console.warn('Google Login: Invalid Google token payload:', payload);
      return res.status(401).json({ message: 'Invalid Google token payload' });
    }
    console.log('Google Login: Token verified successfully.');

    const { sub: googleId, email, name, picture: avatar } = payload;

    // 2. Поиск или создание пользователя
    let user = await User.findOne({ googleId: googleId });
    let isNewUser = false;

    if (!user) {
      isNewUser = true;
      console.log(`Google Login: Creating new user for googleId ${googleId}`);
      user = await User.create({ googleId, email, name: name || 'User', avatar });
    } else {
      // Обновляем данные, если нужно
      let needsSave = false;
      if (name && user.name !== name) {
        user.name = name;
        needsSave = true;
      }
      if (avatar && user.avatar !== avatar) {
        user.avatar = avatar;
        needsSave = true;
      }
      if (needsSave) {
        console.log(`Google Login: Updating user profile for ${email}`);
        await user.save();
      } else {
        console.log(`Google Login: Found existing user ${email}`);
      }
    }

    // Добавим проверку на случай если создание не удалось (маловероятно)
    if (!user) {
      console.error('Google Login: Failed to find or create user!');
      return res.status(500).json({ message: 'User processing failed' });
    }

    // 3. Генерация JWT токенов
    console.log(`Google Login: Generating tokens for user ${user._id}`);
    const accessTokenPayload = { userId: user._id.toString() };
    const refreshTokenPayload = { userId: user._id.toString() };

    const accessTokenOptions: SignOptions = { expiresIn: config.JWT_ACCESS_EXPIRES_IN }; // expiresIn ожидает число секунд или строку '15m'
    const refreshTokenOptions: SignOptions = { expiresIn: config.JWT_REFRESH_EXPIRES_IN }; // expiresIn ожидает число секунд или строку '7d'

    const accessToken = jwt.sign(
      accessTokenPayload,
      config.JWT_SECRET as Secret,
      accessTokenOptions,
    );
    const refreshToken = jwt.sign(
      refreshTokenPayload,
      config.JWT_REFRESH_SECRET as Secret,
      refreshTokenOptions,
    );

    // 4. Сохранение Refresh Token в базе данных
    user.refreshToken = refreshToken;
    await user.save();
    console.log(`Google Login: Saved refresh token hash (or token itself) for user ${user.email}`);

    // 5. Установка Refresh Token в HttpOnly cookie
    console.log('Google Login: Setting refreshToken cookie...');
    res.cookie('refreshToken', refreshToken, refreshTokenCookieOptions); // Используем опции
    console.log('Google Login: Cookie should be set.');

    // 6. Отправка Access Token и данных пользователя
    console.log('Google Login: Sending response with accessToken and user data.');
    res.status(isNewUser ? 201 : 200).json({
      // 201 для нового юзера, 200 для существующего
      accessToken,
      user: user.toJSON(), // Отправляем очищенный объект пользователя
    });
  } catch (error: any) {
    console.error('Google Login Controller Error:', error);
    if (
      error.message.includes('expired') ||
      error.message.includes('audience') ||
      error.message.includes('Invalid')
    ) {
      return res.status(401).json({ message: 'Invalid or expired Google token' });
    }
    res
      .status(500)
      .json({ message: 'Internal server error during Google login', error: error.message });
  }
};

// --- Контроллер для обновления Access Token ---
export const refreshTokenController = async (req: Request, res: Response) => {
  const refreshTokenFromCookie = req.cookies.refreshToken;
  console.log('Refresh Token Controller: Received request.'); // Лог входа

  if (!refreshTokenFromCookie) {
    console.warn('Refresh Token Controller: No refreshToken cookie found.');
    return res.status(401).json({ message: 'Refresh token not found' });
  }

  try {
    // 1. Проверяем Refresh Token
    console.log('Refresh Token Controller: Verifying refresh token...');
    const decoded = jwt.verify(
      refreshTokenFromCookie,
      config.JWT_REFRESH_SECRET as Secret, // Утверждение типа для секрета
    ) as JwtPayload;
    const userId = decoded.userId;
    console.log(`Refresh Token Controller: Token verified for userId: ${userId}`);

    // 2. Находим пользователя и сверяем токен из базы
    console.log(`Refresh Token Controller: Finding user ${userId} in DB...`);
    const user = await User.findById(userId);
    // ВАЖНО: Сравниваем полученный токен с тем, что сохранен в базе
    if (!user || !user.refreshToken || user.refreshToken !== refreshTokenFromCookie) {
      console.warn(
        `Refresh Token Controller: Invalid token (not found in DB or mismatch) or user not found for userId ${userId}.`,
      );
      res.clearCookie('refreshToken', refreshTokenCookieOptions); // Очищаем cookie
      return res.status(403).json({ message: 'Invalid or revoked refresh token' }); // 403 Forbidden
    }
    console.log(`Refresh Token Controller: User ${user.email} found and token matched.`);

    // 3. Генерируем новый Access Token
    console.log(`Refresh Token Controller: Generating new access token for user ${user.email}`);
    const accessTokenPayload = { userId: user._id.toString() };
    const newAccessTokenOptions: SignOptions = { expiresIn: config.JWT_ACCESS_EXPIRES_IN };
    const newAccessToken = jwt.sign(
      accessTokenPayload,
      config.JWT_SECRET as Secret,
      newAccessTokenOptions,
    );

    // 4. (Опциональная ротация Refresh Token - рекомендуется для повышения безопасности)
    /*
    console.log(`Refresh Token Controller: Rotating refresh token for user ${user.email}`);
    const newRefreshTokenPayload = { userId: user._id.toString() };
    const newRefreshTokenOptions: SignOptions = { expiresIn: config.JWT_REFRESH_EXPIRES_IN };
    const newRefreshToken = jwt.sign(newRefreshTokenPayload, config.JWT_REFRESH_SECRET as Secret, newRefreshTokenOptions);
    user.refreshToken = newRefreshToken; // Обновляем токен в объекте пользователя
    await user.save(); // Сохраняем новый токен в базе
    res.cookie('refreshToken', newRefreshToken, refreshTokenCookieOptions); // Устанавливаем новый cookie
    console.log(`Refresh Token Controller: New refresh token set in DB and cookie.`);
    */

    console.log(`Refresh Token Controller: Issued new access token for user ${user.email}`);
    // --- ОТПРАВЛЯЕМ НОВЫЙ Access Token И ДАННЫЕ ПОЛЬЗОВАТЕЛЯ ---
    // Отправляем пользователя, т.к. клиентский thunk его ожидает
    res.status(200).json({
      accessToken: newAccessToken,
      user: user.toJSON(), // <<< Включаем пользователя
    });
    // ---------------------------------------------------------
  } catch (error: any) {
    console.error('Refresh Token Controller Error:', error);
    // Очищаем cookie при любой ошибке
    res.clearCookie('refreshToken', refreshTokenCookieOptions);
    if (error instanceof jwt.TokenExpiredError) {
      console.warn('Refresh Token Controller: Refresh token expired.');
      return res.status(403).json({ message: 'Refresh token expired' }); // 403 Forbidden
    }
    if (error instanceof jwt.JsonWebTokenError) {
      console.warn('Refresh Token Controller: Invalid refresh token signature or format.');
      return res.status(403).json({ message: 'Invalid refresh token' }); // 403 Forbidden
    }
    // Общая ошибка
    res.status(500).json({ message: 'Internal server error during token refresh' }); // 500, т.к. может быть ошибка базы
  }
};

// --- Контроллер для выхода (Logout) ---
export const logoutController = async (req: Request, res: Response) => {
  const refreshTokenFromCookie = req.cookies.refreshToken;
  console.log('Logout Controller: Received request.');

  if (!refreshTokenFromCookie) {
    console.log('Logout Controller: No refreshToken cookie found. Already logged out?');
    return res.sendStatus(204); // No Content
  }

  // Очищаем cookie немедленно
  res.clearCookie('refreshToken', refreshTokenCookieOptions);
  console.log('Logout Controller: Cleared refreshToken cookie.');

  try {
    // Пытаемся проверить токен, чтобы найти пользователя и удалить токен из базы
    // Ошибки проверки здесь не критичны, главное - удалить токен из базы, если получится
    const decoded = jwt.verify(
      refreshTokenFromCookie,
      config.JWT_REFRESH_SECRET as Secret,
    ) as JwtPayload;
    const userId = decoded.userId;
    if (userId) {
      // Удаляем поле refreshToken у пользователя
      await User.findByIdAndUpdate(userId, { $unset: { refreshToken: '' } });
      console.log(`Logout Controller: Cleared refresh token in DB for user ID ${userId}`);
    } else {
      console.warn('Logout Controller: Could not extract userId from refresh token during logout.');
    }
  } catch (error: any) {
    // Игнорируем ошибки типа 'jwt expired', 'invalid signature' и т.д.
    console.warn(
      'Logout Controller: Error verifying refresh token during logout (this is often expected if token is invalid/expired), proceeding with logout.',
      error.message,
    );
  } finally {
    // Отправляем успешный ответ в любом случае, т.к. cookie очищен
    res.status(200).json({ message: 'Logged out successfully' });
  }
};
