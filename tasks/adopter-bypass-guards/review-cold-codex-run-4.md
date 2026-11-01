<!-- round=4 reviewed_sha=5b72a0a80cdaaaf6857e9cb5b18ba6c1c5a5b4ca scope=delta base=89137cbffa5a963a9aa97674f039f3f8d0eb3861 reason="delta" -->

The guard changes correctly recognize mixed short-option clusters containing merge-strategy flags and avoid treating Perl’s `-C` value as subsequent short options. The targeted canon-guard tests pass.