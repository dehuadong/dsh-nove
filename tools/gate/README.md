# @dsh-nove/gate

Standalone replacement for `implement-gate`: phase state, write gate, `/gate-*` commands, and plugin-local skills.

## Commands

- `/gate-plan <work item>` — orchestrate planning and plan review;
- `/gate-implement <work item>` — orchestrate implement, two-axis code review, and verify;
- `/gate-docs <scope>` — docs-only governance;
- `/gate-return` — return to discuss;
- `/gate-status` — factual state block.

## Marker

New projects use `.agents/gate.json`; state lives in `.agents/state/gate/`.

The old `implement-gate` stays frozen until the new plugin passes its temporary-environment tests; cutover creates `.agents/gate.json`, enables this plugin, disables the old one, then deletes the old marker/state.

## Skills

`skills/` is plugin-local: `gate-planning`, `gate-plan-review`, `gate-implement`, `gate-code-review`, `gate-verify`. Workers receive the matching skill body in their prompt; they do not read `.agents/skills`.

## Workers

The gate dispatches workers directly through `ctx.subagents.startActivation`. It does not allow a worker to spawn another worker. Child gate state is written before dispatch and removed after the worker finishes.

Review loops are capped at five rounds; an exhausted loop becomes `blocked`, never a pass.
