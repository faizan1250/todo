export interface CursorPayload {
  position: string;
  id: string;
}

export interface PaginatedResult<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Encodes a keyset cursor into a URL-safe base64 string.
 */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/**
 * Decodes a URL-safe base64 keyset cursor string.
 * Returns null if the cursor is invalid or malformed.
 */
export function decodeCursor(cursorStr?: string | null): CursorPayload | null {
  if (!cursorStr) return null;
  try {
    const raw = Buffer.from(cursorStr, "base64url").toString("utf-8");
    const parsed = JSON.parse(raw);
    if (typeof parsed?.position === "string" && typeof parsed?.id === "string") {
      return { position: parsed.position, id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Helper to paginate an array of items fetched with limit + 1.
 */
export function paginateResults<T extends CursorPayload>(
  items: T[],
  limit: number
): PaginatedResult<T> {
  const hasMore = items.length > limit;
  const slicedItems = hasMore ? items.slice(0, limit) : items;
  const lastItem = slicedItems.length > 0 ? slicedItems[slicedItems.length - 1] : null;

  return {
    items: slicedItems,
    hasMore,
    nextCursor: hasMore && lastItem ? encodeCursor({ position: lastItem.position, id: lastItem.id }) : null,
  };
}
