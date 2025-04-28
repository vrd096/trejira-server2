// src/routes/api.ts
import { Router, Request, Response } from 'express'; // <<< Добавляем Response
import { getTasks, createTask, updateTask, deleteTask } from '../controllers/tasks.controller';
import { sendNotification } from '../controllers/notifications.controller';
import {
  googleLoginController,
  refreshTokenController,
  logoutController,
} from '../controllers/auth.controller';
import { authenticateWithJWT } from '../middleware/authenticateWithJWT';
import { User } from '../models/user.model'; // <<< Импорт User
import { IUser } from '../models/user.model'; // <<< Импорт IUser

// --- Интерфейс для расширенного Request ---
// Можно оставить здесь или вынести в types/express.d.ts, если тот файл заработает позже
interface AuthenticatedRequest extends Request {
  userId?: string;
  user?: IUser; // Добавляем user, если authenticateWithJWT его добавляет (опционально)
}
// -------------------------------------------

const router = Router();

// --- Роуты Аутентификации ---
const authRouter = Router();
authRouter.post('/google/login', googleLoginController);
authRouter.post('/refresh', refreshTokenController);
authRouter.post('/logout', logoutController);
router.use('/auth', authRouter);

// --- Роут для получения профиля (защищен JWT) ---
// Используем AuthenticatedRequest для req
router.get('/users/me', authenticateWithJWT, async (req: AuthenticatedRequest, res: Response) => {
  console.log('Handling /users/me request. User ID from middleware:', req.userId);
  try {
    // Проверяем наличие userId после middleware
    if (!req.userId) {
      console.error('/users/me Error: userId is missing after authentication middleware!');
      // Важно: не используем req.user здесь, если middleware его не добавляет
      return res.status(401).json({ message: 'Authentication failed, user ID not found' });
    }

    // Ищем пользователя по MongoDB ID из токена
    const user = await User.findById(req.userId);
    if (!user) {
      console.error(`/users/me Error: User not found in DB for ID: ${req.userId}`);
      return res.status(404).json({ message: 'User not found' });
    }

    // Возвращаем данные пользователя, используя toJSON для очистки
    res.status(200).json(user.toJSON());
  } catch (error) {
    console.error('Error fetching user profile (/users/me):', error);
    res.status(500).json({ message: 'Failed to retrieve user profile' });
  }
});

// --- Роуты Задач (защищенные JWT) ---
// Middleware authenticateWithJWT применится ко всем следующим роутам /tasks
router.use('/tasks', authenticateWithJWT);
// Контроллеры getTasks, createTask и т.д. ТЕПЕРЬ ДОЛЖНЫ ожидать req.userId
// Убедись, что внутри них используется req.userId и он обрабатывается правильно
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.put('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

// --- Роут Уведомлений (защищенный JWT) ---
// Контроллер sendNotification тоже должен использовать req.userId, если ему нужен ID пользователя
router.post('/notifications', authenticateWithJWT, sendNotification);

export default router;

// Импорты контроллеров уже есть в начале файла, дублировать не нужно
