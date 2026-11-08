import { callInternal } from '../lib/core';

// Every 5 minutes: timed messages (reminders, chasers, payment reminders, review requests).
// Scheduled functions must finish in 30 seconds, so the work happens in automations-background.
export default async () => {
  await callInternal('automations-background', {});
  return new Response('ok');
};
export const config = { schedule: '*/5 * * * *' };
