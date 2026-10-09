import { requestJson } from "./http";
import type { RecordItem } from "./records";

export type ProjectStatus = "queued" | "running" | "completed" | "failed" | "archived";
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
  sessionId: string | null;
  goal: { objective: string; context?: string; constraints?: string[]; successCriteria?: string[] };
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
  content: {
    ideas: { id: string; title: string; idea: string; tags: string[] }[];
    selectedIdeaId: string | null;
  };
  status: ProposalStatus;
  resultProjectId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  referenceRecordCount?: number;
};

const queryPage = (limit: number, cursor?: string | null) => {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  return query;
};

export function listProjects(status?: ProjectStatus, cursor?: string | null) {
  const query = queryPage(20, cursor);
  if (status) query.set("status", status);
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

export function acceptProposal(id: string, selectedIdeaId: string) {
  return requestJson<{ projectId: string }>(
    `/api/proposals/${encodeURIComponent(id)}/accept`,
    { method: "POST", body: JSON.stringify({ selectedIdeaId }) },
  );
}

export function rejectProposal(id: string) {
  return requestJson<{ proposal: Proposal }>(`/api/proposals/${encodeURIComponent(id)}/reject`, { method: "POST" });
}
