import { promises as fs } from 'node:fs';
import path from 'node:path';
import { reportDir } from './reportStore.js';

/** Feedback interno captado por la página QR (valoraciones de 1 a 4 estrellas). */
export interface FeedbackEntry {
  id: string;
  rating: number;
  comment?: string;
  contact?: string;
  redirectedToGoogle: boolean;
  createdAt: string;
}

const file = (reportId: string) => path.join(reportDir(reportId), 'qr-feedback.json');

export async function listFeedback(reportId: string): Promise<FeedbackEntry[]> {
  try {
    return JSON.parse(await fs.readFile(file(reportId), 'utf8')) as FeedbackEntry[];
  } catch {
    return [];
  }
}

// Serializa escrituras por informe para no perder entradas concurrentes.
const queues = new Map<string, Promise<unknown>>();

export function addFeedback(reportId: string, entry: FeedbackEntry): Promise<void> {
  const prev = queues.get(reportId) ?? Promise.resolve();
  const next = prev.then(async () => {
    const all = await listFeedback(reportId);
    all.push(entry);
    await fs.writeFile(file(reportId), JSON.stringify(all, null, 2), 'utf8');
  });
  queues.set(reportId, next.catch(() => {}));
  return next;
}
