# Workflow changes to apply before committing

Move `workflow/ipfs-deploy.yml` to `.github/workflows/ipfs-deploy.yml`, replacing the current file. It attaches the triggering CI commit to the checkout step so IPFS publishes the tested revision.

Delete `.github/workflows/augur-scan.yml`. Its unit/API/replay and PostgreSQL integration jobs are already covered by the canonical CI workflow.

Then remove this README and the empty `workflow/` directory. Commit these changes together with the Docker and test cleanup in the worktree.

The workflow tests now inspect only active `.github` files. Validation was run with the corrected workflow in its final location and the duplicate removed. Until you apply these steps, those tests will correctly report the outstanding workflow changes.
