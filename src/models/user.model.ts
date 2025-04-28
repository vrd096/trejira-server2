import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  googleId: string; // Поле для хранения Google User ID (sub)
  email: string;
  name: string;
  avatar?: string;
  refreshToken?: string;
  createdAt?: Date;
  updatedAt?: Date;
  _id: string;
}

const UserSchema = new Schema<IUser>(
  {
    // Уникальный индекс для googleId, чтобы не было дубликатов
    googleId: { type: String, required: true, unique: true, index: true },
    // Уникальный индекс для email
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    name: { type: String, required: true },
    avatar: String,
    refreshToken: { type: String },
  },
  { timestamps: true },
);
UserSchema.methods.toJSON = function () {
  const user = this;
  const userObject = user.toObject();
  delete userObject.refreshToken;
  delete userObject.__v; // Также убираем версию Mongoose
  // Добавляем виртуальное поле id, если оно не добавлено глобально в настройках схемы
  if (!userObject.id) {
    userObject.id = userObject._id.toString();
  }
  delete userObject._id; // Удаляем _id
  return userObject;
};

export const User = model<IUser>('User', UserSchema);
