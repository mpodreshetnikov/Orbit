import { beforeEach, describe, expect, it } from "vitest";
import { useProcessingQueueStore } from "./processing-queue-store";

describe("processing-queue-store", () => {
  beforeEach(() => {
    useProcessingQueueStore.setState({ jobs: {}, notifications: [] });
  });

  it("tracks active jobs and resolves by record id", () => {
    const state = useProcessingQueueStore.getState();
    state.addJob({
      id: "job-1",
      recordId: "record-1",
      personId: "person-1",
      personName: "Jane",
      stage: "uploading",
      progress: 10,
    });

    expect(useProcessingQueueStore.getState().getActiveJobs()).toHaveLength(1);
    expect(useProcessingQueueStore.getState().getJobByRecordId("record-1")?.id).toBe("job-1");

    useProcessingQueueStore.getState().updateJob("job-1", { stage: "completed", progress: 100 });
    expect(useProcessingQueueStore.getState().getActiveJobs()).toHaveLength(0);
  });

  it("tracks unread notifications", () => {
    const state = useProcessingQueueStore.getState();
    state.addNotification({
      jobId: "job-1",
      recordId: "record-1",
      title: "Record processed",
      personName: "Jane",
      type: "success",
      message: "Done",
    });

    const notifications = useProcessingQueueStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(useProcessingQueueStore.getState().getUnreadNotificationCount()).toBe(1);

    useProcessingQueueStore.getState().markNotificationRead(notifications[0].id);
    expect(useProcessingQueueStore.getState().getUnreadNotificationCount()).toBe(0);
  });
});

