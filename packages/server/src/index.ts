import express from 'express';
import { config } from './config.js';

const app = express();

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', name: 'sage' });
});

app.get('/api/hello', (_req, res) => {
  res.json({ message: 'Hello Sage' });
});

app.listen(config.PORT, () => {
  console.log(`Sage server running on http://localhost:${config.PORT}`);
});

export { app };
