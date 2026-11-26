<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture rules
- Account menus share the ordered sign-out helper (cancel requests, clear queries, local auth sign-out, clear account storage, replace with login); recovery changes require a recovery-link session and preserve a sanitized invite destination.
- Every store-owned table carries `store_id` and is protected by RLS via `is_store_member` / `has_store_permission` — isolation must never rely on UI filters.
- Device costs live in `device_costs` / `accessory_costs` (permission-gated RLS) so users without cost permission never receive them.
- Store files go in private bucket `store-files` under `{store_id}/devices|logo/...` and are only shown via signed URLs.
- Money is `numeric(12,2)` in DB and summed as integer cents in `src/lib/money.ts`.
- Unbuilt modules render `EmDesenvolvimento` with no fake actions.
- Quantity-stock products reuse accessories and immutable sale_product_items; complete_sale locks stock and store numbering before idempotency checks, while cancel_sale restores quantities only after the authorized first cancellation, so mixed and product-only sales share existing finance and receipts.
- Product edits/adjustments/archive use manage_accessory with store permissions and locks; movement rows are read-only and sale costs are snapshotted separately under cost RLS, preserving historical margins.
- Sales are written only through the security-definer RPCs `complete_sale` / `cancel_sale` (transactional, idempotent via `client_token`, permission-checked); sale tables are read-only via RLS. The emitted receipt is the immutable `sales.receipt_snapshot` taken at completion.
- Trade-ins create a `devices` row in `em_conferencia` with the agreed value as `device_costs.purchase_cost`; cancelling a sale returns sold devices to `disponivel` and marks trade-ins `devolvido_cliente`.
- Sub-pages of a list route use the trailing-underscore pattern (`vendas_.nova.tsx`), because a content route without `<Outlet />` swallows nested children.
- Money movement lives in `financial_entries`; sale/card/crediário receipts are written only by the security-definer RPCs `register_sale_receipt`, `receive_installments`, `reverse_receipt`, `register_refund` (all idempotent via `client_token`). Card payments become pending operator receivables via the `sale_payment_to_finance` trigger — never instant cash. Crediário schedules are no-interest only until an interest method is documented and verified.
- Cancelling a sale never auto-refunds: it sets `sales.refund_due` and cancels open receivables; actual refunds are separate `register_refund` calls. A trade-in device already sold or committed blocks cancellation.
- Trade-ins may be entered manually through the authorized sale RPC; optional evaluations are linked only for the same store/client and unused rows, without requiring approval. Evaluations retain their server-computed snapshots; simulation drafts never write sales, reservations or finance.
- Receipt screens share the same immutable snapshot and completion-event totals; invoice XML/PDF files use private sale-scoped paths with server-validated store linkage, so numbering and operational records are never duplicated.
- CRM opportunities/tasks are editable only by their responsible user or members with team permission (RLS); changing a stage or linking a sale never touches stock or finance.
- Platform admin = `user_roles.admin` (no insert policy; granted only by backend SQL). `/admin` reads stores only through security-definer `admin_*` RPCs that call `require_platform_admin()` and never expose operational store data.
- Store access is gated server-side by `store_access_ok` inside `is_store_member` / `is_store_owner` / `has_store_permission`; `is_store_member_any` (no access gate) is used only for store, team, subscription and notification reads so suspended stores still see their account status. Billing status and access status are separate columns; missing/`legacy` subscriptions stay open.
- Plan price/limit are snapshotted into `store_subscriptions.contracted_price/user_limit` by `admin_assign_plan`; the user limit is enforced by triggers on `store_members` and `store_invites`.
- Owner-role changes go only through `set_member_role` / `remove_owner`, which lock the store row and refuse to leave zero owners; owner and admin actions are logged in `admin_audit` (no write policies).
- Sale notifications are created by a deferred constraint trigger on `sales` (fires at commit, unique per user+sale) and read per user from `notifications` via realtime.
- Team invites carry a single-use `token` with 7-day expiry and `revoked_at`; they are written only via `create_store_invite` / `resend_store_invite` / `revoke_store_invite` and accepted only via `accept_invite(token)`, which requires the caller's verified email to match the invite. `accept_my_invites` is deprecated (returns 0). No invite email is sent until an email domain is configured — the UI hands the owner a copyable `/convite/<token>` link and says so.
- Platform admin lives only at `/admin` (never linked from the store shell); the legacy `/app/admin` route only re-checks `user_roles.admin` and redirects. `/auth` accepts a same-origin `redirect` search param used by the auth gate and the invite flow.
- Invitation links prefer an explicitly configured `VITE_PUBLIC_APP_URL`, otherwise the current origin; copying on a restricted preview warns the owner to copy from the published site. Keep `/convite/$token` public, preserve its destination through confirmation, and select the RPC-returned store only after atomic acceptance succeeds.
- WhatsApp attendance: verified gateway webhooks land in `whatsapp_webhook_events` and are processed only by security-definer `wa_process_event` (idempotent by delivery and message id); message states are recomputed from all stored callbacks by `wa_apply_statuses`, so callback order never regresses status. Sends/retries/media go through permission-checked server fns; media lives in private bucket `whatsapp-media` served only by signed URLs after an `attend_chats` check.
