// Neighbor computation for drag-reorder moves.
//
// The caller builds `resultIds`: the target container's final order WITH the
// dragged id already placed (arrayMove for same-container drops, splice-insert
// for cross-container drops). This helper derives the afterId/beforeId pair
// for the mutate/REST move — the server recomputes the position
// authoritatively from those neighbors and repairs collisions. Order shown is
// always (position, id).
//
// A null neighbor means "edge of the container" (start for afterId, end for
// beforeId). Both null happens only when the dragged task is the container's
// sole member — callers should skip the move in that case (no-op).

export interface MoveNeighbors {
  afterId: string | null;
  beforeId: string | null;
  /** 0-based position of the dragged item in the resulting order. */
  toIndex: number;
}

export function moveNeighbors(resultIds: string[], activeId: string): MoveNeighbors {
  const toIndex = resultIds.indexOf(activeId);
  if (toIndex < 0) {
    throw new Error(`moveNeighbors: active id ${activeId} not in result order`);
  }
  return {
    afterId: toIndex > 0 ? resultIds[toIndex - 1] : null,
    beforeId: toIndex < resultIds.length - 1 ? resultIds[toIndex + 1] : null,
    toIndex,
  };
}

/** True when the drop leaves the item exactly where it started. */
export function isNoopMove(beforeIds: string[], afterIds: string[]): boolean {
  if (beforeIds.length !== afterIds.length) return false;
  return beforeIds.every((id, i) => afterIds[i] === id);
}
