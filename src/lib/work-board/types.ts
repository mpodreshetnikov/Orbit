export type BoardColumnId =
  | "open"
  | "queue"
  | "in-progress"
  | "for-review"
  | "blocked"
  | "done"
  | "canceled";

export type AgentizedCanonicalStatus =
  | "idea"
  | "open"
  | "queue"
  | "in-progress"
  | "self-review"
  | "for-review"
  | "blocked"
  | "done"
  | "canceled";

export type OrbitTaskStatus =
  | "idea"
  | "open"
  | "in-progress"
  | "review"
  | "blocked"
  | "done"
  | "dropped";

export type BoardCard = {
  id: string;
  title: string;
  status: AgentizedCanonicalStatus;
  status_label: string;
  description: string;
  claim: string;
  parent: string;
  blocked_reason: string;
  blocked_deadline: string;
  column: BoardColumnId;
  updated: string;
  /** Always empty in v1 — Lead: no overdue paint. */
  overdue: "";
};

export type TaskTextSource = {
  path: string;
  text: string;
};
