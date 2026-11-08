import { useEffect, useRef, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { useApp } from '../app';
import { Button, ErrorNote, Icon, Loading, useLoad } from '../components/ui';
import { pending } from '../components/palette';
import { Link } from '../lib/router';
import { mergeChat, waitingText } from '../../shared/chat';
import type { ChatMessage } from '../lib/types';

export function Ask() {
  const { profile } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.getChat());
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState<{ since: number; question: string } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [sendError, setSendError] = useState<{ message: string; question: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);
  const lastCount = useRef(0);

  // Scroll to the foot of the page, so the last answer sits above the input box rather than behind it.
  useEffect(() => {
    if (!data) return;
    if (data.length !== lastCount.current || thinking) window.scrollTo({ top: document.documentElement.scrollHeight });
    lastCount.current = data.length;
  }, [data?.length, thinking]);
  // A question typed in the search palette is sent as soon as the history has loaded.
  useEffect(() => { if (data && pending.ask) { const q = pending.ask; pending.ask = null; send(q); } }, [data !== undefined]);
  // While waiting, keep the owner posted on how long it is taking.
  useEffect(() => {
    if (!thinking) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(Date.now() - thinking.since), 1000);
    return () => clearInterval(t);
  }, [thinking]);
  // Coming back to the tab or unlocking the phone: fetch the conversation again, in case the answer landed meanwhile.
  useEffect(() => {
    const on = () => { if (document.visibilityState === 'visible' && (thinking || sendError)) refresh(); };
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [thinking, sendError]);

  /** Fetches the conversation from the server and merges it over what is on screen; any saved answer appears. */
  const refresh = async (): Promise<ChatMessage[] | null> => {
    setChecking(true);
    try {
      const server = await api.getChat();
      let merged: ChatMessage[] = [];
      setData((d) => { merged = mergeChat(d ?? [], server); return merged; });
      return merged;
    } catch { return null; }
    finally { setChecking(false); }
  };

  const send = async (q?: string) => {
    const t = (q ?? text).trim();
    if (!t || thinking) return;
    setText(''); setSendError(null);
    if (boxRef.current) boxRef.current.style.height = 'auto';
    const mine: ChatMessage = { id: 'tmp' + Date.now(), role: 'user', text: t, at: new Date().toISOString() };
    setData((d) => [...(d ?? []), mine]);
    setThinking({ since: Date.now(), question: t });
    try {
      const reply = await api.sendChat(t);
      setData((d) => [...(d ?? []), reply]);
      // The server copy is the record: fetch it once so ids and order match what is saved.
      refresh();
    } catch (e: any) {
      setSendError({ message: humanThrown(e, 'No answer came back. Try asking again.'), question: t });
      // The answer may have been saved even though the reply didn't reach us: look.
      const merged = await refresh();
      if (merged && merged.length && merged[merged.length - 1].role === 'agent' && merged[merged.length - 1].at > mine.at) setSendError(null);
    } finally { setThinking(null); boxRef.current?.focus(); }
  };

  const retry = async () => {
    const q = sendError?.question;
    setSendError(null);
    // The question is already saved; remove our local copy so it is not shown twice when re-sent.
    setData((d) => (d ?? []).filter((m) => !(m.id.startsWith('tmp') && m.text === q)));
    if (q) await send(q);
  };

  if (loading && !data) return <Loading />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'Ask could not load.'} retry={reload} /></div>;

  const starters = [
    'What should I focus on this week?',
    'How do my prices compare with the clinics near me?',
    'Which competitor looks busiest right now, and why?',
    'What have my competitors changed recently?',
  ];

  return (
    <div className="page" style={{ maxWidth: 820 }}>
      <div className="page-head">
        <div>
          <h1 className="title">Ask</h1>
          <p className="lede">Ask anything about {profile.business.name}. Answers come from your business details and your agents’ latest findings, and each one says which finding it used.</p>
        </div>
      </div>

      <div className="chat">
        <div className="chat-log" aria-live="polite">
          {data.length === 0 && (
            <div className="stack gap-12">
              <p className="muted">Try one of these:</p>
              <div className="suggestions">{starters.map((s) => <button key={s} className="suggestion" onClick={() => send(s)}>{s}</button>)}</div>
            </div>
          )}
          {data.map((m) => m.role === 'user'
            ? <div className="msg-user" key={m.id}>{m.text}</div>
            : (
              <div className="msg-agent" key={m.id}>
                <div className="who">Gainora</div>
                <div className="voice">{m.text}</div>
                {m.sources && m.sources.length > 0 && (
                  <div className="xsmall faint mt-8 msg-sources">From: {m.sources.map((s, i) => <span key={s.url + i}>{i > 0 && ', '}{s.url.startsWith('/') ? <Link to={s.url}>{s.title}</Link> : <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a>}</span>)}</div>
                )}
              </div>
            ))}
          {thinking && (
            <div className="msg-agent" role="status">
              <div className="who">Gainora</div>
              <div className="row gap-12 wrap">
                <div className="typing" aria-hidden="true"><span /><span /><span /></div>
                <span className="small muted">{waitingText(elapsed)}{elapsed >= 12_000 ? ` (${Math.round(elapsed / 1000)} s)` : ''}.</span>
              </div>
            </div>
          )}
          {sendError && (
            <div className="err row gap-12 wrap" role="alert" style={{ justifyContent: 'space-between' }}>
              <span>{sendError.message}</span>
              <span className="row gap-8 wrap">
                <Button kind="secondary" small busy={checking} onClick={() => refresh()}>Check for an answer</Button>
                <Button kind="secondary" small onClick={retry}>Ask again</Button>
              </span>
            </div>
          )}
          <div ref={endRef} className="chat-end" aria-hidden="true" />
        </div>
        <form className="chat-box" onSubmit={(e: any) => { e.preventDefault(); send(); }}>
          <div className="chat-input">
            <label htmlFor="ask-box" className="sr-only">Your question</label>
            <textarea id="ask-box" ref={boxRef} rows={1} value={text} placeholder="Ask about your business"
              onChange={(e: any) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; }}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button type="submit" className="btn btn-primary btn-small" disabled={!text.trim() || !!thinking} aria-label="Send question"><Icon name="send" /></button>
          </div>
        </form>
      </div>
    </div>
  );
}
