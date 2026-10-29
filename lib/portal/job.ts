/** One job as the customer sees it. */
export type PortalJobView = {
  id: string;
  reference: string;
  address: string;
  status: string;
  scheduledDate: string | null;
  scheduledTime: string | null;
  description: string;
  completionNotes: string | null;
  reason: string | null;
  arrivedAt: string | null;
  completedAt: string | null;
  engineerFirstName: string | null;
};
