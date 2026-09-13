import { randomUUID } from "node:crypto";
import type { Kysely } from "kysely";
import type { DB } from "../../infrastructure/schema.js";
import { nowIso } from "../../infrastructure/time.js";

type ProposalRow = {
  proposal_id: string;
  creation_id: string | null;
  base_creation_version: number | null;
  operation: string;
  session_id: string;
  title: string | null;
  kind_id: string | null;
  summary: string | null;
  content: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  kind_name: string | null;
  kind_title: string | null;
};

export type ProposalDecision =
  | { kind: "confirmed"; proposalId: string; creationId: string }
  | { kind: "not_found" | "invalid_state" }
  | { kind: "conflict"; creationId: string; expectedVersion: number; actualVersion: number };

export class CreationProposalRepository {
  constructor(private readonly db: Kysely<DB>) {}

  private query(userId: string) {
    return this.db.selectFrom("creation_proposals")
      .leftJoin("creation_kinds", "creation_kinds.kind_id", "creation_proposals.kind_id")
      .select([
        "creation_proposals.proposal_id",
        "creation_proposals.creation_id",
        "creation_proposals.base_creation_version",
        "creation_proposals.operation",
        "creation_proposals.session_id",
        "creation_proposals.title",
        "creation_proposals.kind_id",
        "creation_proposals.summary",
        "creation_proposals.content",
        "creation_proposals.status",
        "creation_proposals.created_at",
        "creation_proposals.updated_at",
        "creation_kinds.name as kind_name",
        "creation_kinds.title as kind_title",
      ])
      .where("creation_proposals.user_id", "=", userId);
  }

  listPending(userId: string) {
    return this.query(userId)
      .where("creation_proposals.status", "=", "pending_confirmation")
      .orderBy("creation_proposals.updated_at", "desc")
      .orderBy("creation_proposals.proposal_id", "desc")
      .execute() as Promise<ProposalRow[]>;
  }

  find(userId: string, proposalId: string) {
    return this.query(userId)
      .where("creation_proposals.proposal_id", "=", proposalId)
      .executeTakeFirst() as Promise<ProposalRow | undefined>;
  }

  async sourceRecords(userId: string, proposalId: string) {
    const links = await this.db.selectFrom("entity_relations")
      .select(["source_entity_id", "source_created_at"])
      .where("user_id", "=", userId)
      .where("target_entity_id", "=", proposalId)
      .where("target_entity_type", "=", "creation_proposal")
      .where("relation_type", "=", "record_creation_proposal")
      .orderBy("source_created_at", "desc")
      .orderBy("source_entity_id", "desc")
      .execute();
    if (!links.length) return [];
    const rows = await this.db.selectFrom("records")
      .select(["record_id", "content", "created_at"])
      .where("user_id", "=", userId)
      .where("record_id", "in", links.map(link => link.source_entity_id))
      .execute();
    const byId = new Map(rows.map(row => [row.record_id, row]));
    return links.flatMap(link => {
      const row = byId.get(link.source_entity_id);
      return row ? [row] : [];
    });
  }

  async sourceCount(userId: string, proposalId: string) {
    const row = await this.db.selectFrom("entity_relations")
      .select(eb => eb.fn.countAll<number>().as("count"))
      .where("user_id", "=", userId)
      .where("target_entity_id", "=", proposalId)
      .where("target_entity_type", "=", "creation_proposal")
      .where("relation_type", "=", "record_creation_proposal")
      .executeTakeFirstOrThrow();
    return Number(row.count);
  }

  async confirm(userId: string, proposalId: string): Promise<ProposalDecision> {
    return this.db.transaction().execute(async trx => {
      const proposal = await trx.selectFrom("creation_proposals").selectAll()
        .where("user_id", "=", userId).where("proposal_id", "=", proposalId).executeTakeFirst();
      if (!proposal) return { kind: "not_found" };
      if (proposal.status !== "pending_confirmation") return { kind: "invalid_state" };
      if (!proposal.title || !proposal.kind_id || !proposal.summary || !proposal.content) return { kind: "invalid_state" };

      const timestamp = nowIso();
      let creationId: string;
      if (proposal.operation === "update" && proposal.creation_id) {
        const creation = await trx.selectFrom("creations").selectAll()
          .where("user_id", "=", userId).where("creation_id", "=", proposal.creation_id).executeTakeFirst();
        if (!creation || creation.status === "archived") return { kind: "invalid_state" };
        if (proposal.base_creation_version !== null && creation.version !== proposal.base_creation_version) {
          return { kind: "conflict", creationId: creation.creation_id, expectedVersion: proposal.base_creation_version, actualVersion: creation.version };
        }
        creationId = creation.creation_id;
        await trx.updateTable("creations").set({
          title: proposal.title,
          kind_id: proposal.kind_id,
          summary: proposal.summary,
          content: proposal.content,
          version: creation.version + 1,
          updated_at: timestamp,
        }).where("user_id", "=", userId).where("creation_id", "=", creationId).execute();
      } else {
        creationId = randomUUID();
        await trx.insertInto("creations").values({
          creation_id: creationId,
          user_id: userId,
          title: proposal.title,
          kind_id: proposal.kind_id,
          session_id: proposal.session_id,
          summary: proposal.summary,
          content: proposal.content,
          status: "active",
          version: 1,
          created_at: timestamp,
          updated_at: timestamp,
        }).execute();
      }

      await trx.updateTable("entity_relations").set({
        target_entity_id: creationId,
        target_entity_type: "creation",
        relation_type: "record_creation",
      }).where("user_id", "=", userId).where("target_entity_id", "=", proposalId)
        .where("target_entity_type", "=", "creation_proposal").where("relation_type", "=", "record_creation_proposal").execute();
      await trx.updateTable("creation_proposals").set({ status: "confirmed", updated_at: timestamp })
        .where("user_id", "=", userId).where("proposal_id", "=", proposalId).execute();
      return { kind: "confirmed", proposalId, creationId };
    });
  }

  async reject(userId: string, proposalId: string) {
    const result = await this.db.updateTable("creation_proposals").set({ status: "rejected", updated_at: nowIso() })
      .where("user_id", "=", userId).where("proposal_id", "=", proposalId)
      .where("status", "=", "pending_confirmation").executeTakeFirst();
    return Number(result.numUpdatedRows) === 1;
  }
}
