import { useState } from 'react';
import { api } from '../lib/api';
import { REASONS, type FeedbackKind } from '../../shared/learning';
import { Icon, useToast } from './ui';

/**
 * "Useful" / "Not relevant" on anything an agent produces. Answers are stored and turned into
 * rules the agents follow (see shared/learning.ts), and the owner can review them under Your business.
 */
export function Feedback(props: {
  agent: 'watcher' | 'scout' | 'brief'; kind: FeedbackKind; id: string; text: string;
  host?: string; changeKind?: string; onNotRelevant?: () => void; onUseful?: () => void;
}) {
  const [state, setState] = useState<'idle' | 'asking' | 'useful' | 'not'>('idle');
  const toast = useToast();

  const send = async (verdict: 'useful' | 'not_relevant', reason?: string) => {
    setState(verdict === 'useful' ? 'useful' : 'not');
    try {
      await api.sendFeedback({ agent: props.agent, itemKind: props.kind, itemId: props.id, verdict, reason, text: props.text, host: props.host, changeKind: props.changeKind });
      if (verdict === 'useful') props.onUseful?.(); else props.onNotRelevant?.();
    } catch {
      setState('idle');
      toast('That didn’t save. Try again.');
    }
  };

  if (state === 'useful') return <span className="fb-done" role="status"><Icon name="check" />Thanks. You’ll see more like this.</span>;
  if (state === 'not') return <span className="fb-done" role="status"><Icon name="check" />Noted. You’ll see fewer like this.</span>;
  if (state === 'asking') {
    return (
      <div className="fb-ask" role="group" aria-label="Why isn’t this relevant?">
        <span className="fb-q">What’s wrong with it?</span>
        {REASONS[props.kind].map((r) => <button key={r} type="button" className="fb-chip" onClick={() => send('not_relevant', r)}>{r}</button>)}
        <button type="button" className="fb-chip fb-skip" onClick={() => send('not_relevant')}>Skip</button>
      </div>
    );
  }
  return (
    <div className="fb" role="group" aria-label="Was this useful?">
      <button type="button" className="fb-btn" onClick={() => send('useful')}><Icon name="thumbUp" />Useful</button>
      <button type="button" className="fb-btn" onClick={() => setState('asking')}><Icon name="thumbDown" />Not relevant</button>
    </div>
  );
}
