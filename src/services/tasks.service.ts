import { Task } from '../models/task.model';
import { ITask } from '../types/taskTypes';

export const findTaskById = async (id: string): Promise<ITask | null> => {
  return Task.findById(id).lean().exec();
};

export const createNewTask = async (
  taskData: Omit<ITask, '_id' | 'createdAt' | 'updatedAt'>,
  userId: string, // Добавляем ID пользователя
): Promise<ITask> => {
  const task = new Task({
    ...taskData,
    owner: userId, // Привязываем задачу к пользователю
  });
  return task.save();
};

export const updateTaskById = async (
  id: string,
  updates: Partial<Omit<ITask, '_id' | 'createdAt' | 'updatedAt'>>,
): Promise<ITask | null> => {
  return Task.findByIdAndUpdate(id, updates, {
    new: true,
    runValidators: true,
  }).exec();
};

export const deleteTaskById = async (id: string): Promise<ITask | null> => {
  return Task.findByIdAndDelete(id).exec();
};
