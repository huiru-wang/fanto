import type { Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
export type ProjectStatus = "active" | "archived";
export type ProposalType = "create" | "extend";
export type ProposalStatus = "pending" | "accepted" | "rejected";
export interface ProposalCreation {
  objective: string;
  context?: string;
  constraints?: string[];
  successCriteria?: string[];
}
export interface ProposalContent { reason: string; idea: string; plan: string[]; tags: string[]; creation?: ProposalCreation }
export interface Proposal {
  proposalId: string; userId: string; sessionId: string | null; type: ProposalType; targetProjectId: string | null;
  title: string; proposedSummary: string | null; content: ProposalContent; status: ProposalStatus;
  resultProjectId: string | null; createdAt: Date; updatedAt: Date; resolvedAt: Date | null;
}
export interface Project {
  projectId: string; userId: string; sessionId: string | null; title: string; summary: string;
  coverMediaId: string | null; content: string; status: ProjectStatus; version: number; createdAt: Date; updatedAt: Date;
}
export type ProjectSummary = Pick<Project, "projectId" | "title" | "summary" | "version">;
export type DomainErrorCode = "EMBEDDING_UNAVAILABLE" | "INVALID_INPUT" | "INVALID_CURSOR" | "NOT_FOUND" | "INVALID_STATE" | "VERSION_CONFLICT" | "REFERENCE_RECORDS_UNAVAILABLE" | "MEDIA_NOT_READY" | "CONTENT_TOO_LARGE";
export type DomainResult<T> = { kind: "ok"; data: T } | { kind: "error"; code: DomainErrorCode };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null; pageSize: number };
export type Pagination = { cursor?: string; limit: number };
export type TransactionOptions = { transaction?: Transaction<DB> };
export type ProjectPatch = Partial<Pick<Project, "title" | "summary" | "coverMediaId" | "content">>;
export type CreateProposalInput = {
  type: ProposalType; targetProjectId?: string | null; title: string; proposedSummary?: string | null;
  recordIds: string[]; content: ProposalContent;
};
export type AcceptProposalInput = { userInput?: string };
export const success = <T>(data: T): DomainResult<T> => ({ kind: "ok", data });
export const failure = (code: DomainErrorCode): DomainResult<never> => ({ kind: "error", code });
