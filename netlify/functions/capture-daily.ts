import { callInternal } from '../lib/core';

// Every morning at 07:00 UTC (7am in winter, 8am in summer). Scheduled functions must finish in
// 30 seconds, so the work happens in capture-daily-background.
export default async () => {
  await callInternal('capture-daily-background', {});
  return new Response('ok');
};
export const config = { schedule: '0 7 * * *' };
