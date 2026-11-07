import { callInternal } from '../lib/core';

// Every morning at 05:30 UTC: start the public contracts run (the work happens in tenders-background).
export default async () => {
  await callInternal('tenders-background', {});
  return new Response('ok');
};
export const config = { schedule: '30 5 * * *' };
