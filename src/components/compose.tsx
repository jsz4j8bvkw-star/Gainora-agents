import { useEffect, useState } from 'react';
import { Button, Icon, Loading, Modal, copyText, useToast } from './ui';

/**
 * A drafted message the owner reads, edits and sends from their own phone or email.
 * Gainora never sends it: "I've sent it" only records that they did.
 */
export function Compose(props: {
  title: string;
  load: () => Promise<string> | string;
  phone?: string;
  email?: string;
  note?: string;
  sentLabel?: string;
  onSent?: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    Promise.resolve(props.load()).then((t) => { if (live) setText(t); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  const isEmail = !!text?.startsWith('Subject:');
  const subject = isEmail ? text!.split('\n')[0].replace(/^Subject:\s*/, '') : '';
  const bodyText = isEmail ? text!.split('\n').slice(1).join('\n').trim() : text ?? '';
  const sms = props.phone ? `sms:${props.phone.replace(/\s/g, '')}?&body=${encodeURIComponent(bodyText)}` : null;
  const mail = props.email ? `mailto:${props.email}?subject=${encodeURIComponent(subject || 'Your enquiry')}&body=${encodeURIComponent(bodyText)}` : null;

  const sent = async () => {
    if (!props.onSent) return props.onClose();
    setBusy(true);
    try { await props.onSent(); props.onClose(); }
    catch (e: any) { toast(e?.message || 'That didn’t save. Try again.'); setBusy(false); }
  };

  return (
    <Modal title={props.title} onClose={props.onClose}
      footer={text != null && <>
        <Button kind="quiet" icon="copy" onClick={async () => toast((await copyText(text)) ? 'Copied.' : 'Select the text and copy it.')}>Copy</Button>
        {sms && !isEmail && <a className="btn btn-secondary" href={sms}><Icon name="message" />Open in Messages</a>}
        {mail && <a className="btn btn-secondary" href={mail}><Icon name="mail" />Open in email</a>}
        {props.onSent && <Button busy={busy} icon="check" onClick={sent}>{props.sentLabel ?? 'I’ve sent it'}</Button>}
      </>}>
      {failed ? <div className="panel-pad"><div className="err" role="alert">Couldn’t write it this time. Close and try again.</div></div>
        : text == null ? <Loading label="Writing" />
        : (
          <div className="compose">
            <label className="sr-only" htmlFor="compose-text">Message</label>
            <textarea id="compose-text" className="textarea compose-text" value={text} onChange={(e: any) => setText(e.target.value)} rows={Math.min(14, Math.max(5, text.split('\n').length + 2))} />
            <p className="xsmall faint">{props.note ?? 'Edit it so it sounds like you. Gainora never sends messages for you.'}{!isEmail && text.length > 160 ? ` ${Math.ceil(text.length / 153)} text messages long.` : ''}</p>
          </div>
        )}
    </Modal>
  );
}
