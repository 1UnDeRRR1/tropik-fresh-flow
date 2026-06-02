# 09 — Branch Handoff Template

Copy this template into a new file (or into `/docs/04_PROJECT_LOG.md`) whenever switching branches or handing off between agents.

```
## Handoff: <YYYY-MM-DD>

- From branch:
- To branch:
- Reason for switch:

### Accepted current state
- Summary of where things stand (mirrors `/docs/03_CURRENT_STATE.md` at handoff time).

### Changed files in this branch
- file 1
- file 2

### DB / RLS / auth changes
- DB: yes/no — details
- RLS: yes/no — details
- Auth: yes/no — details
- Migrations applied: list filenames

### Checks passed
- typecheck:
- build:
- manual smoke (which sections from `/docs/08_QA_SMOKE_TESTS.md`):

### Known risks
- (list)

### Do NOT touch
- (files, tables, RPCs, RLS policies that must remain untouched)

### Next safe action
- (single concrete next step, mode: Plan | Preview | Build | Apply | Audit | QA)

### Recommended mode for next agent
- Plan | Preview | Build | Apply | Audit | QA
```
