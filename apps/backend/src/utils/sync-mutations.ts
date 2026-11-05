export type MutationStatus = 'applied' | 'duplicate' | 'rejected' | 'ignored';

export interface MutationResult {
  id: string;
  status: MutationStatus;
  version?: number;
  seq?: number;
  reason?: string;
}

export interface Mutation {
  id: string;
  entity: string;
  op: string;
  entityId: string;
  patch?: any;
  editedAt: number;
  schemaVersion?: number;
}

export function processMutations(
  userId: string,
  deviceId: string | null,
  mutations: Mutation[]
): MutationResult[] {
  return [];
}