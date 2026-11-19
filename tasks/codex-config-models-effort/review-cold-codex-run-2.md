<!-- round=2 reviewed_sha=de14a7e8428766ca8c1bb7bf6fcf9d0bc6c1932b scope=full base=main reason="delicate" -->

The repository-required contract sweep leaves a contradictory settled rule. No runtime defects were found: all 676 targeted tests passed, static checks passed, and both bundles match a fresh build; live model/CLI compatibility was not tested.

Review comment:

- [P2] Supersede the earlier M/L implementation-equivalence rule — /Users/tstraub/canon-ai/.canon/worktrees/codex-config-models-effort/docs/decisions.md:676-676
  Without config overrides, implementation now uses `high` for M and `xhigh` for L, but the settled rule in `docs/decisions.md:252` still says M and L are identical on both `spec_review` and `implement`. That claim matched the baseline but now contradicts the matrix. Mark its implementation-equivalence clause as superseded, as required by the contract-sweep rule in [AGENTS.md:68](AGENTS.md#L68).