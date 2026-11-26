# Product sales
- [x] Include existing quantity-stock products in new sales, receipts and reports.
- [x] Validate atomic stock deduction, duplicate confirmation and single cancellation restoration with isolated fixtures.

- Verified authenticated owner in isolated temporary store: existing 5-unit charger searched and sold 2 × R$80 = R$160; stock 3, receipt and financial entry R$160; report 2 units / R$160 / R$100 gross profit. Mixed sale R$1160 completed; cancellation restored 5 products and available device. Empty, fractional, zero, excessive quantities and unauthorized store rejected. Concurrent same-token calls deducted once; competing stock calls rejected one sale. Temporary store and all fixture rows removed. Desktop and 390px mobile checked; 80 tests passed. Seller-specific and physical printing not exercised in this request.

# Quantity-product actions
- [x] Add permission-checked editing, reasoned stock adjustments/history, deletion, archiving and reactivation.
- [x] Preserve sale price/name/cost snapshots and exclude archived products from new sales.
- [x] Verify isolated existing-product edit, 10→8 adjustment, new-price sale, deletion and archive flows.
- Owner browser desktop/390px: existing fixture charger edited from name/30 cost/80 price to new name/40 cost/95 price; 10→8 logs -2 with reason, actor and timestamp. Product-only sale of 2 units totals 190, stock reduces to 6, receipt 000002 reads back. Original sale retains old name/80 price/30 cost; new sale captures 40 cost. Zero-balance history-free deletion passed; archival with balance blocked, zero-balance archive/history/reactivation passed. Negative/missing reason/stale balance/other store/historical deletion/archived sale rejected. Cancellation of archived product restores two units and reactivates. 84 tests passed; build OK; fixtures removed.
- Limits: no second-account browser test this turn; no physical printing. Historical product costs were not stored before this change: legacy sale cost snapshots use costs available at migration time, not unverifiable original acquisition costs.

# Device photo sharing
- [x] Include independent commercial description and sale price choices, selected by default, with preview, explicit copy and photo download alternatives.
- [x] Verify commercial-only payloads, selected photos, clipboard and desktop/mobile layout.
- [x] Report actual WhatsApp/device delivery verification limits and stop.

# Sales report
- [x] Build a real-data sales report with date/seller/model filters, store-timezone dates, summary, sale details and seller totals.
- [x] Reuse dashboard revenue/profit definitions; distinguish trade-ins, cash received and pending balances; flag missing costs.
- [x] Enforce existing store, sales, cost and finance permissions in server queries.
- [x] Verify cash, trade-in, partial credit and cancelled sales, dashboard parity, and seller restrictions; report limitations.

# Sale documents
- [x] Reuse immutable numbered sale receipts in Documents and New document; view, PDF and print in both screens without duplicate numbering.
- [x] Attach externally issued XML/PDF invoices to sales in Documents and sale detail; private storage and server-authorized store linkage.
- [x] Verify receipt identity, pending balance and invoice read-back; report test limits.

# Manual trade-ins and proposals
- [x] Allow authorized manual trade-ins without mandatory evaluation; keep IMEI, stock and financial rules.
- [x] Add evaluation/simulation modes with stock or existing catalog-model proposals, commercial copy and WhatsApp.
- [x] Verify manual trade sale, available-stock proposal and unavailable-model proposal.

# Invitation access review
- [x] Copy an existing invite from Team and compare fresh-browser app and hosted preview access.
- [x] Preserve the public invitation and confirmation return; warn about restricted preview links and prefer a configured published origin.
- [x] Test a disposable second account: login, explicit acceptance, membership, wrong-email rejection and protected routes.
- [x] Run 45 tests, confirm build OK and remove disposable account, membership and invitation.
- [x] Report the hosting restriction and email/public-deployment verification limits; stop here.

Observed: Team copied the current origin plus the existing invitation token; opening that token on the hosted preview in a fresh browser redirected to Lovable login before the app. The same invitation path was public on localhost. A newly provisioned, verified password account returned from login to acceptance, had no membership before acceptance, and entered the correct store as seller only after the RPC completed. Wrong-email UI and direct RPC acceptance were rejected; used links were rejected; anonymous app/admin and mobile logout checks passed, with no page errors.

Limits: no published URL exists; external invitation access requires publication (or a separately created shared preview). Actual signup email delivery, opening a confirmation email in another browser, and a published-site flow were not tested. The confirmation redirect contains the invitation destination and auth now responds to a newly confirmed session. Existing accounts, roles and invitations remain unchanged.
## Verification and limits
- 69 automated tests passed, including sale report cash/trade/partial credit/cancellation, proposal difference and receipt rules. Latest preview build OK.
- Owner browser: manual trade-in sale completed without evaluation; invalid IMEI error preserved input; used acquisition cost 1800; receipt 000013 identical from sale and Documents with original pending 3000; PDF download and XML/PDF attachment read-back passed. Temporary operational records and storage files removed.
- Seller browser: report hid cost, profit, margin and financial fields; cost RLS returned no rows.
- Stock and catalog-model proposals and clipboard passed in desktop Chromium. Catalog selection conservatively requires availability confirmation; there is no independent product catalog table, so existing inventory/evaluation model registrations supply options.
- Photo sharing: real JPEG and matching commercial text payload, copy/paste and 390px mobile layout passed; native share was intercepted, not delivered to WhatsApp.
- Not verified: actual WhatsApp delivery on physical devices; physical printing; invoice download through external browser signed URL; full cash/credit/cancelled report scenarios and dashboard parity in browser; manual trade-in completion by seller; isolated other-store invoice rejection. These need device/service access or further test fixtures.

# Evaluation record actions
- [x] Add row editing, confirmed deletion and historical archiving with server permissions.
- [x] Verify owner changes, snapshots, duplicate references and restrictions; remove temporary test data.
- [ ] Restore original values of existing evaluation iphone 13: a seller test unexpectedly had approval/team permissions and updated it; original amount/storage/client/notes are unavailable. Ask owner for original values.
