import config from './config';
import { server } from './app';

const startServer = () => {
  server.listen(config.PORT, () => {
    console.log(`Server running on port ${config.PORT}`);
  });
};

startServer();
