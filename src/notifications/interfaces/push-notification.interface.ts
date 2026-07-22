export interface PushSubscriptionRecord {
  uid: string;
  token: string;
  platform: 'web';
  deviceId: string;
  userAgent: string | null;
  createdAt: string;
  updatedAt: string;
  active: boolean;
  lastTokenRefreshAt: string;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastFailureCode?: string;
}

export interface FixedExpenseNotificationRecord {
  userId: string;
  category: string;
  dueDate: string | null;
  paymentStatus?: 'pending' | 'partial' | 'paid';
  isPaid?: boolean;
  partialPaymentAmount?: number | null;
}

export interface DueReminderLogRecord {
  uid: string;
  dateKey: string;
  reminderType: 'overdue' | 'due-soon';
  expenseIds: Array<string>;
  sentAt: string;
  deliveredCount: number;
  failedCount: number;
  dueDate: string | null;
  daysUntilDue: number | null;
}

export interface PushConfigResult {
  enabled: boolean;
  vapidPublicKey: string | null;
}

export interface PushStatusResult {
  supported: boolean;
  configured: boolean;
  activeDeviceCount: number;
}

export interface PushSubscribeResult {
  subscribed: boolean;
  activeDeviceCount: number;
}

export interface PushUnsubscribeResult {
  unsubscribed: boolean;
  activeDeviceCount: number;
}

export interface ProcessDueRemindersResult {
  dateKey: string;
  processedUsers: number;
  notifiedUsers: number;
  overdueUsers: number;
  dueSoonUsers: number;
  skippedAlreadySent: number;
  usersWithoutSubscriptions: number;
  deliveredCount: number;
  failedCount: number;
}
