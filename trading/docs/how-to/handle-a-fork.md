# Handle a universe fork

After a universe forks, the parent pair closes swaps and additions. Remove parent LP into parent YES/NO shares, then choose the destination branch or branches explicitly. No tool in this project chooses a branch or migrates LP automatically.

`ShareToken.migrate(fromId, targetOutcomeIndexes)` migrates one source token ID per call. For every nonzero parent INVALID, YES, and NO balance you intend to migrate, call it separately with that token ID and the explicitly chosen, strictly increasing target outcome indexes. Each call mints the corresponding child-universe share balance. The parent balance remains visible, but that source token ID is locked for the wallet after migration and can no longer be transferred.

After each call, verify the expected child token ID and balance before migrating the next parent token. Then create or discover the canonical child SecurityPool, wait until migration and truth-auction processing restore it to `Operational`, and create a new pair for that exact child pool. Parent and child token IDs and reserves remain isolated.

The live UI’s **Fork migration** action accepts one source share and one explicit fork outcome index. It simulates the actual `ShareToken.migrate` call before submission and clearly states that the entire selected source balance is copied and locked. Repeat the workflow for each source share or destination branch you intentionally choose.
