# Handle a universe fork

After a universe forks, the parent pair closes swaps and additions. Remove parent LP into parent YES/NO shares, then choose the destination branch or branches explicitly. No tool in this project chooses a branch or migrates LP automatically.

`ShareToken.migrate(fromId, targetOutcomeIndexes)` migrates one source token ID per call. The source and destination are independent choices: a parent INVALID, YES, or NO share can migrate into any valid branch of the fork question. The child receives the same share outcome as the source. For example, migrating parent YES into three scalar branches produces child YES shares in all three children.

Choose fork targets by question type:

- For a categorical fork, select Invalid or one or more labeled answers.
- For a scalar fork, select Invalid or add one or more exact scalar ticks. The UI displays the human value and derives the packed onchain outcome index.

For every nonzero parent INVALID, YES, and NO balance you intend to migrate, submit a separate call with that token ID and the explicitly chosen, strictly increasing target outcome indexes. Each call mints the corresponding child-universe share balance. The parent balance remains visible, but that source token ID is locked for the wallet after migration and can no longer be transferred.

A single-target call may create a missing child SecurityPool. A multi-target call must reference children whose canonical pools already exist. To migrate one source share to several new scalar outcomes, submit each missing outcome by itself. Locking prevents transfers, but it does not prevent later migration of that same source into a new child. After those children are ready, another source share can target all of them in one call. Every call must add at least one source-and-child entitlement that the wallet has not migrated before.

After each call, verify the expected child token ID and balance, then refresh or discover the canonical child SecurityPool. Wait until migration and truth-auction processing restore it to `Operational`, and create a new pair for that exact child pool. Parent and child token IDs and reserves remain isolated.

The live UI’s **Fork migration** action loads the actual fork question, keeps the INVALID/YES/NO source selector separate from its categorical or scalar target picker, and accepts many target branches. It simulates the exact `ShareToken.migrate` call before submission and states that the entire selected source balance is copied and locked. Repeat the workflow for each source share you intentionally choose.
