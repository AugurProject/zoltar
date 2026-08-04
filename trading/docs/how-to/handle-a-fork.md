# Handle a universe fork

After a universe forks, the parent pair closes swaps and additions. Remove parent LP into parent YES/NO shares. Choose migration target outcome indexes explicitly and invoke the authoritative `ShareToken.migrate(fromId, targetOutcomeIndexes)` flow.

Create or discover the canonical child SecurityPool, wait until migration and truth-auction processing restore it to `Operational`, then create a new pair for that exact child pool. Parent and child token IDs and reserves remain isolated. No tool in this project chooses a branch or migrates LP automatically.
