// import WebSocket from 'ws';
// import { Server } from 'http';
// import { ITask } from './types/taskTypes';

// export function setupWebSocket(server: Server) {
//   const wss = new WebSocket.Server({ server });

//   wss.on('connection', (ws) => {
//     console.log('New client connected');

//     ws.on('message', (message: string) => {
//       console.log('Received:', message);
//       // Здесь можно обрабатывать входящие сообщения
//     });

//     ws.on('close', () => {
//       console.log('Client disconnected');
//     });
//   });

//   // Функция для широковещательной рассылки обновлений задач
//   function broadcastTaskUpdate(task: ITask) {
//     wss.clients.forEach((client) => {
//       if (client.readyState === WebSocket.OPEN) {
//         client.send(
//           JSON.stringify({
//             type: 'TASK_UPDATED',
//             payload: task,
//           }),
//         );
//       }
//     });
//   }

//   // Функция для широковещательной рассылки удаления задач
//   function broadcastTaskDeletion(taskId: string) {
//     wss.clients.forEach((client) => {
//       if (client.readyState === WebSocket.OPEN) {
//         client.send(
//           JSON.stringify({
//             type: 'TASK_DELETED',
//             payload: taskId,
//           }),
//         );
//       }
//     });
//   }

//   return {
//     broadcastTaskUpdate,
//     broadcastTaskDeletion,
//   };
// }
