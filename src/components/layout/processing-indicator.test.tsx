import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import {
  mockNextIntl,
  mockNextNavigation,
  resetRouterMocks,
  routerMock,
} from "../../../test/utils/web/mocks";
import { useProcessingQueueStore } from "@/stores/processing-queue-store";

describe("ProcessingIndicator", () => {
  beforeEach(() => {
    resetRouterMocks();
    mockNextIntl();
    mockNextNavigation();
    useProcessingQueueStore.setState({ jobs: {}, notifications: [] });
  });

  it("does not render when there are no jobs", async () => {
    const { ProcessingIndicator } = await import("./processing-indicator");
    const view = render(<ProcessingIndicator />);
    expect(view.container).toBeEmptyDOMElement();
  });

  it("renders active and completed jobs and handles job actions", async () => {
    useProcessingQueueStore.setState({
      jobs: {
        "job-active": {
          id: "job-active",
          recordId: "record-active",
          personId: "person-1",
          personName: "Alex",
          stage: "processing",
          progress: 32,
          title: "Scan",
          createdAt: Date.now(),
        },
        "job-done": {
          id: "job-done",
          recordId: "record-42",
          personId: "person-1",
          personName: "Alex",
          stage: "completed",
          progress: 100,
          title: "Report",
          createdAt: Date.now(),
          completedAt: Date.now(),
        },
      },
      notifications: [],
    });

    const { ProcessingIndicator } = await import("./processing-indicator");
    render(<ProcessingIndicator />);

    expect(screen.getByText("processing.title")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("processing.viewRecord")).toBeInTheDocument();

    await userEvent.setup().click(screen.getByText("processing.viewRecord"));
    expect(routerMock.push).toHaveBeenCalledWith("/health/records/record-42");
    expect(useProcessingQueueStore.getState().jobs["job-done"]).toBeUndefined();
  });

  it("dismisses individual jobs", async () => {
    useProcessingQueueStore.setState({
      jobs: {
        "job-1": {
          id: "job-1",
          recordId: "record-1",
          personId: "person-1",
          personName: "Alex",
          stage: "failed",
          progress: 100,
          title: "Failed job",
          createdAt: Date.now(),
          error: "boom",
        },
      },
      notifications: [],
    });

    const { ProcessingIndicator } = await import("./processing-indicator");
    render(<ProcessingIndicator />);

    const dismissButtons = screen.getAllByRole("button");
    await userEvent.setup().click(dismissButtons[dismissButtons.length - 1]);
    expect(useProcessingQueueStore.getState().jobs["job-1"]).toBeUndefined();
  });
});
