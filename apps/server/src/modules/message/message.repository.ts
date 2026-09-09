import type { Message } from "./message.js";

export interface MessageRepository {
  save(input: Omit<Message, "id">): Promise<number>;
  findBySessionId(sessionId: string, userId: string): Promise<Message[]>;
}
