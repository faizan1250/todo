# Notifications Operations Runbook

Operator procedures for the Phase 6 notification stack: reminder scheduler,
delivery worker, digests, retention, and admin health.

Source of truth: `apps/backend/src/utils/notify-{scheduler,worker,digest,config,policy}.ts`,
`src/routes/{notifications,push,email,digest,notification-prefs,admin}.ts`,
`src/utils/purge.ts`, `src/index.ts` (crons), `docs/runbooks/sync.md` (realtime hint path).

## 0. Kill switch

`NOTIFICATIONS_ENABLED=false` disables everything fail-soft: `runTick()` and
`runDigestTick()` return immediately **without** advancing `last_tick_at`, so
re-enabling falls into a catch-up bucket (or a single daily-digest send inside
the 3h grace window) instead of firing the whole backlog.

```bash
# Disable now (restart or env reload depending on deploy)
NOTIFICATIONS_ENABLED=false

# Re-enable — expect one "While you were away" summary per user with
# pending reminders (gap 15min–12h), or in-app-only rows (gap > 12h).
NOTIFICATIONS_ENABLED=true
```

Per-user pause is softer: `PATCH /api/v1/notification-prefs` with
`pausedUntil` (ISO timestamp) — deliveries past it are deferred via `notBefore`,
inbox rows still land.

## 1. Health check

`GET /api/v1/admin/notifications/health` (alias `GET /admin/notifications/health`),
**admin role only** (else `403`). No query params.

```bash
curl -s -H "Cookie: <admin-session>" \
  localhost:3001/api/v1/admin/notifications/health | jq .
```

```json
{
  "queueDepth": 3,
  "failuresLast24h": { "web_push": 1, "fcm": 0, "email": 2 },
  "oldestPendingAgeMs": 42000,
  "lastTickAt": "2026-03-12T12:00:30.000Z",
  "warnings": []
}
```

| Field | Meaning |
|---|---|
| `queueDepth` | `pending` + `retry` deliveries waiting for the worker |
| `failuresLast24h` | `failed` deliveries by channel, trailing 24h on `updated_at` |
| `oldestPendingAgeMs` | age of the oldest queued delivery, `null` when the queue is empty |
| `lastTickAt` | `scheduler_state.last_tick_at`, `null` if the scheduler never ticked |
| `warnings` | `queue_stale` (oldest queued > 5min), `tick_stale` (no tick for > 2min) |

Triage:

- `tick_stale` + growing `queueDepth` → scheduler cron or boot tick is down;
  check logs for `[notify] tick failed`, confirm the `notify` cron is registered
  (`index.ts`) and `NODE_ENV !== "test"`.
- `queue_stale` with fresh ticks → worker is down or a provider is erroring;
  check `[notify] worker failed` and per-delivery `notify.delivery` JSON lines,
  then `failuresLast24h` for the hot channel.
- One channel spiking in `failuresLast24h` → credential/config issue for that
  provider (VAPID §2, FCM service account, Resend key); inbox rows are unaffected.

## 2. VAPID rotation runbook

Web-push subscriptions are bound to the VAPID keypair. Rotating the keys
invalidates outstanding subscription cryptography server-side; clients must
re-subscribe with the new public key.

```
1. Generate the new pair (once, offline):
   bun -e "import('web-push').then(m => console.log(JSON.stringify(m.generateVAPIDKeys())))"

2. Deploy with the new env (public + private + subject together — never mixed pairs):
   VAPID_PUBLIC_KEY=<new-public>
   VAPID_PRIVATE_KEY=<new-private>
   VAPID_SUBJECT=mailto:ops@example.com

3. Clients re-subscribe on next launch: GET /api/v1/push/public-key returns the
   new key; the app calls PUT /api/v1/devices/:id/push with a fresh subscription.
   Until a device re-subscribes, its pushes fail.

4. Watch the fallout (expect a 410/expired wave, then recovery):
   - GET /api/v1/admin/notifications/health → failuresLast24h.web_push spike is normal.
   - The worker auto-cleans dead targets: 410/404 responses flip the device to
     pushStatus=expired, pushEnabled=false (notify-worker.ts expireDevice).
   - Confirm clients are re-registering: expired count should decay within a day.
     Spot-check: SELECT push_status, count(*) FROM devices GROUP BY push_status;

5. If a device is stuck expired after re-subscribing, the endpoint likely moved:
   PUT re-attaches it and detaches the stale row (endpoint-move handling).
```

Never commit keys to the repo — `.env.example` placeholders only. A committed
keypair is burned: rotate immediately (§2 from the top).

## 3. Quiet-hours check

A user reports "no push at night" or "push during quiet hours":

```
1. Read their prefs: GET /api/v1/notification-prefs (as the user or via DB):
   SELECT quiet_enabled, quiet_start, quiet_end, urgent_breaks_quiet, paused_until,
          hide_content, timezone FROM notification_prefs WHERE user_id='<id>';

2. Interpret (notify-policy.ts planDelivery):
   - pausedUntil in the future → everything deferred (notBefore), inbox still lands.
   - quiet window (default 22:00–07:00 in the USER's timezone) → non-urgent
     pushes deferred to quiet end; urgent (priority >= 4) breaks through ONLY if
     urgentBreaksQuiet is true.
   - type-level opt-out (types JSON, e.g. task_reminder.webPush=false) → channel
     silently dropped for that type; check per-type flags before assuming a bug.

3. Confirm in data: find the notification row, check notification_deliveries —
   deferred rows sit in pending with notBefore set; suppressed-by-policy rows
   never get a delivery (in-app only).
```

Timezone bugs masquerade as quiet-hours bugs: verify `user.timezone` first.

## 4. Digest troubleshooting

Daily (`digest_daily`, `/today`) and weekly (`digest_weekly`, `/planner`) sends
are claimed per `(userId, kind, localDate)` in `digest_log` — the claim happens
**before** building, so an empty day still leaves a row and re-ticks report
`duplicates`.

```
Symptom: user got no digest
1. Prefs: digestDailyEnabled/digestTime (HH:MM, user tz), weeklyEnabled/weeklyDay
   (0=Sun..6=Sat)/weeklyTime. Defaults: daily off, weekly on Sunday 17:00.
2. Slot claimed? SELECT * FROM digest_log WHERE user_id='<id>' AND kind='daily'
   ORDER BY local_date DESC LIMIT 5;
   - Row for today + no notification → day was EMPTY (skippedEmpty, normal).
   - No row + inside the 3h grace window after digestTime → tick may be down
     (see §1 tick_stale) or the user row wasn't picked up (prefs join).
   - Outside the 3h grace window → by design, no send (isDue grace check).
3. Preview without sending: GET /api/v1/digest/preview?kind=daily (as the user).
   empty=true explains the missing send; the rendered digest shows otherwise.
4. Timezone/DST: digestLocal uses the user's tz; on spring-forward days 08:00
   still means 08:00 wall-clock. Verify user.timezone, not server tz.

Symptom: duplicate digest
- digest_log PK is the idempotency guard; duplicates imply the claim was
  bypassed. send-test (§5) never claims the slot — confirm the "duplicate" isn't
  a manual send-test plus the scheduled send.
```

## 5. Smoke test procedure (manual, no script)

Expenditure of a real push without waking other users — everything is
caller-scoped:

```
1. Create/verify a device row for your user (any authenticated device id works):
   GET /api/v1/devices  (or reuse an existing id)

2. Attach a push target (real subscription from the browser, or an FCM token):
   PUT /api/v1/devices/:id/push  { "subscription": { "endpoint": "...", "keys": {...} } }

3. Fire the end-to-end path (enqueue → worker → provider → status):
   POST /api/v1/devices/:id/push/test
   → { "sent": true, "channel": "web_push", "status": "sent", "errorCode": null }
   sent=false with a status (retry/failed + errorCode) still proves the path works;
   it names the failure (e.g. provider_disabled = no creds configured, expected in dev).

4. Digest path (no slot consumed, caller only):
   GET  /api/v1/digest/preview?kind=daily   — renders, sends nothing
   POST /api/v1/digest/send-test { "kind": "daily" } — sends to caller only
```

A `bun run notify:smoke` script was considered and deliberately skipped: the
existing `push/test` + `digest/send-test` endpoints already are the smoke path,
and a script would need a live session + device credential anyway.

## 6. Retention (purge cron)

Daily cron `0 4 * * *` (`notify-retention`, `protect: true`, skipped when
`NODE_ENV=test`) runs `purgeNotificationRetention()` (`purge.ts`), batched
500/tx:

| Data | Retention | Effect |
|---|---|---|
| `notifications` (by `created_at`) | 90 days | FK cascade removes their deliveries too |
| `notification_deliveries` (by `created_at`) | 30 days | orphan rows (already-sent outcomes) |
| `digest_log` (by `sent_at`) | 1 year | idempotency window only; safe to lose |

Manual run / dry-check:

```bash
sqlite3 sqlite.db "SELECT count(*) FROM notifications WHERE created_at < unixepoch('now','-90 days')*1000;"
sqlite3 sqlite.db "SELECT count(*) FROM notification_deliveries WHERE created_at < unixepoch('now','-30 days')*1000;"
sqlite3 sqlite.db "SELECT count(*) FROM digest_log WHERE sent_at < unixepoch('now','-365 days')*1000;"
```

Counts print as `[Purge] Notification retention: ...`. Re-running is a no-op
(idempotent). Soft-delete purge (`0 3 * * *`, `purgeOldSoftDeleted`) is separate —
see `docs/runbooks/sync.md` §4.

## 7. Delivery log lines

Every worker send emits one structured JSON line on stdout (never titles,
bodies, or emails — ids + outcome only):

```json
{"event":"notify.delivery","deliveryId":"…","notificationId":"…","userId":"…","channel":"web_push","status":"sent","attempts":1,"ts":"…"}
```

`status` ∈ `sent | retried | failed | suppressed | cancelled`. Grep by
`notificationId` to trace one reminder end-to-end; aggregate by `status` +
`channel` for the failure mix behind `failuresLast24h`.
