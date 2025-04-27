import { google, calendar_v3 } from 'googleapis'; // Используем типизацию
import { JWT } from 'google-auth-library';
import path from 'path';
import config from '../config'; // Импортируем центральный конфиг
import { ITask } from '../types/taskTypes';

// Получаем значения из конфигурации
const { GOOGLE_SERVICE_ACCOUNT_KEY_FILENAME, GOOGLE_SHARED_CALENDAR_ID, TARGET_TIMEZONE } = config;

const SCOPES = ['https://www.googleapis.com/auth/calendar.events'];

// Переменная для хранения инициализированного клиента API Calendar
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
    return null;
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
  } catch (error: any) {
    // Добавил any для доступа к message
    console.error('❌ Error initializing Google Calendar client:', error.message || error);
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
  // Дополнительная проверка
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
      // Убираем добавление assignee в название, используем только оригинальное
      summary: task.title,
      // Оставляем описание без изменений или добавляем email если нужно
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
      // Убираем attendees чтобы избежать ошибки 403
      // attendees: task.assignee ? [{ email: task.assignee.email }] : [],
      reminders: {
        useDefault: false,
        overrides: [{ method: 'popup', minutes: 180 }], // Напоминание за 3 часа
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
      // sendNotifications: true, // Можно убрать, так как нет attendees
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
      console.error(
        'Google API Error Details:',
        JSON.stringify(error.response.data.error, null, 2),
      );
    } else if (error.errors) {
      console.error('Google API Validation Errors:', error.errors);
    }
    return null;
  }
};

// --- Функция для обновления события в календаре (Вариант 1 с проверкой времени) ---
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
    let needsTimeCheck = false; // Флаг, что нужно проверить время

    // Обновляем простые поля
    if (taskUpdates.title !== undefined) {
      // Можно снова добавить имя исполнителя, если нужно
      // eventPatch.summary = `${taskUpdates.title} (Испольнитель: ${taskUpdates.assignee?.name || 'Неизвестный'})`;
      eventPatch.summary = taskUpdates.title;
    }
    if (taskUpdates.description !== undefined) {
      // Можно снова добавить email исполнителя
      // eventPatch.description = `Task Description: ${taskUpdates.description}\n\nAssigned to: ${taskUpdates.assignee?.email || 'N/A'}`;
      eventPatch.description = taskUpdates.description;
    }

    // --- Обработка обновления времени ---
    if (taskUpdates.deadline) {
      needsTimeCheck = true; // Помечаем, что нужно проверить время перед patch
      let newEndTime = new Date(taskUpdates.deadline);

      // --- Получаем текущее событие для проверки startTime ---
      console.log(`Fetching current event ${calendarEventId} to check start time...`);
      const currentEventResponse = await calendar.events.get({
        calendarId: GOOGLE_SHARED_CALENDAR_ID,
        eventId: calendarEventId,
      });
      const currentEventData = currentEventResponse.data;

      if (!currentEventData.start?.dateTime) {
        console.error(
          `Could not get current start time for event ${calendarEventId}. Aborting time update.`,
        );
        // Не обновляем время, если не можем получить текущее начало
        needsTimeCheck = false; // Сбрасываем флаг
      } else {
        const currentStartTime = new Date(currentEventData.start.dateTime);
        console.log(`Current event start time: ${currentStartTime.toISOString()}`);
        console.log(`New deadline (end time): ${newEndTime.toISOString()}`);

        // Проверяем новый endTime относительно ТЕКУЩЕГО startTime
        const minDurationMillis = 5 * 60 * 1000; // 5 минут
        if (newEndTime.getTime() <= currentStartTime.getTime()) {
          console.warn(
            `GC Event Update Warning: New deadline is before or same as current start time. Adjusting end time.`,
          );
          // Устанавливаем конец через 5 минут после ТЕКУЩЕГО НАЧАЛА
          newEndTime = new Date(currentStartTime.getTime() + minDurationMillis);
          console.log(`Adjusted end time: ${newEndTime.toISOString()}`);
        } else if (newEndTime.getTime() < currentStartTime.getTime() + minDurationMillis) {
          console.warn(
            `GC Event Update Warning: New deadline is less than 5 minutes after current start time. Adjusting end time.`,
          );
          newEndTime = new Date(currentStartTime.getTime() + minDurationMillis);
          console.log(`Adjusted end time: ${newEndTime.toISOString()}`);
        }

        // Добавляем обновленное время конца в eventPatch
        eventPatch.end = { dateTime: newEndTime.toISOString(), timeZone: TARGET_TIMEZONE };

        // Важно: Если ваша логика требует, чтобы startTime ТОЖЕ менялся
        // (например, всегда был равен времени создания задачи или всегда за N часов до deadline),
        // то нужно обновить и eventPatch.start здесь же.
        // Пример: если start всегда равен времени создания (нужно передать createdAt в taskUpdates):
        // if (taskUpdates.createdAt) {
        //    eventPatch.start = { dateTime: new Date(taskUpdates.createdAt).toISOString(), timeZone: TARGET_TIMEZONE };
        // }
        // Если НЕ обновляем start, он останется прежним.
      }
    }
    // --- Конец обработки обновления времени ---

    // Проверяем, есть ли что обновлять вообще
    if (Object.keys(eventPatch).length === 0) {
      console.log(`No fields to update in Google Calendar event ${calendarEventId}.`);
      return true;
    }

    // Если время не проверялось (т.к. deadline не менялся ИЛИ произошла ошибка при get),
    // или если проверка прошла успешно, выполняем patch
    if (!needsTimeCheck || eventPatch.end) {
      console.log(
        `Updating Google Calendar event ${calendarEventId}... Patch data:`,
        JSON.stringify(eventPatch),
      );
      await calendar.events.patch({
        calendarId: GOOGLE_SHARED_CALENDAR_ID,
        eventId: calendarEventId,
        requestBody: eventPatch,
      });
      console.log(`Google Calendar event ${calendarEventId} updated successfully.`);
      return true;
    } else {
      // Сюда попадем, если deadline менялся, но не удалось проверить/скорректировать время
      console.error(
        `Skipping calendar event update for ${calendarEventId} due to issues fetching current start time.`,
      );
      return false; // Или true, если обновление времени не критично
    }
  } catch (error: any) {
    console.error(
      `❌ Failed to update or fetch Google Calendar event ${calendarEventId}:`,
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
initializeCalendarClient();
