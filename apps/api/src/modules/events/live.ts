import { EventEmitter } from 'node:events';
import { Router, type RequestHandler } from 'express';

/**
 * Live updates: open screens keep a stream to GET /events and reload their job data when a job changes,
 * so nobody works from a stale screen. The bus is in memory, which is enough because the API runs as one process.
 */
type JobChange = { jobId: string | null; branchId: string | null };

const bus = new EventEmitter();
bus.setMaxListeners(0);

const HEARTBEAT_MS = 25_000; // below nginx's 60 s proxy read timeout
const JOB_ID = /^\/([0-9a-f-]{36})(?:\/|$)/i;

/** Mounted in front of a router: after a successful write, tell open screens in the same branch to reload. */
export const announceJobWrites: RequestHandler = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (res.statusCode >= 400) return;
    bus.emit('job', { jobId: JOB_ID.exec(req.path)?.[1] ?? null, branchId: req.auth?.branchId ?? null } satisfies JobChange);
  });
  next();
};

export const eventRoutes = Router();

eventRoutes.get('/', (req, res) => {
  const viewerBranch = req.auth!.branchId;
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 5000\n\n');

  // Branch staff hear about their own branch; Super Admin (no branch) and changes made by Super Admin go to everyone.
  const onJob = (change: JobChange) => {
    if (viewerBranch && change.branchId && change.branchId !== viewerBranch) return;
    res.write(`event: job\ndata: ${JSON.stringify({ jobId: change.jobId })}\n\n`);
  };
  bus.on('job', onJob);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    bus.off('job', onJob);
  });
});
