import type { ContractReference } from './contract-reference-metadata.mts'
export const forkEscalationContractReferences: ContractReference[] = [
	{
		compiledAbiFingerprint: 'b6bc0b72666f981acc4bbffb4c61b4d27b293e9401d24fe557f1fff971b5b126',
		name: 'EscalationGame',
		purpose: 'Escrows outcome REP, raises the running resolution cost, detects [non-decision](./glossary.html#non-decision-threshold), and settles local or carried deposits.',
		readAbiFingerprint: 'a5c1a9fabcecbc58e19e26815835b8b13baf7e51d3d0bf33f0d3a206c32fff95',
		readSurface:
			'Base getters are `securityPool`, `repToken`, `activationTime`, `nonDecisionThresholdAttoRep`, `startBondAttoRep`, `nonDecisionTimestamp`, `nonDecisionState`, `forkContinuation`, `forkElapsedAtStart`, `forkResumedAt`, `fixedQuestionOutcome`, `nodes`, `disputeStakedRepByVaultAttoRep`, `totalDisputeStakedAttoRep`, `ordinarySettlementInitialized`, `ordinaryWinningReserveAttoRep`, `creditedSurplusAttoRep`, `settlementForkThresholdAttoRep`, and `winnerHaircutPaidByFork`. Every accepted deposit, and a continuation\u2019s resume in an unforked universe, records the universe fork threshold in `settlementForkThresholdAttoRep`. A final continuation resumed after its universe forked again records `nonDecisionThresholdAttoRep` instead, preserving unscaled entitlements; winning claims scale by that value, so REP burned after the game\u2019s last change cannot lower any payout. Ordinary settlement fixes the winner liability; losing local deposits and escrow read as zero afterward, while raw historical nodes remain stored. The fallback forwards every selector other than signed and lead-protected deposits to `EscalationGameClaimDelegate`, which provides the reads `rootClaimSourceGame`, `getInheritedClaimAllocation`, and `getUnresolvedClaimInterval`, plus `getClaimCheckpointProgress`, `getClaimCheckpointState`, `getClaimCheckpointWitnessSegment`, `getReusableClaimCheckpoint`, `getClaimIntervalTransform`, and `isClaimHistoryFrozen`. Allocation reads inspect at most eight ancestors; deeper histories require permissionless checkpoint preparation. Central portfolio reporter claims keep identity coordinates across live branches and resolve their interval without ancestor traversal; their membership proofs and per-branch nullifiers still apply. `getClaimCheckpointProgress` distinguishes stored completion from readiness through the bounded read path. `getClaimCheckpointState` returns initialization, the pending commitment, the reused ancestor, and the current four-coordinate interval. `getClaimCheckpointWitnessSegment` returns the canonical source, prior commitment, first step, and length of the active segment; at most eight local transform reads reconstruct the batch from current state. `getReusableClaimCheckpoint` exports a completed interval and its excluded immediate-source anchor; descendants select caches only along their canonical lineage for the same claim tuple. The allocation read returns source principal, retained principal, reward-interval length, and the cumulative reward endpoint after compaction of consumed principal prefixes. The reward interval is the deposit\u2019s range within its outcome\u2019s cumulative deposits: its start is the returned endpoint minus the returned length. It determines which portion enters the reward calculation; the length is not a payable reward. Exported principal intervals compact consumed prefixes, while reward positions remain unshifted by prior claims. Allocations within a game stay fixed in every claim order. `disputeStakedRepByVaultAttoRep` is nominal reporter principal, not collateral value. `getDisputeBackingAttoRep` returns actual game REP; `getVaultDisputeBackingAttoRep` credits ordinary reports only for their contribution retained after source surplus, and returns zero for continuation claims. Inherited carry remains aggregate commitment state until proof settlement. Use `previewLeadingDepositOnOutcome` for a required lead and `previewDepositOnOutcome`, `computeIterativeAttritionCostAttoRep`, `computeTimeSinceStartFromAttritionCostAttoRep`, `totalCostAttoRep`, `getEscalationGameEndDate`, `getQuestionResolution`, `getFinalQuestionResolution`, `hasReachedNonDecision`, `canTriggerOwnFork`, `getBindingCapitalAttoRep`, `getOutcomeBalancesAttoRep`, `getDepositsByOutcome`, `getDepositsByOutcomeLength`, `forkCarrySnapshotInitialized`, `forkCarrySnapshotOutcomesInitialized`, `getOutcomeState`, `getForkCarrySnapshot`, `getForkCarryRoots`, `isForkCarryFundingComplete`, `getCarryLeafPageByOutcome`, `getProofConsumedCarriedDepositIndexesByOutcome`, and `getLocalUnresolvedPrincipalByVaultAndOutcome` for calculations, lifecycle authorization, pages, carry state, and escrow. `getCarryLeafPageByOutcome` limits visited nodes by `maxEntries`, including consumed nodes; empty or short pages may return a nonzero continuation cursor. A nonzero start cursor must be an issued node of the requested outcome. Wallet reports and finalized withdrawals route through `SecurityPool`; after an ordinary game starts, wallet-funded deposits use `depositRepOnOutcome`, `depositRepOnOutcomeWithPermit`, or `depositRepOnOutcomeWithAuthorization` and mint no pool backing units.',
		interactionNotes:
			'Rows marked "through `fallback()`" are not in the compiled ABI: the fallback forwards the signed and lead-protected deposit selectors to `EscalationGameDepositDelegate` and every other unknown selector to `EscalationGameClaimDelegate` by `delegatecall`, and returns or reverts with the delegate output. A call restricted to the owning pool or its forker reverts without reason data for any other caller. For central portfolio custody, report REP is held in the reporter ledger, independently of provider REP. Unrelated resumed continuations accept wallet-funded deposits. Fixed-outcome continuations end exactly three days after the child response anchor, which is the native parent fork time plus nine weeks; late materialization does not extend it. Other continuation deadlines retain their inherited elapsed time and minimum response period. The signed elapsed offset is negative when the parent fork interrupts the three-day activation delay; that remaining delay is preserved, and attrition stays zero until it expires. A later native fork interrupts unresolved reporting before any fixed outcome can be returned. `totalCostAttoRep` freezes attrition at the recorded universe fork time; a continuation whose universe forked before resume retains its inherited elapsed offset without adding wall-clock time. The scheduled deadline is the last second before the forward curve strictly exceeds binding capital (the median outcome balance), including integer-rounding plateaus; reporter and settlement books schedule that same cutoff. A deposit that raises the median moves the deadline later, including a change of leader, which raises it to the old leader\u2019s stake; a top-up on the leader adds no time, and no deposit starts a separate response period, so an ordinary game never ends after activation plus the escalation interval. `getEscalationGameEndDate` returns that cutoff, or for a resumed continuation without a fixed outcome the later of the rebased cutoff and `forkResumedAt + 3 days`. Any deposit of at least the start bond is accepted while the game is open: while `getQuestionResolution` is `None`, or through a resumed continuation\u2019s fixed response period. An unresolved parent cannot become final later.',
		readDeclarations: [
			{
				name: 'previewDepositOnOutcome',
			},
			{ name: 'previewLeadingDepositOnOutcome' },
			{
				name: 'disputeStakedRepByVaultAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
			},
			{
				name: 'getDisputeBackingAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol',
			},
			{
				name: 'getVaultDisputeBackingAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol',
			},
			{
				name: 'getClaimCheckpointProgress',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getClaimCheckpointState',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getClaimCheckpointWitnessSegment',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getReusableClaimCheckpoint',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getClaimIntervalTransform',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'isClaimHistoryFrozen',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'rootClaimSourceGame',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getInheritedClaimAllocation',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'getUnresolvedClaimInterval',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
			{
				name: 'computeIterativeAttritionCostAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'computeTimeSinceStartFromAttritionCostAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'totalCostAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getEscalationGameEndDate',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getQuestionResolution',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getFinalQuestionResolution',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'hasReachedNonDecision',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'canTriggerOwnFork',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getBindingCapitalAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getOutcomeBalancesAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCalculations.sol',
			},
			{
				name: 'getDepositsByOutcome',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
			},
			{
				name: 'getDepositsByOutcomeLength',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
			},
			{
				name: 'forkCarrySnapshotInitialized',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getOutcomeState',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getForkCarrySnapshot',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getForkCarryRoots',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'isForkCarryFundingComplete',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getCarryLeafPageByOutcome',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getProofConsumedCarriedDepositIndexesByOutcome',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
			},
			{
				name: 'getLocalUnresolvedPrincipalByVaultAndOutcome',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameEscrow.sol',
			},
			{
				name: 'getFinalQuestionResolution',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
			},
		],
		readStorageDeclarations: [
			{
				name: 'securityPool',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
			},
			{
				name: 'repToken',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameState.sol',
			},
			{
				name: 'activationTime',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'nonDecisionThresholdAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'startBondAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'nonDecisionTimestamp',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'nonDecisionState',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'forkContinuation',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'forkElapsedAtStart',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'forkCarrySnapshotOutcomesInitialized',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'forkResumedAt',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'nodes',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'totalDisputeStakedAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'fixedQuestionOutcome',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'ordinarySettlementInitialized',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'ordinaryWinningReserveAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'creditedSurplusAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'settlementForkThresholdAttoRep',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
			{
				name: 'winnerHaircutPaidByFork',
				sourcePath: 'solidity/contracts/statoblast/EscalationGameStorage.sol',
			},
		],
		sourcePath: 'solidity/contracts/statoblast/EscalationGame.sol',
		interactions: [
			{
				call: '`start(startBondAttoRep, nonDecisionThresholdAttoRep)`',
				caller: 'Immutable owner, the `EscalationGameFactory`, only (`Only owner`), during atomic deployment',
				effect: 'Initializes a local game and sets activation three days after deployment. For ordinary pool games, the factory lowers an oversized configured bond to `nonDecisionThresholdAttoRep - 1` before this call.',
				declarations: [
					{
						name: 'start',
					},
				],
				preconditions: 'Game not already started, and `nonDecisionThresholdAttoRep > startBondAttoRep > 0` (`Invalid game start`).',
				signals: '`GameStarted`',
			},
			{
				call: '`startFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome, winnerHaircutPaidByFork, forkCarryInitialBackingAttoRep)`',
				caller: 'Immutable owner, the `EscalationGameFactory`, only (`Only owner`), during atomic continuation deployment',
				effect: 'Initializes a paused continuation with inherited elapsed time, an optional fixed matching child outcome, and immutable fork-time escalation-haircut and backing accounting. It does not start the remaining clock until `resumeFromFork`.',
				declarations: [
					{
						name: 'startFromFork',
					},
				],
				preconditions: 'Game not already started, and `nonDecisionThresholdAttoRep > startBondAttoRep > 0` (`Invalid game start`); `elapsedAtFork` is a signed number of seconds between minus three days and seven weeks, inclusive (`Invalid fork elapsed time`).',
				signals: '`GameContinuedFromFork`',
			},
			{
				call: '`resumeFromFork()`',
				caller: 'Owning `SecurityPool` only (`Only pool`)',
				effect:
					'Resumes once carry funding is complete. Standalone continuations use the transaction timestamp and deadline `max(rebasedCurveEnd, forkResumedAt + 3 days)`. Bound continuations use the fixed portfolio response anchor; when their outcome is fixed, the deadline is exactly anchor plus three days, otherwise inherited attrition and the minimum response interval apply. Late materialization never moves the anchor. If the game is final and its universe has already forked again, resuming records the non-decision threshold as its settlement threshold so later migration cannot reduce payouts. Final resolution also checks whether the native universe forked before that deadline.',
				declarations: [
					{
						name: 'resumeFromFork',
					},
				],
				preconditions:
					'Fork-continuation mode; not previously resumed; aggregate REP funding complete (`isForkCarryFundingComplete`). All three carry outcomes must be initialized (`Fork snapshot incomplete`), even for empty history. When the canonical factory records nonzero initial backing, the live reporter balance must cover that actual escrow after source surplus and native fork burn. Without recorded initial backing, it must cover effective inherited unresolved principal plus local unresolved principal across all three outcomes.',
				signals: '`ForkContinuationResumed`',
			},
			{
				call: '`depositRepOnOutcome(outcome, maximumDepositAttoRep)`',
				caller: 'Any REP holder',
				effect: 'Transfers accepted REP from the caller into dispute escrow and appends its nominal deposit and carry leaf, without minting reporter backing units. Ordinary games release increases in the minimum outcome balance to vested portfolio REP income. Continuations do not release this ordinary surplus.',
				declarations: [
					{
						name: 'depositRepOnOutcome',
					},
				],
				preconditions:
					'Current game is ordinary or a resumed portfolio continuation without a fixed outcome; provisional resolution `None` or a resumed continuation\u2019s fixed response period open; pool operational; universe unforked; outcome non-`None`; caller allowance to this game covers the accepted REP; the requested amount is at least the start bond, and preview accepts a positive amount within the remaining threshold room, which may be one attoREP short to avoid a tie or below the start bond when it fills the threshold (`Invalid deposit preview`).',
				signals: 'REP `Transfer`, `LocalDepositAppended`, `DepositOnOutcome`, `EscalationSurplusAccrued` when the ordinary minimum increases, and `NonDecisionReached` when the deposit reaches non-decision',
			},
			{
				call: '`depositRepOnOutcomeWithLead(outcome, maximumDepositAttoRep)` fallback routing rule',
				caller: 'Any wallet depositor',
				effect: 'Performs the ordinary deposit atomically, reverting unless the resulting outcome is the strict stake leader or fills its non-decision threshold. An intervening opposing top-up cannot turn a protected reply into trailing stake.',
				declarations: [{ kind: 'fallback-routed', name: 'depositRepOnOutcomeWithLead', sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol' }],
				preconditions: 'Ordinary deposit prerequisites, plus the lead or threshold condition (`Deposit does not lead`).',
				signals: 'Ordinary deposit signals; none survive a failed lead condition.',
			},
			{
				call: '`depositRepOnOutcomeWithPermitAndLead(outcome, maximumDepositAttoRep, deadline, v, r, s)` through `fallback()`',
				caller: 'Any child-universe REP holder',
				effect: 'Performs the permit-funded deposit with the same atomic lead or threshold condition as `depositRepOnOutcomeWithLead`.',
				declarations: [{ kind: 'fallback-routed', name: 'depositRepOnOutcomeWithPermitAndLead', sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol' }],
				preconditions: 'Permit-funded deposit prerequisites and the lead or threshold condition. A failed condition rolls back the permit nonce, allowance, transfer and deposit.',
				signals: 'Permit-funded deposit signals; none survive a failed lead condition.',
			},
			{
				call: '`depositRepOnOutcomeWithLead(outcome, maximumDepositAttoRep)`',
				caller: 'Any REP holder',
				effect: 'Performs the ordinary wallet deposit only when its result leads or reaches the non-decision threshold. A reordered reply that would become trailing support reverts without spending REP.',
				declarations: [{ name: 'depositRepOnOutcomeWithLead' }],
				preconditions: 'The ordinary direct-deposit prerequisites. The resulting outcome balance exceeds every competing balance or equals the non-decision threshold (`Deposit does not lead`). `previewLeadingDepositOnOutcome` quotes this bound.',
				signals: 'The ordinary `depositRepOnOutcome` signals.',
			},
			{
				call: '`depositRepOnOutcomeWithAuthorizationAndLead(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s)`',
				caller: "Anyone relaying the owner's ERC-3009 signature",
				effect: 'Pulls and records the owner’s previewed REP only when its outcome leads or completes the non-decision threshold. The authorization is bound to this guarded selector and cannot be submitted through the unguarded authorization method.',
				declarations: [{ name: 'depositRepOnOutcomeWithAuthorizationAndLead' }],
				preconditions: 'The `depositRepOnOutcomeWithLead` and child-universe authorization prerequisites. Compute the operation hash and token nonce as for the unguarded authorization method, substituting `depositRepOnOutcomeWithAuthorizationAndLead.selector`.',
				signals: 'REP `AuthorizationUsed` and the ordinary deposit signals.',
			},
			{
				call: '`depositRepOnOutcomeWithAuthorizationAndLead(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s)` fallback routing rule',
				caller: "Anyone relaying the owner's ERC-3009 signature",
				effect: 'Pulls and records the owner’s previewed REP only when its outcome leads or completes the non-decision threshold. The authorization is bound to this guarded selector and cannot be submitted through the unguarded authorization method.',
				declarations: [{ kind: 'fallback-routed', name: 'depositRepOnOutcomeWithAuthorizationAndLead', sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol' }],
				preconditions: 'The `depositRepOnOutcomeWithLead` and child-universe authorization prerequisites. Compute the operation hash and token nonce as for the unguarded authorization method, substituting `depositRepOnOutcomeWithAuthorizationAndLead.selector`.',
				signals: 'REP `AuthorizationUsed` and the ordinary deposit signals.',
			},
			{
				call: '`depositRepOnOutcomeWithPermit(outcome, maximumDepositAttoRep, deadline, v, r, s)` through `fallback()`',
				caller: 'Any child-universe REP holder',
				effect: 'Calls the REP token `permit` for the previewed amount from the caller to this game, ignores a failed permit when the existing allowance already covers that amount, then performs the `depositRepOnOutcome` deposit.',
				declarations: [
					{
						kind: 'fallback-routed',
						name: 'depositRepOnOutcomeWithPermit',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol',
					},
				],
				preconditions: 'The `depositRepOnOutcome` game, pool, and preview prerequisites; the pool universe is not genesis (`Genesis REP does not support permit`); the permit succeeds or the caller allowance to this game covers the previewed amount (`Game permit and allowance insufficient`).',
				signals: 'REP `Approval` when the permit succeeds, then the `depositRepOnOutcome` signals',
			},
			{
				call: '`depositRepOnOutcomeWithAuthorization(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s)` through `fallback()`',
				caller: "Anyone relaying the owner's ERC-3009 signature",
				effect: 'Pulls the previewed amount from `owner` to this game through the REP token `receiveWithAuthorization` and records the deposit for `owner`.',
				declarations: [
					{
						kind: 'fallback-routed',
						name: 'depositRepOnOutcomeWithAuthorization',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameDepositDelegate.sol',
					},
				],
				preconditions:
					'The `depositRepOnOutcome` game, pool, and preview prerequisites; the pool universe is not genesis (`Genesis REP does not support authorization`); the signature authorizes the token nonce `keccak256(abi.encode(nonce, operationHash, owner))`, where `operationHash` is `keccak256(abi.encode(depositRepOnOutcomeWithAuthorization.selector, owner, securityPool, universeId, questionId, outcome, maximumDepositAttoRep, previewedAmount))`.',
				signals: 'REP `AuthorizationUsed` and `Transfer`, `LocalDepositAppended`, `DepositOnOutcome`, `EscalationSurplusAccrued` when the ordinary minimum increases, and `NonDecisionReached` when the deposit reaches non-decision',
			},
			{
				call: '`depositRepOnOutcomeWithAuthorizationAndLead(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s)`',
				caller: "Anyone relaying the owner's ERC-3009 signature",
				effect: 'Pulls and records the owner’s previewed REP only when its outcome leads or completes the non-decision threshold. The authorization is bound to this guarded selector and cannot be submitted through the unguarded authorization method.',
				declarations: [{ name: 'depositRepOnOutcomeWithAuthorizationAndLead' }],
				preconditions: 'The `depositRepOnOutcomeWithLead` and child-universe authorization prerequisites. Compute the operation hash and token nonce as for the unguarded authorization method, substituting `depositRepOnOutcomeWithAuthorizationAndLead.selector`.',
				signals: 'REP `AuthorizationUsed` and the ordinary deposit signals.',
			},
			{
				call: '`recordDepositFromSecurityPool(depositor, outcome, amountAttoRep, expectedCumulativeAttoRep)`',
				caller: 'Owning `SecurityPool` only (`Only pool`)',
				effect:
					'Appends the nominal deposit and carry leaf. In ordinary games, it releases any increase in the minimum outcome balance through the same portfolio-income path as `depositRepOnOutcome`; only the new report\u2019s retained contribution receives collateral credit. Continuations release no ordinary surplus.',
				declarations: [
					{
						name: 'recordDepositFromSecurityPool',
					},
				],
				preconditions: 'Explicit non-decision state is `None`; provisional resolution `None` or a resumed continuation\u2019s fixed response period open (`Question resolved`); valid outcome; preview and accepted cumulative amount match; room remains below threshold.',
				signals: '`LocalDepositAppended`, `DepositOnOutcome`, `EscalationSurplusAccrued` when the ordinary minimum increases, and `NonDecisionReached` when the deposit reaches non-decision',
			},
			{
				call: '`withdrawDeposit(depositIndex, outcome)`, the `uint256` overload',
				caller: 'Owning `SecurityPool` only (`Only pool`)',
				declarations: [
					{
						name: 'withdrawDeposit',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
					},
				],
				effect:
					'Settles one local deposit after resolution. An ordinary first claim freezes the winning liability and burns terminal excess beyond the surplus already paid at source; ordinary losers retire together and a valid losing index returns zero repeatedly. A winner consumes its reserved payout and burn and pays the immutable depositor. Continuation losers still consume their individual escrow.',
				preconditions: 'Explicit non-decision state is `None`; non-`None` supplied outcome; game final; game and pool final outcomes match; valid local deposit index, unsettled unless it is a retired ordinary loser.',
				signals: '`OrdinarySettlementInitialized` on first ordinary settlement. Winners and continuation losers emit `CarryDepositConsumed` and `VaultEscrowUpdated`; winners also emit `ClaimDeposit` and positive payout or burn signals. Retired ordinary losers emit no per-deposit settlement event.',
			},
			{
				call: '`initializeForkCarryOutcome(sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep, nullifierRoot)`',
				caller: 'Owning `SecurityPool` only',
				declarations: [
					{
						name: 'initializeForkCarryOutcome',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameCarry.sol',
					},
				],
				effect:
					'Installs one outcome\u2019s inherited peaks, leaf count, carry total, resolution balance, and normalized nullifier root. The nonzero full snapshot identity and source are fixed on the first call. The third call verifies the installed data against that identity before marking the snapshot complete. Two or more threshold-full inherited balances then set `nonDecisionState` to `InheritedThresholdTie` without creating a local timestamp.',
				preconditions: 'Fork-continuation mode; fewer than three initialized outcomes; each leaf count fits the MMR; every call supplies the same source and nonzero snapshot ID, with the next outcome\u2019s data. The third call requires the hash of all normalized data to match that ID.',
				signals: '`ForkCarryCheckpoint` after all three outcomes; additionally `InheritedThresholdTie` when the completed balances meet the non-decision threshold',
			},
			{
				call: '`processClaimCheckpoint(outcomeIndex, amountAttoRep, cumulativeAmountAttoRep, leafIndex, maxSteps, baseCommitment, transforms)` through `fallback()`',
				caller: 'Anyone',
				declarations: [
					{
						name: 'processClaimCheckpoint',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
					},
				],
				effect:
					'An empty transform array with a zero base commitment discovers at most eight frozen ancestor transforms per call and commits them to a hash stack. A completed canonical ancestor checkpoint for the same claim tuple replaces its already-prepared prefix; the excluded source transform is still processed. After discovery, a batch supplies one base commitment and at most eight transforms in forward hash order. The complete batch must hash to the pending commitment before those transforms apply in reverse order, preserving every generation\u2019s integer rounding. Each transform contains `repBeforeAttoRep`, `repRemainingAttoRep`, and `consumedBeforeAttoRep`. Recovery anchors store a source and prior hash for each eight-transform segment. Every unfinished call checks the immediate parent\u2019s completed cache; if available, it replaces even partially applied preparation with that prefix plus its one frozen excluded-source transform. Otherwise initialization reads the immediate source. The target and immediate parent remain live reads. Preparation does not consume a proof or move REP; completed calls are idempotent.',
				preconditions:
					'Complete fork snapshot when applicable; valid outcome and interval; `maxSteps` from 1 to 8 and no more transforms than that budget (`Invalid checkpoint budget`). An empty transform array requires a zero base commitment (`Invalid checkpoint base`). Discovery requires empty transforms (`Checkpoint discovery pending`) and each committed source game to belong to a forked universe and have no final resolution (`Claim source still mutable`). Applying queued transforms requires a nonempty batch no longer than the pending step count (`Checkpoint transforms required`), whose forward hash matches the pending commitment bound to this game and claim tuple (`Invalid checkpoint batch`); invalid or stale batches revert atomically. Completed calls and successful parent-cache adoption do not apply supplied transforms. Claims still require authenticated membership and an unspent nullifier.',
				signals: '`ClaimCheckpointProgress`; returns whether the stored checkpoint is complete. Read `getClaimCheckpointProgress` for readiness and remaining traversal state',
			},
			{
				call: '`initializeForkClaimCheckpoint(sourceGame)` through `fallback()`',
				caller: 'Owning `SecurityPool` only (`Only pool`)',
				declarations: [
					{
						name: 'initializeForkClaimCheckpoint',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameClaimDelegate.sol',
					},
				],
				effect: 'Records the root claim source game: the value `sourceGame` reports from `rootClaimSourceGame()`, or `sourceGame` itself when that value is zero. The game runs the same step internally while installing a carry snapshot with a nonzero source game, and no pool function calls this selector.',
				preconditions: '`sourceGame` equals the source game recorded by the installed carry snapshot (`Claim source`).',
				signals: 'No event',
			},
			{
				call: '`claimDepositForWinning(depositIndex, outcome)`',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [
					{
						name: 'claimDepositForWinning',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
					},
				],
				effect: "Consumes a selected local deposit as a winner, consumes its vault escrow, burns the computed escalation haircut when nonzero, and transfers the remaining positive REP payout to the deposit's immutable depositor.",
				preconditions: 'Non-`None` supplied outcome and valid unsettled local deposit with sufficient escrow. An ordinary non-fork game requires final settlement and the actual winning outcome. Other paths rely on the trusted caller to select the winner.',
				signals: '`CarryDepositConsumed`, `VaultEscrowUpdated`, `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and escalation-haircut burn signals only when their amounts are positive',
			},
			{
				call: '`withdrawDeposit(proof, outcome)`, the `CarriedDepositProof` overload',
				caller: 'Owning `SecurityPool` or its `SecurityPoolForker`',
				declarations: [
					{
						name: 'withdrawDeposit',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
					},
				],
				effect: 'Consumes an inherited proof, transfers any positive winning payout, and burns the positive escalation haircut unless the fork already paid it.',
				preconditions: 'Non-`None` supplied outcome; game final and matching the pool final outcome; supplied outcome is the winner; parent deposit was not directly claimed; valid unconsumed Merkle/nullifier proof.',
				signals: '`CarryDepositConsumed` and `ClaimDeposit` with `transferredRep = true`; REP payout `Transfer` and escalation-haircut burn signals only when positive',
			},
			{
				call: '`settleOrdinaryGame()`',
				caller: 'Anyone',
				declarations: [
					{
						name: 'settleOrdinaryGame',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
					},
				],
				effect:
					'Freezes the final outcome, reserves the cumulative winning payout and burn liability at the recorded `settlementForkThresholdAttoRep`, and retires all losing local escrow without visiting deposits. Each later winning claim subtracts its payout and burn from that reserve. Burns terminal REP above the reserve; the ordinary minimum-outcome surplus was already paid irrevocably as deposits arrived. A repeated call with no surplus succeeds. See [reporter liability invariant](./invariants.html#escalation).',
				preconditions: 'Ordinary game, not a fork continuation, with `nonDecisionState = None` and a final outcome. Game REP must cover the initial winner reserve (`Winner reserve underfunded`).',
				signals: '`OrdinarySettlementInitialized` once; `OrdinaryResidualRepBurned` and REP `Transfer` only when surplus is positive',
			},
			{
				call: '`sweepResidualRepToSecurityPool()`',
				caller: 'Anyone',
				effect: 'Applies ordinary winner-reserve settlement and burns its terminal excess. Also burns fork-continuation residual so pre-child capital cannot accrue to late or nonexistent child owners.',
				declarations: [
					{
						name: 'sweepResidualRepToSecurityPool',
						sourcePath: 'solidity/contracts/statoblast/EscalationGameSettlement.sol',
					},
				],
				preconditions:
					'Final outcome and positive releasable surplus (`No sweepable REP` for an ordinary no-op). Ordinary settlement preserves all unclaimed winning liabilities. Continuations require no effective unresolved principal and, after retiring inherited aggregate escrow, no remaining local stake or vault escrow.',
				signals: '`OrdinarySettlementInitialized` if first ordinary settlement, then `OrdinaryResidualRepBurned`; `ForkContinuationResidualRepBurned` for a fork continuation',
			},
		],
	},
]
