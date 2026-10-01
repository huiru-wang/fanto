export type ProjectStatus = "proposed" | "active" | "archived" | "rejected";

export interface Project {
  projectId: string;
  title: string;
  content: string;
  status: ProjectStatus;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
