export type TaskStatus = "todo" | "in-progress" | "done";

export type Task = {
  id: string;
  commessa: string;
  description: string;
  client: string;
  hours: number;
  assigneeId?: string;
  startDate?: string;
  endDate?: string;
  status: TaskStatus;
};

export type Member = {
  id: string;
  name: string;
  role?: string;
  annualTarget?: number; // Obiettivo annuo in €
};
