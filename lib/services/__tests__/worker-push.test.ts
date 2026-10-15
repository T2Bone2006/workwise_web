import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendExpoPushMessages = vi.fn<(messages: unknown) => Promise<void>>();
vi.mock('@/lib/services/expo-push', () => ({
  sendExpoPushMessages: (messages: unknown) => sendExpoPushMessages(messages),
}));

import { sendJobsAssignedPushToWorker } from '@/lib/services/worker-push';

describe('sendJobsAssignedPushToWorker', () => {
  beforeEach(() => {
    sendExpoPushMessages.mockReset();
    sendExpoPushMessages.mockResolvedValue(undefined);
  });

  it('sends one notification for a batch, and opens the job when there is only one', async () => {
    await sendJobsAssignedPushToWorker({
      token: 'ExponentPushToken[a]',
      jobs: [
        { jobId: 'j1', referenceNumber: 'WW-1' },
        { jobId: 'j2', referenceNumber: 'WW-2' },
      ],
    });
    expect(sendExpoPushMessages).toHaveBeenCalledWith([
      {
        to: 'ExponentPushToken[a]',
        title: '2 new jobs',
        body: 'Open the app to see them.',
        data: { type: 'job_assigned' },
        sound: 'default',
      },
    ]);

    await sendJobsAssignedPushToWorker({
      token: 'ExponentPushToken[a]',
      jobs: [{ jobId: 'j1', referenceNumber: 'WW-1' }],
    });
    expect(sendExpoPushMessages).toHaveBeenLastCalledWith([
      {
        to: 'ExponentPushToken[a]',
        title: 'New job assigned',
        body: 'WW-1 — open the app for details.',
        data: { jobId: 'j1', job_id: 'j1', type: 'job_assigned' },
        sound: 'default',
      },
    ]);
  });

  it('stays quiet without a token', async () => {
    await sendJobsAssignedPushToWorker({ token: '  ', jobs: [{ jobId: 'j1', referenceNumber: 'WW-1' }] });
    expect(sendExpoPushMessages).not.toHaveBeenCalled();
  });
});
