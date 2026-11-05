# Sync Operations Runbook

Operator procedures for sync recovery, retention, admin inspection, and realtime.

Source of truth: `apps/backend/src/routes/sync.ts`, `src/utils/purge.ts`,
`src/utils/sync-publisher.ts`, `src/routes/admin.ts`, `src/routes/ws.ts`,
`src/index.ts`, `src/db/schema.ts` (`sync_state`).

Cursor format: `<epoch>:<seq>`. Pull `GET /api/v1/sync?cursor=&limit=500`.
Push `POST /api/v1/sync/push` (max 100 mutations/request).
Server returns `409 { resync: true }` when: epoch mismatch, `seq < min_valid_seq`,
`seq > seq`, or malformed cursor (`sync.ts:50-56`).

## 1. Backup restore with Litestream (seq moved backwards)

Restoring from a Litestream/S3 snapshot can move `sync_state.seq` **backwards**.
Any client holding a cursor with `seq > restored seq` would otherwise miss writes.
Fix: rotate the epoch so **every** client takes `409 → full resync`.

```bash
# 1. Stop writers, restore
litestream restore -o ./sqlite.db s3://<bucket>/todo
sqlite3 sqlite.db "SELECT seq, min_valid_seq, epoch FROM sync_state;"

# 2. Generate a new epoch (forces global 409: epoch !== sync_state.epoch)
NEW_EPOCH=$(bun -e "console.log(require('crypto').randomUUID())")
sqlite3 sqlite.db "UPDATE sync_state SET epoch='$NEW_EPOCH';"
sqlite3 sqlite.db "SELECT seq, min_valid_seq, epoch FROM sync_state;"

# 3. Restart backend, verify
curl -s localhost:3001/health
# Authenticated pull with a STALE cursor must 409:
curl -s -H "Cookie: <session>" \
  "localhost:3001/api/v1/sync?cursor=<OLD_EPOCH>:<OLD_SEQ>" -w "\n%{http_code}\n"
# expect: {"resync":true} + HTTP 409
```

Verification (converge):

1. Confirm stale cursors 409 (above).
2. Each client discards local cursor, pulls with `cursor=""`, pages while
   `hasMore` is true, stores the returned cursor.
3. Spot-check two devices for the same user return identical row counts;
   check `GET /api/v1/admin/sync?userId=<id>` shows fresh `lastSyncAt`.
4. Watch logs for no repeat 409 loop (client using fresh epoch cursor).

Alternative (narrower blast radius): instead of rotating epoch, set
`min_valid_seq = seq` — only clients with `seq < current seq` resync.
Use after small restores; use epoch rotation after full snapshot restores.

```sql
-- Narrow: force resync only for stale cursors
UPDATE sync_state SET min_valid_seq = seq;
```

## 2. Long-offline clients (> 30 days)

Tombstones older than 30 days are hard-deleted and `min_valid_seq` advances
(`purge.ts:114-121`), so a >30-day-old cursor is **guaranteed** to 409.
Procedure is safe and automatic — but push first so local edits aren't lost:

```
1. Client: POST /api/v1/sync/push with outbox FIRST (in order, see §3).
2. Client: on 409 (or pre-emptively if cursor age > 30d):
   wipe local DB → GET /api/v1/sync?cursor= → follow hasMore pages.
3. No server action needed: seq < min_valid_seq forces 409 automatically.
```

Operator check for a suspect device:

```bash
curl -s -H "Cookie: <admin-session>" \
  "localhost:3001/api/v1/admin/sync?userId=<user-id>"
# compare device.lastSyncSeq vs sync_state.seq / min_valid_seq:
sqlite3 sqlite.db "SELECT seq, min_valid_seq, epoch FROM sync_state;"
# device.lastSyncSeq < min_valid_seq  →  next pull 409s, expected.
```

Do NOT lower `min_valid_seq` to "help" an old client — it would silently miss
hard-deleted rows.

## 3. Big offline queues (push in batches of 100)

`POST /api/v1/sync/push` rejects >100 mutations (`maxItems: 100`, `sync.ts:182`).
Push in order, throttled to ~60 req/min:

```bash
# Pseudocode — client/outbox replay script
# mutations oldest-first, 100 per POST, ~1s spacing (≈60/min)
TOTAL=$(jq length outbox.json)
for ((i=0; i<TOTAL; i+=100)); do
  jq ".[$i:$((i+100))]" outbox.json > batch.json
  curl -s -X POST localhost:3001/api/v1/sync/push \
    -H "Content-Type: application/json" -H "Cookie: <session>" \
    -H "X-Device-Id: <device-id>" \
    -d "{\"mutations\": $(cat batch.json)}"
  sleep 1
done
```

Notes:

- Preserve outbox order across batches; server applies per-mutation results
  (`{ results }` array) — retry only failed items, don't resend the whole queue.
- `X-Device-Id` header (or `deviceId` body field) attributes the batch and
  updates `devices.lastSyncSeq/lastSyncAt` on the next pull.
- If any pull returns 409 mid-replay: finish pushing, then wipe + re-pull (§2).

## 4. Retention (purge cron)

Daily cron `0 3 * * *` (`index.ts:109-116`, skipped when `NODE_ENV=test`)
runs `purgeOldSoftDeleted()` (`purge.ts`):

| Data | Retention | Effect |
|---|---|---|
| Tombstones (tasks, sections, lists excl. inbox, folders with `deleted_at`) | hard-deleted after 30 days, 500 rows/tx | advances `min_valid_seq = seq`, stale cursors 409 |
| `processed_mutations` (by `created_at`) | 35 days | idempotency window only; safe to lose |
| `sync_conflicts` (by `at`) | 35 days | conflict audit trail only |

```bash
# Manual run / dry-check
sqlite3 sqlite.db "SELECT count(*) FROM processed_mutations WHERE created_at < unixepoch('now','-35 days')*1000;"
sqlite3 sqlite.db "SELECT count(*) FROM sync_conflicts;"
sqlite3 sqlite.db "SELECT seq, min_valid_seq FROM sync_state;"
```

After a large purge, expect a wave of 409s from very stale clients — normal.
If 409 volume is excessive, it means many devices were >30d stale; no action.

## 5. Admin: per-device sync status

`GET /api/v1/admin/sync` (alias `GET /admin/sync`), **admin role only**
(else `403`). Query `?userId=<id>`, defaults to self (`admin.ts:62-95`).

```bash
curl -s -H "Cookie: <admin-session>" \
  "localhost:3001/api/v1/admin/sync?userId=<user-id>" | jq .
```

Per-device fields: `lastSyncSeq`, `lastSyncAt`, `lastSeenAt`,
`pendingMutationCount` (= `pendingMutations`),
`processedMutationCount`, `clientVersion` (= `client_version`).

Triage:

- `lastSyncAt` old + `pendingMutationCount` high → device offline / not pushing.
- `lastSyncSeq` far behind `sync_state.seq` → will take many pages or 409.
- `clientVersion` < `sync_state.min_client_version` → pulls get `426`
  "Please refresh to get the latest update" until the client updates.

## 6. WebSocket realtime (`/ws`)

- Topics: `user:{id}` (`ws.ts:30`, `sync-publisher.ts:36`). Auth required:
  cookie session on `open`, or send `{ "t": "auth", "token": "<session>" }`.
  Unauthenticated sockets are closed after 5s.
- Publishes are **coalesced**: 100ms window per user, latest `seq` wins —
  payload `{ "t": "changed", "seq": <n>, "device": <origin|null> }`.
  Clients must still **pull**; the socket is only a hint.
- Limit: **5 connections per user** — the 6th is closed (`ws.ts:28,58`).
  `idleTimeout` 60s, `maxPayload` 64KB, origin allowlist via `ALLOWED_ORIGINS`.
- Keepalive: client sends `{ "t": "ping" }`, server replies `{ "t": "pong" }`.

Reconnect procedure (client):

```
1. On close/error: backoff reconnect (e.g. 1s, 2s, 5s, 15s, 30s cap + jitter).
2. Re-auth (cookie or {"t":"auth","token"}), resubscribe is server-side.
3. On receiving {"t":"changed","seq"}: GET /api/v1/sync?cursor=<local> and
   page hasMore. On 409: full resync (§2).
4. If no message for > 90s: send ping; if no pong, reconnect.
```

Operator checks:

```bash
# Origin rejections (403 forbidden origin) → check ALLOWED_ORIGINS
echo $ALLOWED_ORIGINS
# Users hitting the 5-conn cap → excess tabs/devices; close extras.
# No per-user conn introspection endpoint; check server logs / ws close codes.
```
