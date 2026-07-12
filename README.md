# WebpageAgent

WebpageAgent is a small TypeScript runtime for turning user or agent intent into observable, policy-checkable, deterministic actions inside a web page.

The project is an interaction runtime, not a general browser agent. Planning, model providers, memory, protocol transport, and long-running orchestration stay outside the core.

> Status: early implementation. The public contracts are experimental until the first benchmark-backed release.

## What is implemented

- Framework-neutral runtime with `observe`, `resolve`, `execute`, `step`, and `run`.
- Typed semantic observations and action proposals.
- Structural and stale-observation validation.
- Effect-aware intent constraints and pluggable policy decisions.
- Explicit human approval contract.
- Deterministic DOM/accessibility observation and execution.
- Verification-derived result status (`succeeded` versus `unverified`).
- Typed lifecycle events.
- Explicitly bounded multi-step execution.
- Password-value redaction in the default DOM observer and reader.

Model-assisted resolution, vision, a default UI, protocol adapters, and persistent replay caches are intentionally not part of this initial slice.

## Packages

| Package               | Responsibility                                                                                |
| --------------------- | --------------------------------------------------------------------------------------------- |
| `@webpage-agent/core` | Contracts, runtime pipeline, policies, events, approval, verification, and bounds             |
| `@webpage-agent/dom`  | DOM/accessibility observation, stable locator resolution, and deterministic browser execution |

## Install and build

Prerequisites:

- Node.js 22+
- pnpm 11.0.5+

```bash
corepack enable
pnpm install
pnpm --filter @webpage-agent/dom exec playwright install chromium
pnpm build
pnpm test
```

## Minimal use

The caller supplies an intent resolver. This keeps model and agent-framework dependencies outside the runtime.

```ts
import { createWebpageAgent } from '@webpage-agent/core';
import { DomExecutor, DomObserver } from '@webpage-agent/dom';

const agent = createWebpageAgent({
  observer: new DomObserver(),
  executor: new DomExecutor(),
  resolver: {
    name: 'application-resolver',
    async resolve(intent, observation) {
      const save = observation.nodes.find((node) => node.role === 'button' && node.name === 'Save');

      if (!save) return { completed: true };

      return {
        id: crypto.randomUUID(),
        kind: 'activate',
        target: { nodeId: save.id, locator: save.locator },
        expectedEffects: [{ kind: 'visibility' }],
        risk: { level: 'medium', effects: ['remote-mutation'] },
        confidence: 1,
        observationVersion: observation.version,
        provenance: { resolver: 'application-resolver' },
      };
    },
  },
});

const result = await agent.run('Save my changes');
```

`run()` executes at most one action by default. Multi-step autonomy must be selected and bounded explicitly:

```ts
await agent.run('Update the form and save it', {
  mode: 'bounded',
  maxActions: 8,
  maxResolutions: 9,
  timeoutMs: 30_000,
});
```

## Policy and approval

```ts
const agent = createWebpageAgent({
  observer,
  resolver,
  executor,
  policy: {
    async evaluate(proposal) {
      return proposal.risk.effects.includes('financial')
        ? { decision: 'require-approval', reason: 'This changes a financial resource.' }
        : { decision: 'allow' };
    },
  },
  approval: {
    async request(proposal, context, reason) {
      return showApprovalDialog({ proposal, context, reason });
    },
  },
});
```

Every execution re-observes the page. A proposal is rejected when its observation version is stale, its target disappeared, or its target no longer supports the proposed action.

## Security boundary

- Page content is observation, never policy.
- The resolver can propose only typed actions; it cannot add capabilities.
- Arbitrary JavaScript execution is not supported.
- Hidden, disabled, stale, and ambiguous targets fail closed.
- Password values are redacted by the default observer and reader.
- Mutation effects can be denied or sent to approval before execution.

See [docs/architecture/runtime.md](docs/architecture/runtime.md) and [SECURITY.md](SECURITY.md).

## Development

```bash
pnpm build
pnpm test
pnpm coverage
pnpm lint:eslint
pnpm knip
pnpm lint
```

The repository uses Trunk for formatting and the broader lint/security harness. See [AGENTS.md](AGENTS.md) for repository conventions.

DOM integration tests run the actual package in Playwright Chromium through a local Vite fixture page. They cover native accessibility semantics, password redaction, stable locator ambiguity, form events, control execution, asynchronous page changes, and open shadow roots. Vitest remains responsible for fast framework-neutral core tests and unit coverage gates.

## License

Apache-2.0
