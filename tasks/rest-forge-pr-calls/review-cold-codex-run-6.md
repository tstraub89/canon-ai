<!-- round=2 reviewed_sha=d2fc1371309a9c6cc0cab9fb764546f9a6b34a29 scope=delta base=4971182971b79cf3302abcaf301701f28bd5fb42 reason="delta" -->

The change percent-encodes the owner/branch separator to prevent gh from interpreting branch-name prefixes as placeholders, and updates the generated bundle and regression tests consistently. No actionable issues were found.