---
name: babysit
description: Keep the current PR current with its base branch, fix failing CI, and watch until it is ready to merge.
---

Keep the PR current with its base branch (normally main). Resolve conflicts, fix CI, validate, commit, and push. Repeat if either branch changes until the latest head includes the base and passes all merge requirements. Report blockers that need human action and leave merging to the user.
