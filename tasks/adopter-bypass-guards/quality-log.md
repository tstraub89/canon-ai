# Task Quality Log

## Log

| Date | Task | Size | Spec verdict | Spec iter | Review iter | Dropped ACs | Validation gaps | Human reroute? | Notes |
|---|---|---|---|---|---|---|---|---|---|
| 2026-11-01 | adopter-bypass-guards | M | changes_requested | 5 | 4 | 2 | 1 | No | Round 1 review found AC-2 (Perl in-place scanner denied reads) and AC-4 (gh global `-R` before `pr` skipped the merge rule); the round 2 Perl fix then regressed `-lpi`, caught in round 3. |

## Periodic Reviews
