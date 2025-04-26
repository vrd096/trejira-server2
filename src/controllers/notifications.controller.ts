import { Request, Response } from 'express';
import { io } from '../app';

export const sendNotification = async (req: Request, res: Response) => {
  try {
    const { userId, title, body } = req.body;

    // В реальном приложении здесь была бы отправка push-уведомления
    io.to(userId).emit('NOTIFICATION', { title, body });

    res.status(200).json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send notification' });
  }
};
