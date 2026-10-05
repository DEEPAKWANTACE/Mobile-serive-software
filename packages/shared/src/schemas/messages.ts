/**
 * Ready-made customer messages (sent via WhatsApp click-to-chat today; an SMS/WhatsApp API provider can reuse them).
 * Keep them short and in plain English so staff can edit before sending.
 */
export const MESSAGE_KINDS = ['RECEIVED', 'APPROVAL', 'READY', 'RWR', 'REMINDER'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];
export const MESSAGE_KIND_LABELS: Record<MessageKind, string> = {
  RECEIVED: 'Job received',
  APPROVAL: 'Estimate approval',
  READY: 'Ready for pickup',
  RWR: 'Not repaired — please collect',
  REMINDER: 'Pickup reminder',
};

export type MessageContext = {
  customerName: string;
  jobNumber: string;
  device: string;
  branchName: string;
  branchPhone?: string | null;
  estimate?: number | null;
  balance?: number | null;
};

const rupees = (v: number) => `Rs. ${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function buildMessage(kind: MessageKind, c: MessageContext): string {
  const contact = c.branchPhone ? ` Call us: ${c.branchPhone}.` : '';
  const sign = `\n- ${c.branchName}`;
  switch (kind) {
    case 'RECEIVED':
      return `Dear ${c.customerName}, we have received your ${c.device} for repair. Job No: ${c.jobNumber}.${
        c.estimate ? ` Estimated cost: ${rupees(c.estimate)}.` : ' We will call you with the estimate shortly.'
      } Please keep this job number for reference.${contact}${sign}`;
    case 'APPROVAL':
      return `Dear ${c.customerName}, your ${c.device} (Job ${c.jobNumber}) has been checked. Repair cost: ${rupees(c.estimate ?? 0)}. Please reply YES to approve the repair.${contact}${sign}`;
    case 'READY':
      return `Dear ${c.customerName}, good news! Your ${c.device} (Job ${c.jobNumber}) is repaired and ready for pickup.${
        c.balance && c.balance > 0 ? ` Amount payable: ${rupees(c.balance)}.` : ''
      } Please bring your job sheet.${contact}${sign}`;
    case 'RWR':
      return `Dear ${c.customerName}, your ${c.device} (Job ${c.jobNumber}) could not be repaired. Please collect it at your convenience.${contact}${sign}`;
    case 'REMINDER':
      return `Dear ${c.customerName}, a reminder that your ${c.device} (Job ${c.jobNumber}) is waiting for pickup at our service centre.${contact}${sign}`;
  }
}

/** WhatsApp click-to-chat link for an Indian mobile number. */
export const whatsappLink = (phone: string, text: string) => `https://wa.me/91${phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}`;

/** Suggested message for a job's status. */
export function suggestedMessage(status: string): MessageKind {
  if (status === 'AWAITING_APPROVAL') return 'APPROVAL';
  if (status === 'READY_FOR_DELIVERY') return 'READY';
  if (status === 'RWR' || status === 'CUSTOMER_REJECTED') return 'RWR';
  return 'RECEIVED';
}
