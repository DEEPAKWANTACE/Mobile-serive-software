import { useState } from 'react';
import { buildMessage, MESSAGE_KIND_LABELS, MESSAGE_KINDS, suggestedMessage, whatsappLink, type MessageContext, type MessageKind } from '@msm/shared';
import { Button } from '@/components/ui/Button';
import { Field, inputClass } from '@/components/ui/Field';
import { Modal } from '@/components/ui/Modal';

type Props = { phone: string; status: string; context: MessageContext; size?: 'sm' | 'md' };

/** Opens WhatsApp (app or web) with a ready-made, editable message to the customer. Free — no SMS provider needed. */
export function WhatsAppButton({ phone, status, context, size = 'sm' }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={size} variant="secondary" onClick={() => setOpen(true)} className="text-emerald-700!">
        💬 WhatsApp
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`WhatsApp ${context.customerName} (${phone})`}>
        {open && <Composer phone={phone} initial={suggestedMessage(status)} context={context} onDone={() => setOpen(false)} />}
      </Modal>
    </>
  );
}

function Composer({ phone, initial, context, onDone }: { phone: string; initial: MessageKind; context: MessageContext; onDone: () => void }) {
  const [kind, setKind] = useState<MessageKind>(initial);
  const [text, setText] = useState(() => buildMessage(initial, context));
  return (
    <div className="space-y-4">
      <Field label="Message">
        <select
          value={kind}
          onChange={(e) => {
            const k = e.target.value as MessageKind;
            setKind(k);
            setText(buildMessage(k, context));
          }}
          className={inputClass}
        >
          {MESSAGE_KINDS.map((k) => (
            <option key={k} value={k}>{MESSAGE_KIND_LABELS[k]}</option>
          ))}
        </select>
      </Field>
      <Field label="Text (you can edit)">
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={inputClass} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>Cancel</Button>
        <a href={whatsappLink(phone, text)} target="_blank" rel="noreferrer" onClick={onDone}>
          <Button>Open WhatsApp</Button>
        </a>
      </div>
    </div>
  );
}
