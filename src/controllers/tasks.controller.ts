import { Request, Response } from 'express';
import { Task } from '../models/task.model';
import { User } from '../models/user.model'; // <<< Импортируй модель User
import { ITask } from '../types/taskTypes';
import mongoose from 'mongoose'; // <<< Импортируй mongoose для проверки ObjectId

// GET /api/tasks - (Без изменений)
export const getTasks = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      // Проверка, что middleware отработал
      return res.status(401).json({ message: 'User ID not found in request after authentication' });
    }
    // Ищем задачи, где поле 'owner' равно ID аутентифицированного пользователя
    const tasks = await Task.find({ owner: req.userId });
    // Или, если пользователь должен видеть и те, что ему назначены:
    // const tasks = await Task.find({ $or: [{ owner: req.userId }, { 'assignee.id': req.userId }] });
    console.log(`Fetched ${tasks.length} tasks for user ${req.userId}`);
    res.json(tasks); // Отправляем найденные задачи
  } catch (err) {
    const error = err as Error;
    console.error('Error fetching tasks:', error);
    res.status(500).json({ message: 'Server error fetching tasks', error: error.message });
  }
};

// POST /api/tasks - Создание задачи (ИСПРАВЛЕНО)
export const createTask = async (req: Request, res: Response) => {
  try {
    // req.userId - это MongoDB ID аутентифицированного пользователя (владельца)
    // req.user - это объект пользователя из MongoDB
    if (!req.userId || !req.user) {
      return res.status(401).json({ message: 'User not properly authenticated' });
    }

    // Данные из тела запроса (от клиента)
    const clientTaskData = req.body;

    // --- Определяем Assignee ---
    let finalAssignee = {
      id: '', // Сюда нужно записать MongoDB ObjectId
      name: '',
      email: '',
    };

    // Пытаемся определить assignee из данных клиента, ИЛИ назначаем владельцу
    if (clientTaskData.assignee && clientTaskData.assignee.email) {
      // Если клиент прислал email исполнителя
      console.log(`Assignee email provided by client: ${clientTaskData.assignee.email}`);
      const assigneeUser = await User.findOne({ email: clientTaskData.assignee.email });

      if (!assigneeUser) {
        console.warn(`Assignee user with email ${clientTaskData.assignee.email} not found in DB.`);
        return res
          .status(400)
          .json({ message: `Assignee user with email ${clientTaskData.assignee.email} not found` });
      }

      // Используем данные найденного пользователя
      finalAssignee.id = assigneeUser.id.toString(); // <<< MongoDB ObjectId
      finalAssignee.name = assigneeUser.name;
      finalAssignee.email = assigneeUser.email;
      console.log(`Found assignee user in DB: ${finalAssignee.name} (ID: ${finalAssignee.id})`);
    } else {
      // Если клиент НЕ прислал email (или объект assignee), назначаем задачу владельцу
      console.log('Assignee email not provided by client, assigning task to the owner.');
      finalAssignee.id = req.userId; // <<< MongoDB ObjectId владельца
      finalAssignee.name = req.user.name;
      finalAssignee.email = req.user.email;
    }

    // Проверка: убедимся, что finalAssignee.id - валидный ObjectId перед созданием Task
    if (!mongoose.Types.ObjectId.isValid(finalAssignee.id)) {
      console.error(
        `Critical Error: finalAssignee.id (${finalAssignee.id}) is not a valid ObjectId before saving task.`,
      );
      return res.status(500).json({ message: 'Internal error processing assignee information.' });
    }

    // --- Создаем финальный объект задачи для сохранения ---
    const taskToSaveData = {
      ...clientTaskData, // Берем title, description, status, deadline от клиента
      owner: req.userId, // Устанавливаем владельца (MongoDB ObjectId)
      assignee: finalAssignee, // Устанавливаем исполнителя с КОРРЕКТНЫМ MongoDB ObjectId в id
    };

    // Удаляем potentially problematic id из assignee если он пришел от клиента с google id
    // Mongoose должен использовать finalAssignee.id
    // delete taskToSaveData.assignee.id; // Можно раскомментировать если будут проблемы

    console.log('Final task data before saving:', JSON.stringify(taskToSaveData, null, 2));

    const task = new Task(taskToSaveData);
    await task.save();
    console.log(
      `Task created by user ${req.userId}, assigned to ${finalAssignee.email} (ID: ${finalAssignee.id}). Task ID: ${task._id}`,
    );
    res.status(201).json(task); // Возвращаем созданную задачу
  } catch (err: any) {
    console.error('Error creating task:', err);
    if (err.name === 'ValidationError') {
      // Логируем детали ошибки валидации
      console.error('Validation Errors:', JSON.stringify(err.errors, null, 2));
      return res
        .status(400)
        .json({ message: 'Validation Error creating task', errors: err.errors });
    }
    // Обработка других возможных ошибок (например, CastError, если deadline неверный)
    res.status(400).json({ message: 'Error creating task', error: err.message });
  }
};

// PUT /api/tasks/:id - Обновление задачи (Проверь логику assignee)
export const updateTask = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'User ID not found in request after authentication' });
    }
    const taskId = req.params.id;
    const updates = req.body;

    // Запрещаем смену владельца
    delete updates.owner;

    // --- Обработка обновления Assignee ---
    if (updates.assignee && updates.assignee.email) {
      // Если клиент хочет изменить assignee по email
      console.log(`Attempting to update assignee by email: ${updates.assignee.email}`);
      const newAssigneeUser = await User.findOne({ email: updates.assignee.email });
      if (!newAssigneeUser) {
        return res.status(400).json({
          message: `Cannot update: Assignee user with email ${updates.assignee.email} not found`,
        });
      }
      // Заменяем объект assignee в updates на объект с MongoDB ID
      updates.assignee = {
        id: newAssigneeUser._id, // <<< MongoDB ObjectId
        name: newAssigneeUser.name,
        email: newAssigneeUser.email,
      };
      console.log(`Updating assignee to: ${updates.assignee.name} (ID: ${updates.assignee.id})`);
    } else if (updates.assignee) {
      // Если клиент прислал объект assignee, но без email (или с ID),
      // это может вызвать проблемы. Лучше удалить его из updates,
      // если мы не поддерживаем смену assignee по ID напрямую от клиента.
      console.warn('Received assignee update without email. Ignoring assignee update.');
      delete updates.assignee;
    }

    // Находим задачу и проверяем права (владелец)
    const task = await Task.findOne({ _id: taskId, owner: req.userId });
    if (!task) {
      const taskExists = await Task.findById(taskId);
      if (!taskExists) return res.status(404).json({ message: 'Task not found' });
      else return res.status(403).json({ message: 'Forbidden: You do not own this task' });
    }

    // Обновляем задачу
    const updatedTask = await Task.findByIdAndUpdate(taskId, updates, {
      new: true,
      runValidators: true,
    });
    console.log(`Task ${taskId} updated by user ${req.userId}`);
    res.json(updatedTask);
  } catch (err: any) {
    console.error('Error updating task:', err);
    if (err.name === 'ValidationError') {
      console.error('Validation Errors:', JSON.stringify(err.errors, null, 2));
      return res
        .status(400)
        .json({ message: 'Validation Error updating task', errors: err.errors });
    }
    if (err.name === 'CastError')
      return res.status(400).json({ message: 'Invalid Task ID format' });
    res.status(400).json({ message: 'Error updating task', error: err.message });
  }
};
// DELETE /api/tasks/:id - Удаление задачи
export const deleteTask = async (req: Request, res: Response) => {
  try {
    if (!req.userId) {
      return res.status(401).json({ message: 'User ID not found in request after authentication' });
    }
    const taskId = req.params.id;

    // Находим задачу и проверяем права доступа (владелец)
    const task = await Task.findOne({ _id: taskId, owner: req.userId });

    if (!task) {
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

    // Удаляем задачу
    await Task.findByIdAndDelete(taskId);

    console.log(`Task ${taskId} deleted by user ${req.userId}`);
    // Отправляем ID удаленной задачи или просто сообщение об успехе
    // res.json({ message: 'Task deleted successfully', deletedTaskId: taskId });
    res.status(200).json({ message: 'Task deleted' }); // 200 OK или 204 No Content
  } catch (err: any) {
    console.error('Error deleting task:', err);
    if (err.name === 'CastError') {
      return res.status(400).json({ message: 'Invalid Task ID format' });
    }
    res.status(500).json({ message: 'Server error deleting task', error: err.message });
  }
};
