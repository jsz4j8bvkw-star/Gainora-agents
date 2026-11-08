// Ask: the pure parts of a robust conversation.
//
// How an answer travels: the question is saved to chat_messages first, the answer is written
// in the background and saved as the next agent message, and the app polls the conversation
// until it appears. So an answer the server produced can never be lost on the way to the
// screen: a page refresh, a locked phone or a slow network only delays it.

export interface ChatMsgLike { id: string; role: 'user' | 'agent'; text: string; at: string }

/** The first agent message written after the question (by time, then by position). */
export function replyAfter<T extends ChatMsgLike>(messages: T[], question: Pick<ChatMsgLike, 'id' | 'at'>): T | null {
  const qt = new Date(question.at).getTime();
  const idx = messages.findIndex((m) => m.id === question.id);
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m.role !== 'agent') continue;
    const mt = new Date(m.at).getTime();
    if ((idx >= 0 && i > idx) || (idx < 0 && Number.isFinite(qt) && mt >= qt)) return m;
  }
  return null;
}

/** Server copy wins; anything local that the server does not have yet (an unsent draft) is kept at the end. */
export function mergeChat<T extends ChatMsgLike>(local: T[], server: T[]): T[] {
  const have = new Set(server.map((m) => m.id));
  const texts = new Set(server.map((m) => `${m.role}|${m.text}`));
  const extra = local.filter((m) => !have.has(m.id) && !(m.id.startsWith('tmp') && texts.has(`${m.role}|${m.text}`)));
  return [...server, ...extra].sort((a, b) => a.at.localeCompare(b.at));
}

/** What the owner reads while waiting. Honest about time, and tells them the answer is safe. */
export function waitingText(elapsedMs: number): string {
  if (elapsedMs < 12_000) return 'Writing an answer';
  if (elapsedMs < 30_000) return 'Still writing. Answers usually take 5 to 15 seconds';
  return 'Taking longer than usual. The answer is saved to this conversation when it is ready, so you can come back to it';
}

/** The schedule for polling the conversation: quick at first, then every few seconds, for about 90 seconds. */
export const POLL_DELAYS_MS = [1200, 1500, 1500, 2000, 2000, 2500, 3000, 3000, 3000, 4000, 4000, 5000, 5000, 5000, 5000, 6000, 6000, 6000, 8000, 8000, 8000];

/** The message saved when an answer could not be written, so a question never goes unanswered. */
export function failureReply(reason?: string | null): string {
  const r = (reason || '').trim();
  const plain = r && !/json|token|fetch|undefined|error:|exception|timeout|timed out|status \d{3}/i.test(r) ? r : '';
  return plain ? `I couldn’t answer that just now. ${plain}` : 'I couldn’t answer that just now because the writing service didn’t respond. Ask again in a minute and I’ll pick it up.';
}
