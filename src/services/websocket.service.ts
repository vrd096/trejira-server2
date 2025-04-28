// src/services/websocket.service.ts
import { Server, Socket } from 'socket.io';
import jwt, { JwtPayload } from 'jsonwebtoken';
import mongoose, { Types } from 'mongoose'; // Импортируем Types
import config from '../config';
import { ITask } from '../types/taskTypes'; // Серверный тип ITask
import { Task } from '../models/task.model';
import { deleteCalendarEvent } from '../services/googleCalendar.service';

// Расширение Socket
declare module 'socket.io' {
  interface Socket {
    mongoUserId?: string;
  }
}

let ioInstance: Server | null = null;

export const setupWebSocket = (io: Server) => {
  ioInstance = io; // Сохраняем экземпляр io

  // --- WebSocket Authentication Middleware (JWT Access Token) ---
  io.use(async (socket, next) => {
    const accessToken = socket.handshake.auth?.token;
    if (!accessToken) {
      console.warn('WS Auth Middleware: No token provided.');
      return next(new Error('Authentication error: Token required'));
    }
    try {
      const decoded = jwt.verify(accessToken, config.JWT_SECRET) as JwtPayload;
      const userId = decoded.userId;
      if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
        console.warn('WS Auth Middleware: Invalid userId in JWT payload.');
        return next(new Error('Invalid token payload'));
      }
      socket.mongoUserId = userId;
      console.log(`WS Auth Middleware: User ${userId} authenticated for socket ${socket.id}`);
      next();
    } catch (error: any) {
      console.error('WS Auth Middleware: Access token verification failed:', error.message);
      if (error instanceof jwt.TokenExpiredError) {
        return next(new Error('Access token expired'));
      }
      if (error instanceof jwt.JsonWebTokenError) {
        return next(new Error('Invalid access token'));
      }
      return next(new Error('Authentication failed'));
    }
  });

  // --- Обработчик Успешного Подключения ---
  io.on('connection', (socket: Socket) => {
    console.log(`WS Connect: Client connected: ${socket.id} (User ID: ${socket.mongoUserId})`);
    if (socket.mongoUserId) {
      socket.join(socket.mongoUserId);
      console.log(`WS Room: Socket ${socket.id} joined room ${socket.mongoUserId}`);
    }

    // --- Обработчик обновления задачи от клиента ---
    socket.on('CLIENT_UPDATE_TASK', async (data: { taskId: string; updates: Partial<ITask> }) => {
      const userId = socket.mongoUserId;
      if (!userId) {
        return;
      } // Игнорируем, если нет ID

      const taskId = data.taskId;
      let updatesPayload: Partial<ITask> = { ...data.updates }; // Копируем обновления

      console.log(`WS Event: Received CLIENT_UPDATE_TASK from user ${userId} for task ${taskId}`);

      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        socket.emit('TASK_UPDATE_ERROR', { taskId: taskId, message: 'Invalid task ID format' });
        return;
      }

      try {
        // Находим задачу и проверяем права доступа
        const task = await Task.findOne({
          _id: new Types.ObjectId(taskId),
          owner: new Types.ObjectId(userId),
        });
        if (!task) {
          socket.emit('TASK_UPDATE_ERROR', {
            taskId: taskId,
            message: 'Task not found or permission denied',
          });
          return;
        }

        // --- Очистка данных перед обновлением ---
        // Удаляем поля, которые не должны обновляться, используя 'as any' для обхода TS ошибки
        delete (updatesPayload as any).owner; // <<< ИСПРАВЛЕНИЕ ЗДЕСЬ
        delete (updatesPayload as any).createdAt;
        delete (updatesPayload as any).updatedAt;
        delete (updatesPayload as any)._id;
        delete (updatesPayload as any).id;
        delete (updatesPayload as any).calendarEventId;
        if ('assignee' in updatesPayload) {
          delete updatesPayload.assignee; // Запрещаем обновление assignee через WS
        }
        // ---------------------------------------

        // Применяем разрешенные обновления
        task.set(updatesPayload);
        const updatedTask = await task.save();
        console.log(`WS Event 'CLIENT_UPDATE_TASK': Task ${taskId} updated successfully in DB.`);

        // Рассылаем обновленную задачу всем клиентам
        broadcastTaskUpdate(updatedTask);
      } catch (error: any) {
        console.error(`WS Error processing CLIENT_UPDATE_TASK for task ${taskId}:`, error);
        if (error.name === 'ValidationError') {
          socket.emit('TASK_UPDATE_ERROR', {
            taskId: taskId,
            message: 'Validation failed',
            errors: error.errors,
          });
        } else {
          socket.emit('TASK_UPDATE_ERROR', {
            taskId: taskId,
            message: error.message || 'Failed to update task',
          });
        }
      }
    });

    // --- Обработчик удаления задачи от клиента ---
    socket.on('CLIENT_DELETE_TASK', async (data: { taskId: string }) => {
      const userId = socket.mongoUserId;
      if (!userId) {
        return;
      }
      const taskId = data.taskId;
      if (!mongoose.Types.ObjectId.isValid(taskId)) {
        socket.emit('TASK_DELETE_ERROR', { taskId: taskId, message: 'Invalid task ID format' });
        return;
      }

      console.log(`WS Event: Received CLIENT_DELETE_TASK from user ${userId} for task ${taskId}`);
      try {
        const taskToDelete = await Task.findOne({
          _id: new Types.ObjectId(taskId),
          owner: new Types.ObjectId(userId),
        });
        if (!taskToDelete) {
          socket.emit('TASK_DELETE_ERROR', {
            taskId: taskId,
            message: 'Task not found or permission denied',
          });
          return;
        }

        const calendarEventIdToDelete = taskToDelete.calendarEventId;
        if (calendarEventIdToDelete) {
          console.log(
            `WS: Attempting to delete Google Calendar event ${calendarEventIdToDelete}...`,
          );
          await deleteCalendarEvent(calendarEventIdToDelete);
        }

        await Task.findByIdAndDelete(taskId);
        console.log(`WS Event 'CLIENT_DELETE_TASK': Task ${taskId} deleted successfully from DB.`);

        broadcastTaskDelete(taskId); // Рассылаем ID удаленной задачи
      } catch (error: any) {
        console.error(`WS Error processing CLIENT_DELETE_TASK for task ${taskId}:`, error);
        socket.emit('TASK_DELETE_ERROR', {
          taskId: taskId,
          message: error.message || 'Failed to delete task',
        });
      }
    });

    // --- Обработчик Отключения Клиента ---
    socket.on('disconnect', (reason) => {
      console.log(
        `WS Disconnect: Client disconnected: ${socket.id} (User ID: ${socket.mongoUserId}). Reason: ${reason}`,
      );
    });
  }); // Конец io.on('connection')
}; // Конец функции setupWebSocket

// --- Функции для Рассылки Сообщений (ЭКСПОРТИРУЕМЫЕ) ---
export const broadcastTaskUpdate = (task: ITask | any) => {
  if (!ioInstance) {
    console.error('WS Broadcast Error: ioInstance is not available.');
    return;
  }
  const taskObject = typeof task.toJSON === 'function' ? task.toJSON() : task;
  if (!taskObject?.id) {
    console.error("WS Broadcast Error: Task object missing 'id'.", taskObject);
    return;
  }
  console.log(`WS Broadcast: Emitting TASK_UPDATED for task ${taskObject.id}`);
  ioInstance.emit('TASK_UPDATED', taskObject);
};

export const broadcastTaskDelete = (taskId: string) => {
  if (!ioInstance) {
    console.error('WS Broadcast Error: ioInstance is not available.');
    return;
  }
  if (!taskId || !mongoose.Types.ObjectId.isValid(taskId)) {
    console.error(`WS Broadcast Error: Invalid taskId: ${taskId}`);
    return;
  }
  console.log(`WS Broadcast: Emitting TASK_DELETED for task ${taskId}`);
  ioInstance.emit('TASK_DELETED', taskId);
};
// ---------------------------------------------------------
