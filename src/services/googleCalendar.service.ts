import { google, calendar_v3 } from 'googleapis'; // Используем типизацию
import { JWT } from 'google-auth-library';
import path from 'path';
import config from '../config'; // Импортируем центральный конфиг
import { ITask } from '../types/taskTypes';

// Получаем значения из конфигурации
const { GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME, GOOGLE_SHARED_CALENDAR_ID, TARGET_TIMEZONE } = config;

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// Переменная для хранения инициализированного клиента API Calendar
// Используем тип из googleapis для лучшей поддержки TypeScript
let calendar: calendar_v3.Calendar | null = null;
let keyPath: string | null = null; // Храним путь к ключу

const initializeCalendarClient = async (): Promise<calendar_v3.Calendar | null> => {
  // Проверяем наличие необходимых конфигурационных значений
  if (!GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME) {
    console.error(
      'Google Calendar Service Error: GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME is not defined in config.',
    );
    return null;
  }
  if (!GOOGLE_SHARED_CALENDAR_ID) {
    console.error(
      'Google Calendar Service Error: GOOGLE_SHARED_CALENDAR_ID is not defined in config.',
    );
    return null;
  }
  if (!TARGET_TIMEZONE) {
    console.error('Google Calendar Service Error: TARGET_TIMEZONE is not defined in config.');
    return null; // Часовой пояс важен
  }

  // Строим абсолютный путь к файлу ключа от корня проекта
  try {
    keyPath = path.resolve(process.cwd(), GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME);
    console.log(`Attempting to load Service Account Key from: ${keyPath}`); // Логируем путь
  } catch (error) {
    console.error('Error resolving service account key path:', error);
    return null;
  }

  try {
    // Аутентификация с использованием сервисного аккаунта
    const auth = new JWT({
      keyFile: keyPath, // Используем построенный абсолютный путь
      scopes: SCOPES,
    });

    await auth.authorize(); // Убедимся, что авторизация прошла

    // Создаем клиент Google Calendar API с типизацией
    calendar = google.calendar({ version: 'v3', auth });
    console.log('✅ Google Calendar client initialized successfully.');
    return calendar;
  } catch (error) {
    console.error('❌ Error initializing Google Calendar client:', error);
    calendar = null; // Сбрасываем клиент при ошибке
    return null;
  }
};

// --- Функция для создания события в календаре ---
export const createCalendarEvent = async (task: ITask): Promise<string | null> => {
  // Проверяем инициализацию клиента
  if (!calendar) {
    console.log('Calendar client not initialized, attempting to initialize...');
    const initializedClient = await initializeCalendarClient();
    if (!initializedClient) {
      console.error('Cannot create calendar event: Google Calendar client failed to initialize.');
      return null;
    }
  }
  // Дополнительная проверка на случай, если инициализация была неуспешной
  if (!calendar || !GOOGLE_SHARED_CALENDAR_ID) {
    console.error(
      'Cannot create calendar event: Client or Calendar ID is missing after init attempt.',
    );
    return null;
  }

  try {
    const startTime = new Date(task.createdAt || Date.now());
    let endTime = new Date(task.deadline);

    // Проверка и установка минимальной длительности (5 минут)
    const minDurationMillis = 5 * 60 * 1000;
    if (endTime.getTime() <= startTime.getTime()) {
      console.warn(
        `GC Event Warning: Deadline ( ${endTime.toISOString()} ) is in the past or same as start time ( ${startTime.toISOString()} ). Setting minimum event duration.`,
      );
      endTime = new Date(startTime.getTime() + minDurationMillis);
    } else if (endTime.getTime() < startTime.getTime() + minDurationMillis) {
      console.warn(
        `GC Event Warning: Deadline ( ${endTime.toISOString()} ) is less than 5 minutes after start time ( ${startTime.toISOString()} ). Setting minimum event duration.`,
      );
      endTime = new Date(startTime.getTime() + minDurationMillis);
    }

    // Формируем объект события для API
    const event: calendar_v3.Schema$Event = {
      summary: `${task.title} (Испольнитель: ${task.assignee?.name || 'Неизвестный'})`, // Добавляем имя в название
      description: `Task Description: ${task.description || 'No description.'}\n\nAssigned to: ${
        task.assignee?.email || 'N/A'
      }`, // Добавляем email в описание
      start: {
        dateTime: startTime.toISOString(),
        timeZone: TARGET_TIMEZONE,
      },
      end: {
        dateTime: endTime.toISOString(),
        timeZone: TARGET_TIMEZONE,
      },
      // attendees: task.assignee ? [{ email: task.assignee.email }] : [], // <<< УБИРАЕМ УЧАСТНИКОВ
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 180 }],
      },
    };

    console.log(
      `Creating Google Calendar event for task "${task.title}" in timezone ${TARGET_TIMEZONE}`,
    );
    console.log(`Event Start: ${event.start?.dateTime}, Event End: ${event.end?.dateTime}`);

    // Выполняем запрос к API
    const createdEvent = await calendar.events.insert({
      calendarId: GOOGLE_SHARED_CALENDAR_ID,
      requestBody: event,
      sendNotifications: true, // Отправить уведомления участникам?
    });

    const eventId = createdEvent.data.id;
    if (eventId) {
      console.log('Google Calendar event created successfully:', eventId);
      return eventId;
    } else {
      console.warn('Google Calendar event created, but no ID returned.');
      return null;
    }
  } catch (error: any) {
    console.error(
      `❌ Failed to create Google Calendar event for task "${task.title}":`,
      error.message || error,
    );
    if (error.response?.data?.error) {
      // Улучшенная проверка ошибки API
      console.error(
        'Google API Error Details:',
        JSON.stringify(error.response.data.error, null, 2),
      );
    } else if (error.errors) {
      // Другой формат ошибок от googleapis
      console.error('Google API Validation Errors:', error.errors);
    }
    return null;
  }
};

// --- Функция для обновления события в календаре ---
export const updateCalendarEvent = async (
  calendarEventId: string,
  taskUpdates: Partial<ITask>,
): Promise<boolean> => {
  if (!calendar) await initializeCalendarClient(); // Проверяем и инициализируем, если нужно
  if (!calendar || !GOOGLE_SHARED_CALENDAR_ID) {
    console.error('Cannot update calendar event: Client or Calendar ID is missing.');
    return false;
  }

  try {
    // Формируем объект только с изменениями для API
    const eventPatch: calendar_v3.Schema$Event = {};
    if (taskUpdates.title !== undefined) eventPatch.summary = taskUpdates.title;
    if (taskUpdates.description !== undefined) eventPatch.description = taskUpdates.description;

    // Обновляем время окончания с указанием часового пояса
    if (taskUpdates.deadline) {
      const newEndTime = new Date(taskUpdates.deadline);
      // Важно: нужно ли обновлять время начала? Зависит от логики.
      // Обновим только конец для простоты.
      eventPatch.end = { dateTime: newEndTime.toISOString(), timeZone: TARGET_TIMEZONE };
      // Если нужно обновлять и начало:
      // const newStartTime = ... ; // Рассчитать новое начало
      // eventPatch.start = { dateTime: newStartTime.toISOString(), timeZone: TARGET_TIMEZONE };
    }

    // Обновление участников (attendees) и напоминаний (reminders) через patch сложнее,
    // часто проще сделать get -> изменить -> update, или они не меняются.
    // Пока не обновляем их здесь.

    // Проверяем, есть ли что обновлять
    if (Object.keys(eventPatch).length === 0) {
      console.log(`No relevant fields to update in Google Calendar event ${calendarEventId}.`);
      return true;
    }

    console.log(`Updating Google Calendar event ${calendarEventId}...`);
    await calendar.events.patch({
      calendarId: GOOGLE_SHARED_CALENDAR_ID,
      eventId: calendarEventId,
      requestBody: eventPatch,
    });
    console.log(`Google Calendar event ${calendarEventId} updated successfully.`);
    return true;
  } catch (error: any) {
    console.error(
      `❌ Failed to update Google Calendar event ${calendarEventId}:`,
      error.message || error,
    );
    if (error.response?.data?.error) {
      console.error(
        'Google API Error Details:',
        JSON.stringify(error.response.data.error, null, 2),
      );
    } else if (error.errors) {
      console.error('Google API Validation Errors:', error.errors);
    }
    return false;
  }
};

// --- Функция для удаления события из календаря ---
export const deleteCalendarEvent = async (calendarEventId: string): Promise<boolean> => {
  if (!calendar) await initializeCalendarClient(); // Проверяем и инициализируем
  if (!calendar || !GOOGLE_SHARED_CALENDAR_ID) {
    console.error('Cannot delete calendar event: Client or Calendar ID is missing.');
    return false;
  }

  try {
    console.log(`Deleting Google Calendar event ${calendarEventId}...`);
    await calendar.events.delete({
      calendarId: GOOGLE_SHARED_CALENDAR_ID,
      eventId: calendarEventId,
      sendNotifications: false, // Не отправлять уведомления об отмене
    });
    console.log(`Google Calendar event ${calendarEventId} deleted successfully.`);
    return true;
  } catch (error: any) {
    // Корректно обрабатываем случай, если событие уже удалено
    if (error.code === 404 || error.code === 410) {
      console.warn(`Google Calendar event ${calendarEventId} not found or already deleted.`);
      return true; // Считаем операцию успешной
    }
    console.error(
      `❌ Failed to delete Google Calendar event ${calendarEventId}:`,
      error.message || error,
    );
    if (error.response?.data?.error) {
      console.error(
        'Google API Error Details:',
        JSON.stringify(error.response.data.error, null, 2),
      );
    } else if (error.errors) {
      console.error('Google API Validation Errors:', error.errors);
    }
    return false;
  }
};

// --- Инициализация клиента при загрузке модуля ---
// Можно обернуть в функцию и вызывать из app.ts после старта сервера,
// но для простоты оставим так. Ошибка инициализации будет в логах.
initializeCalendarClient();
