import { z } from 'zod';
import type { Role } from '../roles.js';

export const reminderCreateSchema = z.object({
  title: z.string().trim().min(3, 'Enter what you need to remember').max(300),
  dueAt: z.iso.datetime(),
  jobId: z.uuid().nullish(),
  assignedToId: z.uuid().optional(),
});
export type ReminderCreateData = z.output<typeof reminderCreateSchema>;

export const reminderUpdateSchema = z.object({
  title: z.string().trim().min(3).max(300).optional(),
  dueAt: z.iso.datetime().optional(),
  assignedToId: z.uuid().optional(),
}).refine((value) => Object.keys(value).length > 0, 'Nothing to update');
export type ReminderUpdateData = z.output<typeof reminderUpdateSchema>;

export type ReminderAssigneeDto = { id: string; name: string; role: Role };

export type ReminderDto = {
  id: string;
  title: string;
  dueAt: string;
  completedAt: string | null;
  createdAt: string;
  job: { id: string; jobNumber: string } | null;
  createdBy: ReminderAssigneeDto;
  assignedTo: ReminderAssigneeDto;
  canEdit: boolean;
  canComplete: boolean;
};

export type NotificationItemDto = {
  id: string;
  kind: 'REMINDER' | 'JOB_DEADLINE' | 'APPROVAL';
  title: string;
  dueAt: string;
  isDue: boolean;
  jobId: string | null;
  jobNumber: string | null;
  createdBy: string | null;
  assignedTo: string | null;
};

export type NotificationFeedDto = {
  items: NotificationItemDto[];
  dueCount: number;
};
