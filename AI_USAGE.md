# AI usage

> **Draft to be confirmed by the author before submission.** Edit this so it reflects what you actually did.

**Tools:** Claude (Anthropic) was used to design and generate the initial implementation: backend modules, tests, frontend, and documentation.

**How the output was verified**
- Ran the full automated suites (`npm test` in both apps) and the type checker in both apps.
- Mutation-checked the concurrency tests: temporarily disabled the lock (`runExclusive` just calls the task) and confirmed 6 tests fail, then restored it. Also removed the retry-coalescing check and confirmed a test fails. This caught one weak test (a concurrent-refund test that passed without the lock), which was replaced by a service-level race test using a repository that returns stale reads.
- Exercised the real UI in a headless browser: submit, POS failure, duplicate, retry, invalid total, unknown-order lookup.
- Called the compiled server with `curl` for the failure, retry and refund flows.

**Understanding:** the author must be able to explain every module. Key files to know: `concurrency/KeyedLock.ts`, `services/OrderService.ts`, `pos/SimulatedPos.ts`, `domain/paymentEvent.ts`.

**Things the author should double-check personally:** the coalescing logic in `OrderService.syncOrder`, and the HTTP status choices (201/200/502/409) listed in the README.
