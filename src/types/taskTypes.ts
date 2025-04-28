import { Document } from 'mongoose';

export interface IAssignee {
  id: string;
  name: string;
  email: string;
}

export type TaskStatus = 'todo' | 'in-progress' | 'done';

export interface ITask extends Document {
  title: string;
  description: string;
  status: 'todo' | 'in-progress' | 'done';
  deadline: Date;
  assignee: {
    id: string;
    name: string;
    email: string;
  };
  calendarEventId?: string;
  createdAt?: Date;
  updatedAt?: Date;
  isHidden?: boolean;
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string; // ISO string
  end: string; // ISO string
  description?: string;
  attendees?: Array<{ email: string }>;
}

export interface CalendarState {
  isIntegrated: boolean;
  events: CalendarEvent[];
  loading: boolean;
}

export interface TaskBoardState {
  tasks: ITask[];
  loading: boolean;
  error: string | null;
}

export interface Notification {
  id: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
}
