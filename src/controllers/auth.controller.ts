import { Request, Response } from 'express';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import { User, IUser } from '../models/user.model';
import config from '../config';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID); // Получаем ID клиента из env

export const googleLogin = async (req: Request, res: Response) => {
  const { token } = req.body; // Ожидаем Google ID token в теле запроса

  if (!token) {
    return res.status(400).json({ message: 'Google token is required' });
  }

  try {
    // 1. Верифицируем Google ID токен
    const ticket = await client.verifyIdToken({
      idToken: token,
      audience: process.env.VITE_GOOGLE_CLIENT_ID, // Убедись, что Client ID совпадает
    });
    const payload = ticket.getPayload();

    if (!payload || !payload.sub || !payload.email || !payload.name) {
      return res.status(400).json({ message: 'Invalid Google token payload' });
    }

    const { sub: googleId, email, name, picture: avatar } = payload;

    // 2. Ищем пользователя в нашей базе или создаем нового
    let user = await User.findOne({ googleId });

    if (!user) {
      // Если нет по googleId, попробуем найти по email (на случай смены аккаунта)
      user = await User.findOne({ email });
      if (user) {
        // Обновляем googleId и аватар, если нашли по email
        user.googleId = googleId;
        user.avatar = avatar;
        await user.save();
      } else {
        // Создаем нового пользователя
        user = await User.create({ googleId, email, name, avatar });
      }
    } else if (user.avatar !== avatar || user.name !== name) {
      // Обновляем имя и аватар, если они изменились
      user.avatar = avatar;
      user.name = name;
      await user.save();
    }

    // 3. Генерируем наш JWT токен приложения
    const appTokenPayload = { userId: user._id.toString() }; // Используем ID из MongoDB
    const appToken = jwt.sign(appTokenPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_ACCESS_EXPIRES_IN || '15m', // Используй значение из конфига
    });

    // 4. Отправляем наш токен и данные пользователя клиенту
    res.status(200).json({
      token: appToken, // Наш JWT!
      user: {
        id: user._id.toString(),
        name: user.name,
        email: user.email,
        avatar: user.avatar,
      },
    });
  } catch (error) {
    console.error('Google login error:', error);
    res
      .status(401)
      .json({ message: 'Google authentication failed', error: (error as Error).message });
  }
};
