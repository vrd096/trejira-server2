import { Request, Response, NextFunction } from 'express';
import Joi from 'joi';

const taskSchema = Joi.object({
  title: Joi.string().required().min(3).max(100),
  description: Joi.string().max(500),
  status: Joi.string().valid('todo', 'in-progress', 'done'),
  deadline: Joi.date().iso().greater('now'),
  assignee: Joi.object({
    id: Joi.string(),
    name: Joi.string(),
    email: Joi.string().email(),
  }),
});

export const validateTaskInput = (req: Request, res: Response, next: NextFunction) => {
  const { error } = taskSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      message: error.details[0].message,
    });
  }
  next();
};
