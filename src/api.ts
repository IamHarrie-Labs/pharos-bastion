import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { guard } from './runtime.js';
import { getAuditLog } from './runtime.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'pharos-bastion', version: '0.1.0' });
});

app.post('/guard', async (req, res) => {
  const { from, to, value, data } = req.body ?? {};
  if (!from || !to) {
    res.status(400).json({ ok: false, error: '`from` and `to` are required.' });
    return;
  }
  try {
    const result = await guard({ from, to, value, data }, { logOnChain: false });
    res.json({ ok: true, ...result });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

app.get('/audit', async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 10), 50);
  try {
    const decisions = await getAuditLog(limit);
    res.json({ ok: true, decisions });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err?.message ?? String(err) });
  }
});

const PORT = Number(process.env.API_PORT ?? 3457);
app.listen(PORT, () => {
  console.log(`Bastion API → http://localhost:${PORT}`);
  console.log(`  POST /guard  — evaluate a transaction`);
  console.log(`  GET  /audit  — read on-chain decisions`);
  console.log(`  GET  /health — status check`);
});
