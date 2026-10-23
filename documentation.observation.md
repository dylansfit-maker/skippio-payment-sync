## Retry synchronisation and duplicate prevention

### Retry synchronisation behaviour

- A retry on a **synced** order returns `200` and makes **no** POS call.
- A retry on a **failed** order makes **one** POS attempt. It returns `200` on success, or `502` with the current order state on failure.
- **Overlapping retries** share a single POS call.

### Simulated POS and duplicate prevention

- The simulated POS **does not deduplicate**. The tests therefore check that the application prevents duplicates, rather than relying on the fake.
- Each order is processed under a **per-order lock**.
- A repeated or concurrent delivery, even with a new event ID, finds the existing order and **never calls the POS again**.
- The POS keeps its own **transaction log**, so any duplicate would be visible.

### Minor assumptions

- Event IDs identify deliveries. Reusing one for a different order is **not currently rejected**.
- Conflict detection compares items **in the order supplied**.
- Any POS error is treated as a **retryable failure**.