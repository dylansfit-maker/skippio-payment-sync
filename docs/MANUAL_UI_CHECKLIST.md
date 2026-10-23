# Manual UI checklist

Start both apps (see README). Default simulated POS: the **first attempt per order fails**, the retry succeeds.
Open http://localhost:5173. Tick each item as you go.

**Submission**
- [ ] Page loads; the event type and currency dropdowns are populated from the backend (stop the backend and reload: a clear error with "Try again" appears).
- [ ] Fill venue, product, quantity, price. The order total fills itself in and updates as items change.
- [ ] "Add item" adds a row; "Remove" removes one (disabled when only one row is left).
- [ ] "Send payment event" shows a spinner and a disabled button, then a warning: *payment recorded, POS sync failed*.
- [ ] The order panel opens automatically with Payment = Paid, POS sync = Failed, attempts = 1, POS reference "—", last error shown.

**Failure and retry**
- [ ] "Retry POS sync" is visible only while sync is Failed. Click it: spinner, then success message.
- [ ] POS sync = Synced, attempts = 2, a POS reference is shown, Retry button is gone.
- [ ] The "Simulated POS transactions" panel shows exactly **one** transaction for the order.

**Duplicates**
- [ ] Click "Send payment event" again unchanged: blue *Duplicate* message; POS panel still shows one transaction; attempts unchanged.
- [ ] Click "New event ID" and send again: still *Duplicate*; the order's Event IDs now lists both IDs; still one POS transaction.
- [ ] Change a price (and the total) but keep the same Order ID: a red error says the order already exists with different data and lists the differences; the looked-up order is unchanged.

**Validation**
- [ ] Edit "Order total" to a wrong value: an inline warning shows the calculated total; sending shows the backend's rejection.
- [ ] Quantity 0, empty product ID, empty venue: the backend's messages are listed under the form.
- [ ] A price like "abc" is rejected in the form before sending.

**Lookup**
- [ ] Type an existing order ID and "Look up": items, formatted prices, subtotals, total, states, attempts, reference all shown.
- [ ] An unknown ID shows "No order found…". An empty ID asks for an ID.
- [ ] Refresh button reloads the current order.

**Refund (API only; no UI by design)**
- [ ] `curl -X POST localhost:3001/orders/<id>/refund`, then Refresh in the UI: Refund shows "Refunded €…". Re-sending the payment event keeps it refunded.

**Accessibility / layout**
- [ ] Every input has a label; Tab order follows the visual order; focus ring is visible.
- [ ] Narrow the window below ~860px: layout stacks to one column without horizontal scroll.
