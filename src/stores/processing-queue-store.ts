import { create } from "zustand";
import type { ExtractionResult } from "@/types";

export type ProcessingStage = "uploading" | "processing" | "completed" | "failed";

export interface ProcessingJob {
  id: string; // Job ID (usually record ID)
  recordId: string;
  personId: string;
  personName: string;
  stage: ProcessingStage;
  progress: number; // 0-100
  title?: string; // Extracted title (available after processing)
  extraction?: ExtractionResult;
  error?: string;
  createdAt: number;
  completedAt?: number;
}

export interface ProcessingNotification {
  id: string;
  jobId: string;
  recordId: string;
  title: string;
  personName: string;
  type: "success" | "error";
  message: string;
  timestamp: number;
  read: boolean;
}

interface ProcessingQueueState {
  // Active processing jobs
  jobs: Record<string, ProcessingJob>;
  
  // Notifications for completed jobs
  notifications: ProcessingNotification[];
  
  // Actions
  addJob: (job: Omit<ProcessingJob, "createdAt">) => void;
  updateJob: (id: string, updates: Partial<ProcessingJob>) => void;
  removeJob: (id: string) => void;
  
  // Notification actions
  addNotification: (notification: Omit<ProcessingNotification, "id" | "timestamp" | "read">) => void;
  markNotificationRead: (id: string) => void;
  clearNotifications: () => void;
  
  // Selectors
  getActiveJobs: () => ProcessingJob[];
  getJobByRecordId: (recordId: string) => ProcessingJob | undefined;
  getUnreadNotificationCount: () => number;
}

export const useProcessingQueueStore = create<ProcessingQueueState>((set, get) => ({
  jobs: {},
  notifications: [],
  
  addJob: (job) => {
    const newJob: ProcessingJob = {
      ...job,
      createdAt: Date.now(),
    };
    set((state) => ({
      jobs: {
        ...state.jobs,
        [job.id]: newJob,
      },
    }));
  },
  
  updateJob: (id, updates) => {
    set((state) => {
      const existingJob = state.jobs[id];
      if (!existingJob) return state;
      
      return {
        jobs: {
          ...state.jobs,
          [id]: {
            ...existingJob,
            ...updates,
          },
        },
      };
    });
  },
  
  removeJob: (id) => {
    set((state) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [id]: _, ...rest } = state.jobs;
      return { jobs: rest };
    });
  },
  
  addNotification: (notification) => {
    const newNotification: ProcessingNotification = {
      ...notification,
      id: `${notification.jobId}-${Date.now()}`,
      timestamp: Date.now(),
      read: false,
    };
    set((state) => ({
      notifications: [newNotification, ...state.notifications].slice(0, 50), // Keep last 50
    }));
  },
  
  markNotificationRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n
      ),
    }));
  },
  
  clearNotifications: () => {
    set({ notifications: [] });
  },
  
  getActiveJobs: () => {
    return Object.values(get().jobs).filter(
      (job) => job.stage === "uploading" || job.stage === "processing"
    );
  },
  
  getJobByRecordId: (recordId) => {
    return Object.values(get().jobs).find((job) => job.recordId === recordId);
  },
  
  getUnreadNotificationCount: () => {
    return get().notifications.filter((n) => !n.read).length;
  },
}));
