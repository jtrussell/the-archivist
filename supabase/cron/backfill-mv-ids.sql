-- Schedule the Master Vault backfill Edge Function via Supabase Cron.
--
-- Prerequisites (one-time, in the Supabase dashboard or SQL editor):
--   1. Deploy the function:   supabase functions deploy backfill-mv-ids --no-verify-jwt
--   2. Set the shared secret: supabase secrets set CRON_SECRET=<random string>
--   3. Enable extensions (Database -> Extensions): pg_cron, pg_net. Both are
--      available on the free plan.
--
-- Store the function URL and CRON_SECRET in Vault so they aren't inlined here:
--   select vault.create_secret('https://<project-ref>.functions.supabase.co/backfill-mv-ids', 'backfill_mv_url');
--   select vault.create_secret('<same value as CRON_SECRET>', 'backfill_mv_secret');

-- Every 5 minutes: POST the function. It returns 202 immediately and drains the
-- queue in a background loop (up to ~120s) over small CLAIMED chunks, so:
--   * runs never approach the 150s free-tier wall limit,
--   * overlapping/stacked invocations claim disjoint rows (no duplicate work),
--   * the job is idempotent and resumable (only mv_id IS NULL rows are claimed),
--     so a missed or interrupted tick simply retries next run.
-- The http_post returns as soon as the function sends its 202, so the short
-- pg_net timeout below is ample; it is set generously only as a safety margin.
select cron.schedule(
  'backfill-mv-ids',
  '*/5 * * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'backfill_mv_url'),
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'backfill_mv_secret')
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);

-- Management helpers:
--   select * from cron.job;                       -- list schedules
--   select * from cron.job_run_details            -- recent run outcomes
--     order by start_time desc limit 20;
--   select cron.unschedule('backfill-mv-ids');    -- remove the schedule
--
-- Caveats:
--   * Free projects pause after ~1 week idle; the cron does not fire while
--     paused (the target "scan tonight / CSV tomorrow" flow is unaffected since
--     the project was just active).
--   * Skipped/failed ticks are not retried and are visible only in
--     cron.job_run_details — the job self-heals on the next successful run.
