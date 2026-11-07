import { callInternal } from '../lib/core';

// Every morning at 06:00 UTC. Scheduled functions must finish in 30 seconds, so the work
// (Watcher runs, weekly summaries, follow-up reminders, monthly results) happens in daily-background.
export default async () => {
  await callInternal('daily-background', {});
  return new Response('ok');
};
export const config = { schedule: '0 6 * * *' };
