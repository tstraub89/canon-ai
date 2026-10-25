<!-- round=2 reviewed_sha=8b41c688f9e08edefd93db78d1217b04957637f5 scope=delta base=02e7eb86051ea37692c1328783a31c904db05b1d reason="delta" -->

The code changes add a fallback rejection for task IDs that fail validation, update the outside-git error prefix, and add regression coverage for the previously identified cases. I found no actionable regression in the diff.