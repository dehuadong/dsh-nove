---
name: gate-implement
description: Gate 派发的实现 worker；保留原 implement 的授权、拆解、执行与完成方法，Implementation Review 交给 gate 的两轴 worker。
---

# Implement

## 1. Entry conditions

Implement the selected scope of the identified Proposal or existing work item. Resolve its issue ID, URL or file path and the requirements and design sections it references before coding.

Before implementation, check the scope and acceptance conditions, required decisions and review/approval evidence, unresolved blockers, and execution authorization for that scope under project rules. Reuse valid evidence without requesting confirmation again. Sync already agreed scope and decisions to their existing owners; route unresolved material decisions through the project's discussion, authorization, and gate rules before returning to Planning. Document status or location alone does not establish readiness or authorization.

For a review-only request, use the `code-review` skill without entering implementation or requiring its gate. Deliver findings and coverage limitations; do not automatically fix changes or advance their workflow status. The implementation correction and completion rules apply only to authorized implementation.

## 2. Decompose when needed

After the Implementation Gate passes, create implementation tickets only when decomposition is needed. Their existence is not a condition for initially entering implementation.

Implement directly when the work fits one coherent execution unit.

Read [tickets.md](./tickets.md) when the work is too large or has meaningful independent slices or dependencies.

Do not create tickets merely to enumerate coding steps.

## 3. Execute

Implement against the selected work item's scope, acceptance conditions, referenced requirements, accepted designs and architectural decisions.

Use established architecture, conventions, interfaces, and domain language unless the authoritative design explicitly changes them.

If implementation exposes a material unresolved product, domain, architectural, interface, compatibility, or other contract decision, stop affected implementation and follow the project's discussion, authorization, and gate rules to return it to Planning.

### Implementation-time testing

Write or update tests as appropriate for the change. Use test-first development when it improves feedback or helps establish behavior clearly; when adopting it, load the `tdd` skill and follow its workflow.

Run focused tests and relevant static checks while working.

## 4. Implementation Review handoff

Implementation Review is run by the gate as separate `gate-code-review` workers on the Standards and Spec axes. Do not run it yourself.

The gate returns findings. During authorized implementation, resolve material findings by ownership:

| Finding                                                           | Route                                  |
| ----------------------------------------------------------------- | -------------------------------------- |
| Current implementation is missing or violates the agreed contract | Fix in the current implementation      |
| Additional execution unit is needed within the same agreed work   | Add or update an implementation ticket |
| Product or technical contract must change or was never resolved   | Follow project gates and authorization to return to Planning |
| Issue is unrelated to the agreed work                             | Do not expand scope automatically      |

There is no "fix it while we're here" path for unrelated work.

For implementation corrections, return to §3, rerun affected checks, and return the receipt for re-review.

## 5. Completion and handoff

Implementation is complete when:

- the authorized scope is implemented
- required tickets are complete
- relevant implementation-time checks pass
- material Implementation Review findings are resolved
- the change is ready for final verification

Return the implementation receipt to the gate. The gate owns the verify node; do not advance the workflow or update delivery state here.

Update the identified work item's implementation progress using the project's workflow convention. Leave final delivery completion and decision-record completion updates to the gate's verify node.
