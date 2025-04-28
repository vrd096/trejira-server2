// src/controllers/tasks.controller.ts
import { Request, Response } from 'express';
import { Task } from '../models/task.model';
import { User } from '../models/user.model'; // Импорт модели User
import { ITask } from '../types/taskTypes'; // Импорт типа ITask
import mongoose from 'mongoose'; // Импорт mongoose
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../services/googleCalendar.service'; // Импорт сервисов календаря

// --- GET /api/tasks ---
// Получение задач для аутентифицированного пользователя
export const getTasks = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'User ID not found after authentication' });
    }
    // Ищем задачи, принадлежащие пользователю (или назначенные ему, если нужно)
    const tasks = await Task.find({ owner: req.userId }).sort({ createdAt: -1 }); // Сортируем по дате создания
    console.log(`Fetched ${tasks.length} tasks for user ${req.userId}`);
    res.status(200).json(tasks); // Отправляем найденные задачи
  } catch (err: any) {
    console.error('Error fetching tasks:', err);
    res.status(500).json({ message: 'Server error fetching tasks', error: err.message });
  }
};

// --- POST /api/tasks ---
// Создание новой задачи
export const createTask = async (req: Request, res: Response) => {
  try {
    if (!req.userId || !req.user) {
      return res.status(401).json({ message: 'User not properly authenticated' });
    }

    const clientTaskData = req.body;
    let finalAssignee = { id: '', name: '', email: '' };

    // Определяем исполнителя (Assignee)
    if (clientTaskData.assignee?.email) {
      console.log(`Assignee email provided by client: ${clientTaskData.assignee.email}`);
      const assigneeUser = await User.findOne({ email: clientTaskData.assignee.email });
      if (!assigneeUser) {
        return res
          .status(400)
          .json({ message: `Assignee user with email ${clientTaskData.assignee.email} not found` });
      }
      finalAssignee = {
        id: assigneeUser._id.toString(),
        name: assigneeUser.name,
        email: assigneeUser.email,
      };
      console.log(`Found assignee user in DB: ${finalAssignee.name} (ID: ${finalAssignee.id})`);
    } else {
      console.log('Assignee email not provided, assigning task to the owner.');
      finalAssignee = { id: req.userId, name: req.user.name, email: req.user.email };
    }

    // Проверка валидности ID исполнителя
    if (!mongoose.Types.ObjectId.isValid(finalAssignee.id)) {
      console.error(
        `Critical Error: finalAssignee.id (${finalAssignee.id}) is not valid ObjectId.`,
      );
      return res.status(500).json({ message: 'Internal error processing assignee information.' });
    }

    // Формируем данные для сохранения
    const taskToSaveData: Partial<ITask> & { owner: string } = {
      ...clientTaskData, // title, description, status, deadline etc.
      owner: req.userId, // Устанавливаем владельца
      assignee: finalAssignee, // Устанавливаем исполнителя
      isHidden: false, // Новые задачи всегда активны
    };

    console.log('Final task data before saving:', JSON.stringify(taskToSaveData, null, 2));

    // Сохраняем задачу в MongoDB
    const task = new Task(taskToSaveData);
    const savedTask = await task.save();
    console.log(
      `Task ${savedTask._id} created by user ${req.userId}, assigned to ${finalAssignee.email}`,
    );

    // Интеграция с Google Calendar
    console.log('Attempting to create Google Calendar event...');
    const calendarEventId = await createCalendarEvent(savedTask);
    if (calendarEventId) {
      savedTask.calendarEventId = calendarEventId;
      await savedTask.save(); // Сохраняем ID события в задаче
      console.log(`Saved Calendar Event ID ${calendarEventId} to task ${savedTask._id}`);
    } else {
      console.warn(`Could not create Google Calendar event for task ${savedTask._id}`);
    }

    // Возвращаем созданную задачу клиенту
    res.status(201).json(savedTask);
  } catch (err: any) {
    console.error('Error creating task:', err);
    if (err.name === 'ValidationError') {
      console.error('Validation Errors:', JSON.stringify(err.errors, null, 2));
      return res
        .status(400)
        .json({ message: 'Validation Error creating task', errors: err.errors });
    }
    res.status(400).json({ message: 'Error creating task', error: err.message });
  }
};

// --- PUT /api/tasks/:id ---
// Обновление существующей задачи
export const updateTask = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'User ID not found after authentication' });
    }
    const taskId = req.params.id;
    // Проверяем валидность taskId перед запросом к базе
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ message: 'Invalid Task ID format' });
    }

    const updatesFromBody = req.body;

    // --- Проверка прав доступа ---
    // Находим задачу, чтобы убедиться, что пользователь является владельцем
    const taskToUpdate = await Task.findOne({ _id: taskId, owner: req.userId });
    if (!taskToUpdate) {
      // Проверяем, существует ли задача вообще
      const taskExists = await Task.findById(taskId);
      if (!taskExists) {
        return res.status(404).json({ message: 'Task not found' });
      } else {
        console.warn(
          `User ${req.userId} attempted to update task ${taskId} owned by another user.`,
        );
        return res.status(403).json({ message: 'Forbidden: You do not own this task' });
      }
    }
    // --------------------------

    // --- Обработка обновления Assignee (если нужно) ---
    if (updatesFromBody.assignee && updatesFromBody.assignee.email) {
      console.log(`Attempting to update assignee by email: ${updatesFromBody.assignee.email}`);
      const newAssigneeUser = await User.findOne({ email: updatesFromBody.assignee.email });
      if (!newAssigneeUser) {
        return res
          .status(400)
          .json({
            message: `Cannot update: Assignee user with email ${updatesFromBody.assignee.email} not found`,
          });
      }
      // Заменяем объект assignee на корректный
      updatesFromBody.assignee = {
        id: newAssigneeUser._id,
        name: newAssigneeUser.name,
        email: newAssigneeUser.email,
      };
      console.log(
        `Updating assignee to: ${updatesFromBody.assignee.name} (ID: ${updatesFromBody.assignee.id})`,
      );
    } else if ('assignee' in updatesFromBody) {
      // Проверяем, если assignee передан, но без email
      console.warn(
        'Received assignee update without email or invalid format. Ignoring assignee update.',
      );
      delete updatesFromBody.assignee; // Игнорируем некорректное обновление assignee
    }
    // ---------------------------------------------

    // Запрещаем смену владельца через этот эндпоинт
    delete updatesFromBody.owner;
    // Удаляем поля, которые не должны обновляться напрямую (если такие есть)
    delete updatesFromBody.createdAt;
    delete updatesFromBody.updatedAt;
    delete updatesFromBody.id; // Удаляем 'id', если клиент его прислал
    delete updatesFromBody._id;

    console.log(`Applying updates to task ${taskId}:`, JSON.stringify(updatesFromBody, null, 2));

    // Обновляем задачу в MongoDB
    // findByIdAndUpdate найдет по _id и применит обновления
    const updatedTask = await Task.findByIdAndUpdate(taskId, updatesFromBody, {
      new: true, // Вернуть обновленный документ
      runValidators: true, // Применить валидаторы схемы
    });

    // Проверка, что обновление прошло успешно
    if (!updatedTask) {
      console.error(`Failed to update task ${taskId} even after permission check.`);
      return res.status(404).json({ message: 'Task not found or failed to update' });
    }

    console.log(
      `Task ${taskId} updated in DB by user ${req.userId}. New status: ${updatedTask.status}, isHidden: ${updatedTask.isHidden}`,
    );

    // --- Обновляем событие в Google Calendar, если нужно ---
    // Обновляем, если изменились поля, влияющие на календарь, И если есть calendarEventId
    if (
      updatedTask.calendarEventId &&
      (updatesFromBody.deadline || updatesFromBody.title || updatesFromBody.description)
    ) {
      console.log(`Attempting to update Google Calendar event ${updatedTask.calendarEventId}...`);
      await updateCalendarEvent(updatedTask.calendarEventId, {
        // Передаем только те поля, которые могли измениться
        title: updatesFromBody.title,
        description: updatesFromBody.description,
        deadline: updatesFromBody.deadline,
      });
    } else if (!updatedTask.calendarEventId && updatesFromBody.deadline) {
      // Опционально: если у обновленной задачи НЕТ calendarEventId, но появился/изменился deadline,
      // можно попытаться создать событие заново. Раскомментируй, если нужна эта логика.
      /*
        console.warn(`Task ${taskId} updated with deadline, but no associated Calendar Event ID found. Attempting to create one.`);
        const newCalendarEventId = await createCalendarEvent(updatedTask);
        if (newCalendarEventId) {
           updatedTask.calendarEventId = newCalendarEventId;
           await updatedTask.save(); // Сохраняем новый ID в задаче
        }
        */
    }
    // ----------------------------------------------------

    res.status(200).json(updatedTask); // Возвращаем обновленную задачу
  } catch (err: any) {
    console.error(`Error updating task ${req.params.id}:`, err);
    if (err.name === 'ValidationError') {
      console.error('Validation Errors:', JSON.stringify(err.errors, null, 2));
      return res
        .status(400)
        .json({ message: 'Validation Error updating task', errors: err.errors });
    }
    if (err.name === 'CastError') {
      return res
        .status(400)
        .json({ message: 'Invalid Task ID format or other casting error', path: err.path });
    }
    res.status(500).json({ message: 'Server error updating task', error: err.message });
  }
};

// --- DELETE /api/tasks/:id ---
// Удаление задачи
export const deleteTask = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'User ID not found after authentication' });
    }
    const taskId = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(taskId)) {
      return res.status(400).json({ message: 'Invalid Task ID format' });
    }

    // Находим задачу ДО удаления для проверки прав и получения calendarEventId
    const taskToDelete = await Task.findOne({ _id: taskId, owner: req.userId });
    if (!taskToDelete) {
      const taskExists = await Task.findById(taskId);
      if (!taskExists) {
        return res.status(404).json({ message: 'Task not found' });
      } else {
        console.warn(
          `User ${req.userId} attempted to delete task ${taskId} owned by another user.`,
        );
        return res.status(403).json({ message: 'Forbidden: You do not own this task' });
      }
    }

    const calendarEventIdToDelete = taskToDelete.calendarEventId; // Сохраняем ID

    // --- Удаляем событие из Google Calendar, если оно было ---
    if (calendarEventIdToDelete) {
      console.log(`Attempting to delete Google Calendar event ${calendarEventIdToDelete}...`);
      const deletedFromCalendar = await deleteCalendarEvent(calendarEventIdToDelete);
      if (!deletedFromCalendar) {
        console.warn(
          `Failed or unable to delete Google Calendar event ${calendarEventIdToDelete}, but proceeding with task deletion.`,
        );
        // Не блокируем удаление задачи, если календарь не удалился
      }
    }
    // ----------------------------------------------------

    // Удаляем задачу из MongoDB
    await Task.findByIdAndDelete(taskId);

    console.log(`Task ${taskId} deleted by user ${req.userId}`);
    res.status(200).json({ message: 'Task deleted successfully', deletedTaskId: taskId }); // Возвращаем ID клиенту
  } catch (err: any) {
    console.error(`Error deleting task ${req.params.id}:`, err);
    if (err.name === 'CastError') {
      // Хотя мы уже проверили ID
      return res.status(400).json({ message: 'Invalid Task ID format' });
    }
    res.status(500).json({ message: 'Server error deleting task', error: err.message });
  }
};
