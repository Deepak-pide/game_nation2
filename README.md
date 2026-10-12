# Game Nation

Game Nation is a Vite multi-page site using Supabase Auth, PostgreSQL, RLS, and Realtime. The existing game showcase pages and visual design remain in place; `account.html`, `dashboard.html`, and `status.html` provide the member workflows.

## Local setup

1. Copy `.env.example` to `.env` and set `VITE_SUPABASE_PUBLISHABLE_KEY` to the project's **publishable** key. The Supabase project URL is already configured in the example. The key was not included in the request, so it must be copied from the project's API settings. Never put a database password, secret key, or service-role key in this file.
2. In the Supabase SQL Editor for project `kbzkwojpzcolyduzctfq`, run the files in `supabase/migrations/` in filename order. This creates the schema and security policies, provisions the two initial consoles at ₹80/hour, and assigns the requested admin role to the confirmed `dg3667610@gmail.com` account if it already exists.
3. Enable Email in Supabase Authentication. To skip confirmation as requested, turn off **Confirm email** under Authentication → Sign In / Providers → Email. Set the Site URL and allowlist local and production account page URLs, for example `http://localhost:5173/account.html` and `https://YOUR_DOMAIN/account.html`.
4. Register `dg3667610@gmail.com` if it does not already exist. Run the third migration, `202610110003_admin_initialization.sql`, in the SQL Editor to grant that account the admin role through a trusted database operation.
5. Start the site:

   ```powershell
   npm install
   npm run dev
   ```

6. Sign into the admin dashboard, review console rates, and add the actual dates/times under **Slot availability**. No opening hours are invented or seeded.

## Security and behavior

- The browser uses only the project URL and publishable key. Every exposed table has RLS. Gamer profiles and bookings are private to their owner; the authenticated leaderboard RPC returns only gamer names, Game IDs, game tags, and aggregate play counts/duration. Admin queries require the database profile role.
- Auth-user triggers create permanent unique Game IDs and gamer profiles. The configured admin email is promoted only by a trusted database trigger after email confirmation.
- Booking inserts derive the user, status, and total from the authenticated session, selected availability row, and console rate. Admin status changes use a database RPC. A PostgreSQL GiST exclusion constraint prevents overlapping approved/completed sessions for one console, including concurrent approvals.
- Pending and rejected/cancelled requests do not reserve a slot. Completed booking totals drive spending and revenue metrics. Admin reports are queried from the database and support a date range; booking and gamer lists include search/status/date filters.
- The dashboard and status page refresh booking state through Supabase Realtime. Public visitors can read active console names and open times, but cannot read bookings or profiles.
- Tournament workflows use migration `202610110005_tournament_system.sql`. Public pages can read tournament schedules, registered names, brackets, match scores, and aggregate standings; all writes go through server-side RPCs. Registration is unique per account/event, bracket slots accept registered players only, and only admins can change tournament state, scores, or results.
- Confirmed tournament wins create versioned points transactions (10 points by default). Reconfirming an unchanged result is idempotent; an admin correction records a reversal and replacement award. Automatic byes advance without points. Result versions and point transactions are available to admins in the tournament dashboard audit panel.
- Migration `202610110006_wallet_games.sql` adds admin-managed INR credit and a configurable credit-per-hour conversion. Gamer cards display the wallet as remaining hours and minutes; approval debits the booking price, cancellation of an approved booking refunds the debit, and insufficient credit prevents approval. The More Games page also loads admin-added games from the database while retaining its existing catalog.
- Edit the seeded hourly rates from the admin console list. Prices are calculated by the database from those rates and booking duration; values in browser requests are not trusted.

## Build and deployment

Run `npm run build`; deploy the generated `dist/` directory to a static host. Configure `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in the host's build environment, then rebuild. Add the production account page to Supabase Auth's redirect allowlist. Do not deploy `.env` or any Supabase secret/service-role key to the static site.

For Vercel, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in **Project Settings → Environment Variables** for each environment you deploy (Production, Preview, and Development as appropriate), then trigger a new deployment. These `VITE_` values are included in browser assets at build time; only the publishable key belongs there. Vercel has not been configured from this workspace.

## Verification checklist

After applying migrations and configuring the publishable key:

1. Register a new email, confirm it, sign in, and verify its profile has role `gamer`, a stable `GN-...` Game ID, and only its own booking history.
2. Sign in as the confirmed admin email and verify the admin dashboard is shown. From a gamer session, try updating the profile `role` through the Supabase API; the column grant and database trigger must reject the change. A gamer must not be able to read another profile or booking directly; the leaderboard should expose only its documented aggregate player fields.
3. As admin, create an availability slot. As a gamer, request it and verify its status is `pending`, the displayed price matches the server-side rate, and it is not counted as a confirmed booking.
4. Approve the request as admin, then attempt to approve another overlapping request for the same console. The second approval must fail at the database exclusion constraint. Rejecting/cancelling a pending request should leave the slot requestable again.
5. Complete a booking and verify completed-session, spending, revenue, and utilization figures change from database records. Verify Realtime updates another open dashboard/status page.
6. Use password reset and confirm the recovery link opens the new-password form before it routes to the dashboard.
7. On the gamer card, update the name, phone, and up to five game tags. Confirm the card shows the selected tags and that the rankings filters reorder players by completed sessions, bookings, and completed playtime while marking the signed-in player's rank.
8. As admin, create a tournament, open registration, and confirm a gamer can register only once, withdraw before the deadline, and cannot exceed the player limit. Close registration and generate a random or manual bracket; verify odd-sized entries receive byes with no points, and that a manual bracket cannot start until every registered player is assigned exactly once.
9. Start the tournament, record and confirm a result, and verify the winner advances and receives points once. Reconfirm the same score and verify points do not change; correct the winner before its next match is confirmed and verify the audit records a reversal and replacement award.
10. Verify tournament management and score RPCs reject a gamer account, while public tournament pages and Realtime updates show registration counts, current matches, confirmed results, and rankings.
11. As admin, change the wallet's credit-per-hour rate and add credit to one gamer. Verify only that gamer sees the equivalent hours/minutes on their gamer card. Approve a booking within their credit, confirm the wallet debit, then cancel and confirm the refund; an over-balance approval must fail.
12. As admin, add a game to Solo, Duo, or Squad and confirm it appears in the matching More Games tab. Hide it from the admin library and confirm it disappears publicly, then restore it.

These are live-project checks and require applying migrations, a real publishable key, and test accounts. They cannot be run from this workspace before those manual steps.

## ESP32/ESP8266 status endpoint (disabled by default)

The optional `supabase/functions/device-status` function is not deployed and is not called by the website. Keep it that way until a device rollout is ready. It accepts only `online`, `offline`, or `maintenance`, authenticates a per-device bearer token by its SHA-256 hash, looks up an enabled device, and writes only that device's own console status. The device cannot change bookings, prices, user records, or roles. RLS denies browser reads/writes to device status; status records are admin-readable.

For a future deployment, provision a random per-device token outside the repository, store only its lowercase SHA-256 hex digest in `public.devices.token_hash`, and set that device's `enabled` field deliberately. Store the raw token on the device, not in website code. Deploy the function only when needed with Supabase CLI, set `SUPABASE_SERVICE_ROLE_KEY` as an Edge Function secret, and never expose that secret to the browser. Send `POST` requests to the function with `Authorization: Bearer <device-token>` and a JSON body such as `{"status":"online"}`. Disable a device by setting `enabled = false`; do not reuse tokens across devices.