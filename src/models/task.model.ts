// src/models/task.model.ts
import { Schema, model, Types } from 'mongoose';
import { ITask } from '../types/taskTypes';

const TaskSchema = new Schema(
  {
    title: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    status: {
      type: String,
      enum: ['todo', 'in-progress', 'done'],
      default: 'todo',
    },
    deadline: { type: Date, required: true },
    owner: { type: Types.ObjectId, ref: 'User', required: true, index: true },
    assignee: {
      id: { type: Types.ObjectId, ref: 'User', required: true },
      name: { type: String, required: true },
      email: { type: String, required: true },
    },
    calendarEventId: { type: String, index: true },
  },
  {
    timestamps: true,
    // --- ДОБАВЬТЕ ЭТИ ОПЦИИ ---
    toJSON: {
      virtuals: true, // Включаем виртуальные поля (включая 'id') при преобразовании в JSON
      transform(doc, ret) {
        // Опционально: убираем _id и __v из JSON ответа, оставляя только id
        delete ret._id;
        delete ret.__v;
      },
    },
    toObject: {
      virtuals: true, // Включаем виртуальные поля при преобразовании в объект
      transform(doc, ret) {
        // Опционально: убираем _id и __v из объекта
        delete ret._id;
        delete ret.__v;
      },
    },
    // ------------------------
  },
);

// Виртуальное поле id (Mongoose обычно создает его по умолчанию, но явное определение не повредит)
TaskSchema.virtual('id').get(function () {
  return this._id.toHexString();
});

TaskSchema.index({ owner: 1, status: 1 });

export const Task = model<ITask>('Task', TaskSchema);
