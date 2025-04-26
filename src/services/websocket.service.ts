import { Server, Socket } from 'socket.io';
import { OAuth2Client, TokenPayload } from 'google-auth-library';
import { User, IUser } from '../models/user.model'; // Путь к модели User

// Client ID для проверки токенов WebSocket
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;

if (!GOOGLE_CLIENT_ID) {
  console.error(
    'FATAL ERROR: GOOGLE_CLIENT_ID is not defined in server environment variables for WebSocket.',
  );
  // Не выходим из процесса, но вебсокет не будет работать с аутентификацией
}

const googleAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Расширяем интерфейс Socket для добавления данных пользователя
declare module 'socket.io' {
  interface Socket {
    mongoUserId?: string; // ID пользователя из нашей MongoDB
    userEmail?: string; // Email пользователя
  }
}

export const setupWebSocket = (io: Server) => {
  // --- WebSocket Authentication Middleware ---
  io.use(async (socket, next) => {
    // Получаем токен из handshake (клиент должен передавать его в auth.token)
    const googleToken = socket.handshake.auth?.token;

    if (!googleToken) {
      console.warn('WS Auth: No token provided in handshake.auth');
      return next(new Error('Authentication error: Token required'));
    }

    if (!GOOGLE_CLIENT_ID) {
      console.error('WS Auth: Google Client ID not configured on server.');
      return next(new Error('Server configuration error'));
    }

    try {
      // 1. Верифицируем Google ID токен
      const ticket = await googleAuthClient.verifyIdToken({
        idToken: googleToken,
        audience: GOOGLE_CLIENT_ID,
      });
      const payload: TokenPayload | undefined = ticket.getPayload();

      if (!payload || !payload.sub || !payload.email) {
        console.warn('WS Auth: Invalid Google token payload.');
        return next(new Error('Invalid token payload'));
      }

      const { sub: googleId, email } = payload;

      // 2. Ищем пользователя в нашей базе данных по googleId
      const user = await User.findOne({ googleId: googleId }).select('_id email').lean(); // Загружаем только нужные поля

      if (!user) {
        // Если пользователя нет в БД, не пускаем по WebSocket
        // (Предполагаем, что пользователь должен был войти через HTTP хотя бы раз,
        // чтобы быть созданным, если включено авто-создание в HTTP middleware)
        console.warn(`WS Auth: User with googleId ${googleId} not found in DB.`);
        // Можно отправить более специфичную ошибку
        // return next(new Error('User not registered'));
        return next(new Error('Authentication failed'));
      }

      // 3. Прикрепляем ID пользователя из НАШЕЙ БД к сокету
      socket.mongoUserId = user._id.toString();
      socket.userEmail = user.email;

      console.log(
        `WS Auth: User ${socket.userEmail} (ID: ${socket.mongoUserId}) authenticated for socket ${socket.id}`,
      );
      next(); // Успешная аутентификация
    } catch (error: any) {
      console.error('WS Auth: Google token verification failed:', error.message);
      // Отправляем общую ошибку клиенту
      next(new Error('Invalid token'));
    }
  });

  // --- Connection Handling ---
  io.on('connection', (socket: Socket) => {
    // Этот код выполнится только для УСПЕШНО аутентифицированных сокетов
    console.log(
      `WS Connect: Client connected: ${socket.id} (User ID: ${socket.mongoUserId}, Email: ${socket.userEmail})`,
    );

    // Присоединяем пользователя к комнате с его ID (если нужно слать персональные уведомления)
    if (socket.mongoUserId) {
      socket.join(socket.mongoUserId);
      console.log(`WS Room: Socket ${socket.id} joined room ${socket.mongoUserId}`);
    }

    // --- Обработчики событий от клиента ---
    // Пример: Клиент может отправить событие для обновления задачи
    socket.on('CLIENT_UPDATE_TASK', async (data: { taskId: string; updates: Partial<ITask> }) => {
      if (!socket.mongoUserId) return; // Доп. проверка
      console.log(
        `WS Event: Received CLIENT_UPDATE_TASK from ${socket.mongoUserId} for task ${data.taskId}`,
      );
      try {
        // Здесь должна быть логика обновления задачи, АНАЛОГИЧНАЯ HTTP-контроллеру,
        // включая проверку прав доступа (что пользователь владеет задачей).
        const task = await Task.findOne({ _id: data.taskId, owner: socket.mongoUserId });
        if (!task) {
          socket.emit('TASK_UPDATE_ERROR', {
            taskId: data.taskId,
            message: 'Task not found or permission denied',
          });
          return;
        }
        // Обновляем и сохраняем
        Object.assign(task, data.updates);
        const updatedTask = await task.save();

        // Рассылаем событие TASK_UPDATED всем подключенным клиентам (кроме отправителя)
        socket.broadcast.emit('TASK_UPDATED', updatedTask.toObject()); // Отправляем как plain object
        // Можно отправить подтверждение и самому отправителю
        socket.emit('TASK_UPDATED', updatedTask.toObject());
      } catch (error: any) {
        console.error(`WS Error processing CLIENT_UPDATE_TASK for task ${data.taskId}:`, error);
        socket.emit('TASK_UPDATE_ERROR', { taskId: data.taskId, message: 'Failed to update task' });
      }
    });

    // Пример: Обработка удаления задачи через WS
    socket.on('CLIENT_DELETE_TASK', async (data: { taskId: string }) => {
      if (!socket.mongoUserId) return;
      console.log(
        `WS Event: Received CLIENT_DELETE_TASK from ${socket.mongoUserId} for task ${data.taskId}`,
      );
      try {
        const task = await Task.findOne({ _id: data.taskId, owner: socket.mongoUserId });
        if (!task) {
          socket.emit('TASK_DELETE_ERROR', {
            taskId: data.taskId,
            message: 'Task not found or permission denied',
          });
          return;
        }
        await Task.findByIdAndDelete(data.taskId);

        // Рассылаем событие TASK_DELETED всем
        io.emit('TASK_DELETED', data.taskId); // Отправляем ID удаленной задачи
      } catch (error: any) {
        console.error(`WS Error processing CLIENT_DELETE_TASK for task ${data.taskId}:`, error);
        socket.emit('TASK_DELETE_ERROR', { taskId: data.taskId, message: 'Failed to delete task' });
      }
    });

    // --- Отключение клиента ---
    socket.on('disconnect', (reason) => {
      console.log(
        `WS Disconnect: Client disconnected: ${socket.id} (User ID: ${socket.mongoUserId}). Reason: ${reason}`,
      );
    });
  });
};
interface ITask {
  /* ... */
}
import { Task } from '../models/task.model'; // Путь к модели Task
