<!-- round=1 reviewed_sha=bef655a1e5e1c1a48b4e5ab5a7caad6f9010d709 scope=full base=main reason="Round 1 (initial review)" -->

The attach path now reuses the existing crash-evidence checks for pending or in-progress phases, while retaining prior outcomes when there is no fresh crash evidence. No actionable regressions were found in the reviewed diff.