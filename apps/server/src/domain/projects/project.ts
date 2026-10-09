import type { Transaction } from "kysely";
import type { DB } from "../../infrastructure/database/schema.js";
export type ProjectStatus = "queued" | "running" | "completed" | "failed" | "archived";
export type ProposalType = "create" | "extend";
export type ProposalStatus = "pending" | "accepted" | "rejected";
export interface ProjectGoal {
  objective: string;
  context?: string;
  constraints?: string[];
  successCriteria?: string[];
}
export interface ProposalIdea { id: string; title: string; idea: string; tags: string[]; goal: ProjectGoal }
export type ProjectChangeKind = "enrich" | "correct" | "refine" | "continue";
export interface ProjectChange { kind: ProjectChangeKind; title: string; idea: string; tags: string[]; instruction: string }
/** The public ideas view is retained for older H5/iOS clients. Extend is an explicit change, not a replacement goal. */
export interface ProposalContent { reason: string; opening?: string; ideas: ProposalIdea[]; selectedIdeaId: string | null; change?: ProjectChange }
export interface ProposalCreateContent { reason: string; opening?: string; ideas: Array<Omit<ProposalIdea, "id">> }
export interface ProposalExtendContent { reason: string; opening?: string; change: ProjectChange }
export interface Proposal {
  proposalId: string; userId: string; sessionId: string | null; type: ProposalType; targetProjectId: string | null;
  title: string; proposedSummary: string | null; content: ProposalContent; status: ProposalStatus;
  resultProjectId: string | null; createdAt: Date; updatedAt: Date; resolvedAt: Date | null;
}
export interface Project {
  projectId: string; userId: string; sessionId: string | null; title: string; summary: string; goal: ProjectGoal;
  coverMediaId: string | null; content: string; status: ProjectStatus; version: number; createdAt: Date; updatedAt: Date;
}
export type ProjectSummary = Pick<Project, "projectId" | "title" | "summary" | "version">;
export type DomainErrorCode = "EMBEDDING_UNAVAILABLE" | "INVALID_INPUT" | "INVALID_CURSOR" | "NOT_FOUND" | "INVALID_STATE" | "VERSION_CONFLICT" | "REFERENCE_RECORDS_UNAVAILABLE" | "MEDIA_NOT_READY" | "CONTENT_TOO_LARGE";
export type DomainResult<T> = { kind: "ok"; data: T } | { kind: "error"; code: DomainErrorCode };
export type Page<T> = { data: T[]; hasMore: boolean; nextCursor: string | null; pageSize: number };
export type Pagination = { cursor?: string; limit: number };
export type TransactionOptions = { transaction?: Transaction<DB> };
export type ProjectPatch = Partial<Pick<Project, "title" | "summary" | "coverMediaId" | "content" | "goal">>;
export type CreateProposalInput =
  | { type: "create"; title: string; targetProjectId?: null; proposedSummary: string; recordIds: string[]; content: ProposalCreateContent }
  | { type: "extend"; title: string; targetProjectId: string; proposedSummary?: null; recordIds: string[]; content: ProposalExtendContent };
export type AcceptProposalInput = { selectedIdeaId?: string };
export const success = <T>(data: T): DomainResult<T> => ({ kind: "ok", data });
export const failure = (code: DomainErrorCode): DomainResult<never> => ({ kind: "error", code });
