import { body, handler, HttpError, json } from '../lib/core';
import { loadState } from '../lib/admin';
import { deleteBlock, deleteTask, getRoutine, getSettings, getTasks, plan, requireMe, saveBlock, saveDay, saveSettings, saveTask, weeks } from '../lib/me';
import { ukToday } from '../../shared/admin/board';
import { isDate } from '../../shared/admin/me';

// Gainora admin → My day: Adelin's routine, check-ins, scoreboard, to-do list, notes and trading journal.
// Private to the owner of My day (MY_DAY_EMAILS, else the first Gainora admin email).
//   POST /api/admin-me {op: today | day-save | tasks | task-save | task-delete | routine | block-save | block-delete | settings-save | week}
const who = (email: string) => email.split('@')[0].replace(/^./, (c) => c.toUpperCase());
const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

export default handler(async (req) => {
  if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
  const me = await requireMe(req);
  const b = await body<any>(req);
  const date = isDate(b.date) ? b.date : ukToday();
  const fresh = async () => plan(date, await safe(loadState(), null));

  if (b.op === 'today') return json({ plan: await fresh() });
  if (b.op === 'day-save') { await saveDay(date, b.patch ?? {}); return json({ plan: await fresh() }); }

  if (b.op === 'tasks') return json({ tasks: await getTasks(!!b.includeDone) });
  if (b.op === 'task-save') return json({ task: await saveTask(b.task ?? {}, who(me.email)) });
  if (b.op === 'task-delete') { await deleteTask(b.id); return json({ ok: true }); }

  if (b.op === 'routine') { const settings = await getSettings(); return json({ routine: await getRoutine(settings), settings }); }
  if (b.op === 'block-save') return json({ block: await saveBlock(b.block ?? {}) });
  if (b.op === 'block-delete') { await deleteBlock(b.id); return json({ ok: true }); }
  if (b.op === 'settings-save') return json({ settings: await saveSettings(b.settings ?? {}) });

  if (b.op === 'week') return json(await weeks(Number(b.weeks) || 8));
  throw new HttpError(400, 'Unknown action.');
});
export const config = { path: '/api/admin-me', method: 'POST' };
