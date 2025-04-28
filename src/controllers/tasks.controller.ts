// src/controllers/tasks.controller.ts
import { Request, Response } from 'express';
import { Task } from '../models/task.model';
import { User, IUser } from '../models/user.model';
import { ITask } from '../types/taskTypes';
import mongoose, { Types } from 'mongoose';
import {
  createCalendarEvent,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '../services/googleCalendar.service';
import { broadcastTaskUpdate, broadcastTaskDelete } from '../services/websocket.service';

interface AuthenticatedRequest extends Request {
  userId?: string;
}

// --- GET /api/tasks ---
export const getTasks = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User ID not found' });
  }
  try {
    const tasks = await Task.find({ owner: new Types.ObjectId(userId) }).sort({ createdAt: -1 });
    console.log(`Fetched ${tasks.length} tasks for user ${userId}`);
    res.status(200).json(tasks.map((task) => task.toJSON()));
  } catch (err: any) {
    /* ... */
  }
};

// --- POST /api/tasks ---
export const createTask = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User ID not found' });
  }

  try {
    const requestingUser = await User.findById(userId);
    if (!requestingUser) {
      return res.status(401).json({ message: 'User not found in DB' });
    }

    const clientTaskData = req.body;
    let finalAssignee = { id: '', name: '', email: '' };
    let assigneeUser: IUser | null = null;

    if (clientTaskData.assignee?.email) {
      console.log(`Assignee email provided: ${clientTaskData.assignee.email}`);
      assigneeUser = await User.findOne({ email: clientTaskData.assignee.email });
      if (!assigneeUser) {
        // <<< Проверка №1 для assigneeUser
        return res
          .status(400)
          .json({ message: `Assignee user with email ${clientTaskData.assignee.email} not found` });
      }
      // --- Теперь assigneeUser точно не null ---
      finalAssignee = {
        id: assigneeUser._id.toString(),
        name: assigneeUser.name,
        email: assigneeUser.email,
      }; // <<< Ошибки здесь не будет
      console.log(`Found assignee user: ${finalAssignee.name} (ID: ${finalAssignee.id})`);
    } else {
      console.log('Assigning task to the owner.');
      // requestingUser точно не null после проверки выше
      finalAssignee = { id: userId, name: requestingUser.name, email: requestingUser.email };
    }

    if (!mongoose.Types.ObjectId.isValid(finalAssignee.id)) {
      /* ... */
    }

    const taskToSaveData: Partial<ITask> & { owner: string } = {
      ...clientTaskData,
      owner: userId, // userId точно string после первой проверки
      assignee: finalAssignee,
      isHidden: false,
    };

    console.log('Final task data:', JSON.stringify(taskToSaveData, null, 2));

    const task = new Task(taskToSaveData);
    const savedTask = await task.save();
    console.log(
      `Task ${savedTask._id} created by user ${userId}, assigned to ${finalAssignee.email}`,
    );

    // Calendar Integration
    const calendarEventId = await createCalendarEvent(savedTask);
    if (calendarEventId) {
      savedTask.calendarEventId = calendarEventId;
      await savedTask.save();
      console.log(`Saved Calendar Event ID ${calendarEventId} to task ${savedTask._id}`);
    } else {
      /* ... */
    }

    broadcastTaskUpdate(savedTask);
    res.status(201).json(savedTask.toJSON());
  } catch (err: any) {
    /* ... */
  }
};

// --- PUT /api/tasks/:id ---
export const updateTask = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User ID not found' });
  }
  const taskId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    return res.status(400).json({ message: 'Invalid Task ID' });
  }

  try {
    const updatesFromBody = { ...req.body };

    // Check permissions
    const taskToUpdate = await Task.findOne({
      _id: new Types.ObjectId(taskId),
      owner: new Types.ObjectId(userId),
    });
    if (!taskToUpdate) {
      /* ... 404 / 403 handling ... */
    }

    // Handle Assignee Update
    if (updatesFromBody.assignee && updatesFromBody.assignee.email) {
      const newAssigneeUser = await User.findOne({ email: updatesFromBody.assignee.email });
      if (!newAssigneeUser) {
        // <<< Проверка №1 для newAssigneeUser
        return res
          .status(400)
          .json({
            message: `Assignee user with email ${updatesFromBody.assignee.email} not found`,
          });
      }
      // --- Теперь newAssigneeUser точно не null ---
      updatesFromBody.assignee = {
        id: newAssigneeUser._id, // <<< Ошибки здесь не будет
        name: newAssigneeUser.name, // <<< Ошибки здесь не будет
        email: newAssigneeUser.email, // <<< Ошибки здесь не будет
      };
      console.log(
        `Updating assignee to: ${updatesFromBody.assignee.name} (ID: ${updatesFromBody.assignee.id})`,
      );
    } else if ('assignee' in updatesFromBody) {
      delete updatesFromBody.assignee;
    }

    // ... (Очистка запрещенных полей) ...
    delete updatesFromBody.owner;
    delete (updatesFromBody as any).createdAt; // Используем as any для простоты
    delete (updatesFromBody as any).updatedAt;
    delete (updatesFromBody as any).id;
    delete (updatesFromBody as any)._id;
    delete (updatesFromBody as any).calendarEventId;

    console.log(`Applying updates to task ${taskId}:`, JSON.stringify(updatesFromBody, null, 2));

    // Update task in DB
    const updatedTask = await Task.findByIdAndUpdate(taskId, updatesFromBody, {
      new: true,
      runValidators: true,
    });

    if (!updatedTask) {
      // <<< Проверка №1 для updatedTask
      console.error(`Failed to update task ${taskId} or task not found after update.`);
      return res.status(404).json({ message: 'Task not found or failed to update' });
    }
    // --- Теперь updatedTask точно не null ---
    console.log(`Task ${taskId} updated in DB by user ${userId}.`);

    // Update Calendar Event
    const shouldUpdateCalendar =
      updatedTask.calendarEventId && // <<< Ошибки здесь не будет
      (updatesFromBody.deadline || updatesFromBody.title || updatesFromBody.description);
    if (shouldUpdateCalendar) {
      console.log(`Attempting to update Google Calendar event ${updatedTask.calendarEventId}...`);
      await updateCalendarEvent(updatedTask.calendarEventId!, {
        /* ... updates ... */
      });
    } // ...

    // Broadcast WS update
    broadcastTaskUpdate(updatedTask);

    // Send response
    res.status(200).json(updatedTask.toJSON()); // <<< Ошибки здесь не будет
  } catch (err: any) {
    /* ... error handling ... */
  }
};

// --- DELETE /api/tasks/:id ---
export const deleteTask = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.userId;
  if (!userId) {
    return res.status(401).json({ message: 'User ID not found' });
  }
  const taskId = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(taskId)) {
    return res.status(400).json({ message: 'Invalid Task ID' });
  }

  try {
    // Check permissions
    const taskToDelete = await Task.findOne({
      _id: new Types.ObjectId(taskId),
      owner: new Types.ObjectId(userId),
    });
    if (!taskToDelete) {
      // <<< Проверка №1 для taskToDelete
      /* ... 404 / 403 handling ... */
      const taskExists = await Task.findById(taskId);
      if (!taskExists) {
        return res.status(404).json({ message: 'Task not found' });
      } else {
        return res.status(403).json({ message: 'Forbidden: You do not own this task' });
      }
    }
    // --- Теперь taskToDelete точно не null ---

    // Get calendar event ID *after* check
    const calendarEventIdToDelete = taskToDelete.calendarEventId; // <<< Ошибки здесь не будет

    // Delete calendar event
    if (calendarEventIdToDelete) {
      console.log(`Attempting to delete Google Calendar event ${calendarEventIdToDelete}...`);
      await deleteCalendarEvent(calendarEventIdToDelete);
    }

    // Delete task from DB
    await Task.findByIdAndDelete(taskId);
    console.log(`Task ${taskId} deleted by user ${userId}`);

    // Broadcast WS update
    broadcastTaskDelete(taskId);

    res.status(200).json({ message: 'Task deleted successfully', deletedTaskId: taskId });
  } catch (err: any) {
    /* ... error handling ... */
  }
};
