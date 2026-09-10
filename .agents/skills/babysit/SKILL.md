---
name: babysit
description: Keep the current PR current with its base branch, fix failing CI, and watch until it is ready to merge.
---

Keep the current PR up to date with its base branch (normally main), fix CI failures and merge conflicts, validate changes, commit and push, and keep watching until CI passes on the latest PR head and the PR is ready for the user to merge.
Before finishing, recheck that the latest base is included and all merge requirements are satisfied; continue if either branch changes, report blockers requiring human action, and leave merging to the user.
