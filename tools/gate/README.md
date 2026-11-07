# @dsh-nove/gate

Standalone replacement for `implement-gate`: phase state, write gate, `/gate-*` commands, and plugin-local skills.

## Commands

- `/gate-plan <work item>` — enter planning; the main agent dispatches planning and plan review;
- `/gate-implement <work item>` — enter implementation; requires a clean plan review for non-mechanical work; the main agent dispatches implement, two review axes, and verify;
- `/gate-code-review <scope>` — standalone read-only review; no implement/verify, findings only;
- `/gate-docs <scope>` — docs-only governance;
- `/gate-block <reason>` / `/gate-resume` — freeze or restore the current gate;
- `/gate-return-discuss` — user-only manual return to discuss; agents use the `gate_record` tool;
- `/gate-status` — factual state block including plan readiness and review rounds.

## Marker

New projects use `.agents/gate.json`; state lives in `.agents/state/gate/`.

The old `implement-gate` stays frozen until the new plugin passes its temporary-environment tests; cutover creates `.agents/gate.json`, enables this plugin, disables the old one, then deletes the old marker/state.

## Skills

`skills/` is plugin-local: `gate-planning`, `gate-plan-review`, `gate-implement`, `gate-code-review-standards`, `gate-code-review-spec`, `gate-verify`. Workers receive the matching skill body in their prompt; they do not read `.agents/skills` for these methods. Planning additionally receives `write-agent-notes` from the global skill.

## Main-agent dispatch

The main agent dispatches each worker and records its result:

```text
gate_record({ node, findings, requiresDiscussion, discussionReason, verification })
```

The gate does not dispatch workers. It owns phase, write permissions, orchestration protocol, review rounds, plan readiness, verify evidence and blocked/complete.

`requiresDiscussion=true` or a user-owned finding means the main agent calls `gate_record` for the current node with `requiresDiscussion:true`; the gate sets `discuss` and `blockReason=needs-user-decision`. If the tool is unavailable or fails, the agent asks the user to run `/gate-return-discuss`. No worker may run in `discuss`.

Verify requires `verification: { commands, evidence, passed }`; commands and evidence must be non-empty and evidence paths must exist. Missing evidence returns `verification-required`.

Review loops are capped at five rounds; an exhausted loop becomes `blocked`, never a pass.
