import { z } from 'zod';

export const reminderCreateSchema = z.object({
  title: z.string().trim().min(3, 'Enter what you need to remember').max(300),
  dueAt: z.iso.datetime(),
  jobId: z.uuid().nullish(),
});
export type ReminderCreateData = z.output<typeof reminderCreateSchema>;

export type NotificationItemDto = {
  id: string;
  kind: 'REMINDER' | 'JOB_DEADLINE' | 'APPROVAL';
  title: string;
  dueAt: string;
  isDue: boolean;
  jobId: string | null;
  jobNumber: string | null;
  createdBy: string | null;
};

export type NotificationFeedDto = {
  items: NotificationItemDto[];
  dueCount: number;
};
