import { Schema, model, Document } from 'mongoose';

export interface IUser extends Document {
  googleId: string; // Поле для хранения Google User ID (sub)
  email: string;
  name: string;
  avatar?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    // Уникальный индекс для googleId, чтобы не было дубликатов
    googleId: { type: String, required: true, unique: true, index: true },
    // Уникальный индекс для email
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    name: { type: String, required: true },
    avatar: String,
  },
  { timestamps: true },
);

export const User = model<IUser>('User', UserSchema);
