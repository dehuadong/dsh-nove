# @dsh-nove/gate

Standalone replacement for `implement-gate`: phase state, write gate, `/gate-*` commands, and plugin-local skills.

## Commands

- `/gate-plan <work item>` — enter planning; the main agent dispatches planning and plan review;
- `/gate-implement <work item>` — enter implementation; the main agent dispatches implement, two review axes, and verify;
- `/gate-docs <scope>` — docs-only governance;
- `/gate-return` — return to discuss;
- `/gate-status` — factual state block including review rounds.

## Marker

New projects use `.agents/gate.json`; state lives in `.agents/state/gate/`.

The old `implement-gate` stays frozen until the new plugin passes its temporary-environment tests; cutover creates `.agents/gate.json`, enables this plugin, disables the old one, then deletes the old marker/state.

## Skills

`skills/` is plugin-local: `gate-planning`, `gate-plan-review`, `gate-implement`, `gate-code-review-standards`, `gate-code-review-spec`, `gate-verify`. Workers receive the matching skill body in their prompt; they do not read `.agents/skills` for these methods. Planning additionally receives `write-agent-notes` from the global skill.

## Main-agent dispatch

The main agent dispatches each worker and records its result:

```text
gate_record({ node, findings, requiresDiscussion, discussionReason, ok })
```

The gate does not dispatch workers. It owns phase, write permissions, orchestration protocol, review rounds and blocked/complete.

`requiresDiscussion=true` or a user-owned finding means the main agent must call `/gate-return` before discussing; the gate sets `discuss` and `blockReason=needs-user-decision`. No worker may run in that state.

Review loops are capped at five rounds; an exhausted loop becomes `blocked`, never a pass.
