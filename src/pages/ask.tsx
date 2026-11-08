import { useEffect, useRef, useState } from 'react';
import { humanThrown } from '../lib/errors';
import { api } from '../lib/api';
import { useApp } from '../app';
import { ErrorNote, Icon, Loading, useLoad } from '../components/ui';
import { pending } from '../components/palette';
import { Link } from '../lib/router';
import type { ChatMessage } from '../lib/types';

export function Ask() {
  const { profile } = useApp();
  const { data, setData, error, loading, reload } = useLoad(() => api.getChat());
  const [text, setText] = useState('');
  const [thinking, setThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  // Scroll to the foot of the page, so the last answer sits above the input box rather than behind it.
  useEffect(() => { if (endRef.current) window.scrollTo({ top: document.documentElement.scrollHeight }); }, [data?.length, thinking]);
  // A question typed in the search palette is sent as soon as the history has loaded.
  useEffect(() => { if (data && pending.ask) { const q = pending.ask; pending.ask = null; send(q); } }, [data !== undefined]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <div className="page"><ErrorNote message={error ?? 'Ask could not load.'} retry={reload} /></div>;

  const send = async (q?: string) => {
    const t = (q ?? text).trim();
    if (!t || thinking) return;
    setText(''); setSendError(null);
    const mine: ChatMessage = { id: 'tmp' + Date.now(), role: 'user', text: t, at: new Date().toISOString() };
    setData([...data, mine]);
    setThinking(true);
    try {
      const reply = await api.sendChat(t);
      setData((d) => [...(d ?? []), reply]);
    } catch (e: any) {
      setSendError(humanThrown(e, 'No answer came back. Try asking again.'));
    } finally { setThinking(false); boxRef.current?.focus(); }
  };

  const starters = [
    'What should I focus on this week?',
    'What have my competitors changed recently?',
    'Who should I contact first from the Scout’s list?',
    'Why did my numbers move this week?',
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
          {thinking && <div className="msg-agent" role="status"><div className="who">Gainora</div><div className="typing" aria-label="Writing an answer"><span /><span /><span /></div></div>}
          {sendError && <ErrorNote message={sendError} />}
          <div ref={endRef} className="chat-end" aria-hidden="true" />
        </div>
        <form className="chat-box" onSubmit={(e: any) => { e.preventDefault(); send(); }}>
          <div className="chat-input">
            <label htmlFor="ask-box" className="sr-only">Your question</label>
            <textarea id="ask-box" ref={boxRef} rows={1} value={text} placeholder="Ask about your business"
              onChange={(e: any) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(160, e.target.scrollHeight) + 'px'; }}
              onKeyDown={(e: any) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
            <button type="submit" className="btn btn-primary btn-small" disabled={!text.trim() || thinking} aria-label="Send question"><Icon name="send" /></button>
          </div>
        </form>
      </div>
    </div>
  );
}
