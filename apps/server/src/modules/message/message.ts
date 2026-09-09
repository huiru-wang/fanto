export interface Message {
  id: number;
  userId: string;
  sessionId: string;
  role: string;
  payload: string;
  createdAt: string;
  updatedAt: string;
}
