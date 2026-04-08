import express from 'express';
import cors from 'cors';
import routes from './routes/index.js';
import { env } from './config/env.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ ok: true, service: 'sikka-backend', env: env.nodeEnv }));
app.use('/api/v1', routes);
app.use(errorHandler);

app.listen(env.port, () => {
  console.log(`Sikka backend running on port ${env.port}`);
});
