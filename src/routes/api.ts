import { Router } from 'express';
import { getTasks, createTask, updateTask, deleteTask } from '../controllers/tasks.controller';
import { sendNotification } from '../controllers/notifications.controller';
// --- ВАЖНО: Импортируем ПРАВИЛЬНЫЙ middleware ---
import { authenticateWithGoogleToken } from '../middleware/authenticateWithGoogleToken';
// --- УДАЛИ ИЛИ ЗАКОММЕНТИРУЙ ИМПОРТ СТАРОГО MIDDLEWARE ---
// import { authenticateUser } from '../middleware/authMiddleware';

const router = Router();

// --- Tasks routes (Защищенные) ---
// --- ВАЖНО: Используем ПРАВИЛЬНЫЙ middleware ---
router.use('/tasks', authenticateWithGoogleToken);

// Роуты теперь защищены authenticateWithGoogleToken
router.get('/tasks', getTasks);
router.post('/tasks', createTask);
router.put('/tasks/:id', updateTask);
router.delete('/tasks/:id', deleteTask);

// --- Notifications route (Защищенный) ---
// Тоже используем правильный middleware
router.post('/notifications', authenticateWithGoogleToken, sendNotification);

// --- Убедись, что старый middleware authenticateUser больше нигде не используется в этом файле ---

export default router;
