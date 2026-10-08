import { requestJson } from "./http";
import type { RecordItem } from "./records";

export type ProjectStatus = "active" | "archived";
export type ProposalStatus = "pending" | "accepted" | "rejected";
export type ProposalType = "create" | "extend";

export type Page<T> = {
  data: T[];
  hasMore: boolean;
  nextCursor: string | null;
  pageSize: number;
};

export type Project = {
  projectId: string;
  title: string;
  summary: string;
  coverMediaId: string | null;
  content?: string;
  status: ProjectStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ProjectDetail = Project & {
  content: string;
  recordCount: number;
  referenceRecords: RecordItem[];
};

export type Proposal = {
  proposalId: string;
  type: ProposalType;
  targetProjectId: string | null;
  title: string;
  proposedSummary: string | null;
  content: {
    reason: string;
    idea: string;
    plan: string[];
    tags?: string[];
    creation?: {
      objective: string;
      context?: string;
      constraints?: string[];
      successCriteria?: string[];
    };
  };
  status: ProposalStatus;
  resultProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  referenceRecordCount?: number;
};

export type Creation = {
  creationRunId: string;
  proposalId: string;
  projectId: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: { stage: string; completedImages?: number; imageCount?: number };
  errorCode: string | null;
  publishedProjectVersion: number | null;
  updatedAt: string;
};

const queryPage = (limit: number, cursor?: string | null) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return query;
};

export function listProjects(status: ProjectStatus = "active", cursor?: string | null) {
  const query = queryPage(20, cursor);
  query.set("status", status);
  return requestJson<Page<Project>>(`/api/projects?${query}`);
}

export function getProject(id: string) {
  return requestJson<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`);
}

export function archiveProject(id: string, expectedVersion: number) {
  return requestJson<Project>(`/api/projects/${encodeURIComponent(id)}/archive`, {
    method: "POST", body: JSON.stringify({ expectedVersion }),
  });
}

export function listProposals(cursor?: string | null) {
  const query = queryPage(20, cursor);
  query.set("status", "pending");
  return requestJson<Page<Proposal>>(`/api/proposals?${query}`);
}

export function getProposal(id: string) {
  return requestJson<Proposal>(`/api/proposals/${encodeURIComponent(id)}`);
}

export function listProposalRecords(id: string, cursor?: string | null) {
  return requestJson<Page<RecordItem>>(`/api/proposals/${encodeURIComponent(id)}/records?${queryPage(5, cursor)}`);
}

export function acceptProposal(id: string, userInput?: string) {
  return requestJson<{ proposal: Proposal; resultProjectId: string; addedRecordCount: number }>(
    `/api/proposals/${encodeURIComponent(id)}/accept`,
    { method: "POST", body: JSON.stringify(userInput ? { userInput } : {}) },
  );
}

export function rejectProposal(id: string) {
  return requestJson<{ proposal: Proposal }>(`/api/proposals/${encodeURIComponent(id)}/reject`, { method: "POST" });
}

export function getProjectCreation(id: string) {
  return requestJson<{ creation: Creation | null }>(`/api/projects/${encodeURIComponent(id)}/creation`);
}
