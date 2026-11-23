// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { DelegateCall } from './DelegateCall.sol';
import { EscalationGameRepCustody } from './EscalationGameRepCustody.sol';
import { ISecurityPoolReporterPortfolio } from './interfaces/ISecurityPoolReporterLedger.sol';
import { SystemState } from './interfaces/IQuestionLedger.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import {
	IEscalationGameDepositContext,
	IEscalationGameQuestionLedgerContext
} from './interfaces/IEscalationGameDelegateContexts.sol';
import { IZoltarForkState } from './interfaces/IZoltarForkState.sol';
import { Zoltar } from '../Zoltar.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { IERC20PermitAuthorization, IERC3009Authorization } from '../vendor/authorization/IERC20Authorization.sol';
import {
	Deposit,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	Node,
	NonDecisionState,
	OutcomeState
} from './EscalationGameTypes.sol';

contract EscalationGameDepositDelegate is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;

	event ForkContinuationResumed(uint256 resumedAt);
	event OrdinarySettlementInitialized(BinaryOutcomes.BinaryOutcome indexed outcome, uint256 winningPrincipalAttoRep, uint256 reservedAttoRep);

	/// @dev Reachable through the game's internal delegate dispatch, not its public fallback.
	function transferReporterRep(address recipient, uint256 amountAttoRep) external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		EscalationGameRepCustody.transfer(game.questionLedger(), game.repToken(), recipient, amountAttoRep);
	}

	function settleOrdinaryGame(EscalationGameProofVerifier verifier, bool releaseSurplus) external returns (uint256) {
		require(!forkContinuation && nonDecisionState == NonDecisionState.None, 'Not ordinary settlement');
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		if (!ordinarySettlementInitialized) {
			BinaryOutcomes.BinaryOutcome outcome = game.getFinalQuestionResolution();
			require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
			uint256 winningPrincipal = outcomeState[uint8(outcome)].balanceAttoRep;
			(uint256 payout, uint256 burn) = verifier.computeOrdinaryWinningWithdrawal(winningPrincipal, winningPrincipal, game.getBindingCapitalAttoRep(), winningPrincipal, settlementForkThresholdAttoRep, nonDecisionThresholdAttoRep);
			ordinaryWinningReserveAttoRep = payout + burn;
			require(EscalationGameRepCustody.balance(game.questionLedger(), game.repToken()) >= ordinaryWinningReserveAttoRep, 'Winner reserve underfunded');
			ordinarySettlementOutcome = outcome;
			ordinarySettlementInitialized = true;
			totalDisputeStakedAttoRep = winningPrincipal;
			totalLocalUnresolvedAttoRep = winningPrincipal;
			emit OrdinarySettlementInitialized(outcome, winningPrincipal, ordinaryWinningReserveAttoRep);
		}
		if (!releaseSurplus) return 0;
		uint256 amount =
			EscalationGameRepCustody.balance(game.questionLedger(), game.repToken()) - ordinaryWinningReserveAttoRep;
		if (amount == 0) return 0;
		EscalationGameRepCustody.transfer(game.questionLedger(), game.repToken(), game.questionLedger(), amount);
		IEscalationGameQuestionLedgerContext(game.questionLedger()).burnEscalationWinnerHaircut(amount);
		emit OrdinaryResidualRepBurned(amount);
		return amount;
	}

	/// @notice Pool-only delegate target: install exactly one outcome from a bound fork snapshot.
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep, bytes32 nullifierRoot, EscalationGameProofVerifier proofVerifier, bytes32 emptyNullifierRoot) external {
		require(msg.sender == IEscalationGameDepositContext(address(this)).questionLedger(), 'Only pool');
		require(forkContinuation, 'No fork mode');
		uint8 outcomeIndex = forkCarrySnapshotOutcomesInitialized;
		require(outcomeIndex < 3, 'Snapshot initialized');
		require(leafCount < (uint256(1) << MERKLE_MOUNTAIN_RANGE_MAX_PEAKS), 'Leaf count high');
		if (outcomeIndex == 0) {
			require(snapshotId != bytes32(0), 'Snapshot id missing');
			forkCarrySnapshotId = snapshotId;
			forkCarrySourceGame = sourceGame;
		} else {
			require(forkCarrySnapshotId == snapshotId && forkCarrySourceGame == sourceGame, 'Snapshot changed');
		}
		OutcomeState storage state = outcomeState[outcomeIndex];
		state.currentNullifierRoot = nullifierRoot == bytes32(0) ? emptyNullifierRoot : nullifierRoot;
		state.snapshotLeafCount = leafCount;
		state.snapshotCarryRoot = proofVerifier.bagCarryPeaks(peaks, leafCount);
		state.currentLeafCount = leafCount;
		uint256 peakStartIndex;
		for (uint256 height = MERKLE_MOUNTAIN_RANGE_MAX_PEAKS; height > 0; ) {
			unchecked {
				--height;
			}
			state.currentPeaks[height] = peaks[height];
			if (((leafCount >> height) & 1) == 0) continue;
			state.currentCarryNodeHashes[height][peakStartIndex] = peaks[height];
			peakStartIndex += uint256(1) << height;
		}
		state.balanceAttoRep = resolutionBalanceAttoRep;
		state.inheritedUnresolvedTotalAttoRep = carryTotalAttoRep;
		if (outcomeIndex != 2) {
			forkCarrySnapshotOutcomesInitialized = outcomeIndex + 1;
			return;
		}
		_finalizeForkCarrySnapshot(sourceGame, snapshotId, proofVerifier);
	}

	function _finalizeForkCarrySnapshot(address sourceGame, bytes32 snapshotId, EscalationGameProofVerifier proofVerifier) private {
		bytes32[3] memory carryRoots;
		bytes32[3] memory nullifierRoots;
		uint256[3] memory leafCounts;
		uint256[3] memory carryTotals;
		uint256[3] memory balances;
		uint256 totalCarryAttoRep;
		for (uint8 index = 0; index < 3; index++) {
			OutcomeState storage state = outcomeState[index];
			leafCounts[index] = state.snapshotLeafCount;
			carryRoots[index] = state.snapshotCarryRoot;
			nullifierRoots[index] = state.currentNullifierRoot;
			carryTotals[index] = state.inheritedUnresolvedTotalAttoRep;
			balances[index] = state.balanceAttoRep;
			totalCarryAttoRep += carryTotals[index];
		}
		require(snapshotId == keccak256(abi.encode(sourceGame, carryRoots, nullifierRoots, leafCounts, carryTotals, balances)), 'Snapshot id mismatch');
		if (totalDisputeStakedAttoRep == 0) {
			forkCarryDisputeStakedAttoRep = forkCarryInitialBackingAttoRep;
			totalDisputeStakedAttoRep = forkCarryInitialBackingAttoRep;
		}
		forkCarrySnapshotRequiresForkedEscrow = totalCarryAttoRep > 0;
		if (proofVerifier.hasReachedNonDecision(balances, nonDecisionThresholdAttoRep))
			nonDecisionState = NonDecisionState.InheritedThresholdTie;
		forkCarrySnapshotOutcomesInitialized = 3;
		emit ForkCarryCheckpoint(sourceGame, snapshotId, carryRoots, nullifierRoots, leafCounts, carryTotals, balances);
		if (nonDecisionState == NonDecisionState.InheritedThresholdTie) emit InheritedThresholdTie(sourceGame);
	}

	/// @notice Game delegatecall target: records a pool-funded deposit for `depositor` on `outcome` and returns its parent deposit index.
	function recordDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, uint256 expectedCumulativeRepAmountAttoRep) external returns (uint256 parentDepositIndex) {
		return _recordDeposit(depositor, outcome, amountAttoRep, expectedCumulativeRepAmountAttoRep);
	}

	/// @notice Game delegatecall target: transfers the caller's previewed REP deposit on `outcome` into the game and records it.
	function depositRepOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_depositRepOnOutcome(outcome, maximumDepositAttoRep, false);
	}

	function depositRepOnOutcomeWithLead(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_depositRepOnOutcome(outcome, maximumDepositAttoRep, true);
	}

	/// @notice Game delegatecall target: like `depositRepOnOutcome`, after a permit, falling back to an existing allowance.
	function depositRepOnOutcomeWithPermit(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		_validateGameForDeposit(game);
		IEscalationGameQuestionLedgerContext pool = IEscalationGameQuestionLedgerContext(game.questionLedger());
		require(pool.universeId() != 0, 'Genesis REP does not support permit');
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = game.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
		address token = game.repToken();
		try
			IERC20PermitAuthorization(token).permit(msg.sender, address(this), depositedAttoRep, deadline, v, r, s)
		{} catch {
			require(IERC20(token).allowance(msg.sender, address(this)) >= depositedAttoRep, 'Game permit and allowance insufficient');
		}
		IERC20(token).safeTransferFrom(msg.sender, address(this), depositedAttoRep);
		_recordDeposit(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
	}

	function depositRepOnOutcomeWithPermitAndLead(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
		depositRepOnOutcomeWithPermit(outcome, maximumDepositAttoRep, deadline, v, r, s);
		require(_strictStakeLeader() == outcome || outcomeState[uint256(outcome)].balanceAttoRep == nonDecisionThresholdAttoRep, 'Deposit does not take the lead');
	}

	/// @notice Game delegatecall target: pulls `owner`'s previewed deposit through an ERC-3009 authorization bound to this operation and records it.
	function depositRepOnOutcomeWithAuthorization(address owner, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		_depositAuthorized(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s, false);
	}

	function depositRepOnOutcomeWithAuthorizationAndLead(address owner, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		_depositAuthorized(owner, outcome, maximumDepositAttoRep, validAfter, validBefore, nonce, v, r, s, true);
	}

	function _depositAuthorized(address owner, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s, bool requireLead) private {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		_validateGameForDeposit(game);
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = _previewDeposit(game, outcome, maximumDepositAttoRep, requireLead);
		IEscalationGameQuestionLedgerContext pool = IEscalationGameQuestionLedgerContext(game.questionLedger());
		require(pool.universeId() != 0, 'Genesis REP does not support authorization');
		bytes32 operationHash = keccak256(abi.encode((requireLead ? this.depositRepOnOutcomeWithAuthorizationAndLead.selector : this.depositRepOnOutcomeWithAuthorization.selector), owner, game.questionLedger(), pool.universeId(), pool.questionId(), outcome, maximumDepositAttoRep, depositedAttoRep));
		IERC3009Authorization(game.repToken()).receiveWithAuthorization(owner, address(this), depositedAttoRep, validAfter, validBefore, keccak256(abi.encode(nonce, operationHash, owner)), v, r, s);
		_recordDeposit(owner, outcome, depositedAttoRep, resultingCumulativeAttoRep);
	}

	function _depositRepOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, bool requireLead) private {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		_validateGameForDeposit(game);
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = _previewDeposit(game, outcome, maximumDepositAttoRep, requireLead);
		IERC20(game.repToken()).safeTransferFrom(msg.sender, address(this), depositedAttoRep);
		_recordDeposit(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
	}

	function _previewDeposit(IEscalationGameDepositContext game, BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, bool requireLead) private view returns (uint256 accepted, uint256 cumulative) {
		return
			requireLead
				? game.previewLeadingDepositOnOutcome(outcome, maximumDepositAttoRep)
				: game.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
	}

	function _validateGameForDeposit(IEscalationGameDepositContext game) private view {
		address poolAddress = game.questionLedger();
		require(!forkContinuation || (EscalationGameRepCustody.portfolio(poolAddress) != address(0) && forkResumedAt != 0 && fixedQuestionOutcome == BinaryOutcomes.BinaryOutcome.None), 'Fork game');
		IEscalationGameQuestionLedgerContext pool = IEscalationGameQuestionLedgerContext(poolAddress);
		require(pool.escalationGame() == address(this), 'Game inactive');
		require(pool.systemState() == SystemState.Operational, 'Pool inactive');
		require(IZoltarForkState(pool.zoltar()).getForkTime(pool.universeId()) == 0, 'Forked');
	}

	function _recordDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, uint256 expectedCumulativeRepAmountAttoRep) private returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		_validateAcceptedDeposit(outcome, outcomeIndex, outcomeState[outcomeIndex].balanceAttoRep, amountAttoRep, expectedCumulativeRepAmountAttoRep);
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		EscalationGameRepCustody.receiveDeposit(game.questionLedger(), game.repToken(), amountAttoRep);
		parentDepositIndex = _appendDeposit(depositor, outcome, amountAttoRep, expectedCumulativeRepAmountAttoRep);
		// Every accepted deposit records the threshold settlement scales by.
		address poolAddress = game.questionLedger();
		_recordSettlementForkThreshold(poolAddress);
		_scheduleReporterFinality();
		IEscalationGameQuestionLedgerContext(poolAddress).refreshPortfolioFees();
	}

	function _appendDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep, uint256 expectedCumulativeRepAmountAttoRep) private returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		selectedOutcomeState.balanceAttoRep = expectedCumulativeRepAmountAttoRep;
		_increaseEscrowedRepForBundle(depositor, amountAttoRep);
		vaultAccounting[depositor].unresolvedAttoRep += amountAttoRep;
		totalLocalUnresolvedAttoRep += amountAttoRep;
		vaultAccounting[depositor].localUnresolvedPrincipalByOutcome[outcomeIndex] += amountAttoRep;

		uint256 depositIndex = selectedOutcomeState.localNodeIds.length;
		parentDepositIndex = depositIndex;
		if (forkContinuation) {
			require(depositIndex < (uint256(1) << 88), 'Deposit index high');
			parentDepositIndex = (uint256(uint160(address(this))) << 96) | (uint256(outcomeIndex) << 88) | depositIndex;
		}
		uint256 nodeId = nextNodeId;
		nextNodeId += 1;
		Node storage node = nodes[nodeId];
		node.parentNodeId = selectedOutcomeState.localHeadNodeId;
		node.depositor = depositor;
		node.outcome = outcome;
		node.amountAttoRep = amountAttoRep;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmountAttoRep = expectedCumulativeRepAmountAttoRep;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotalAttoRep += amountAttoRep;
		_appendCarryLeaf(selectedOutcomeState, nodeId);

		emit LocalDepositAppended(nodeId, outcome, depositor, amountAttoRep, parentDepositIndex, expectedCumulativeRepAmountAttoRep);
		emit DepositOnOutcome(depositor, outcome, amountAttoRep, depositIndex, expectedCumulativeRepAmountAttoRep, _claimEscrowedRepByVault(depositor), totalDisputeStakedAttoRep);
		if (IEscalationGameDepositContext(address(this)).hasReachedNonDecision()) {
			nonDecisionState = NonDecisionState.Local;
			nonDecisionTimestamp = block.timestamp;
			emit NonDecisionReached(nonDecisionTimestamp);
		}
		_accrueOrdinarySurplus();
	}

	function _accrueOrdinarySurplus() private {
		if (forkContinuation) return;
		uint256 minimumBalance = outcomeState[0].balanceAttoRep;
		if (outcomeState[1].balanceAttoRep < minimumBalance) minimumBalance = outcomeState[1].balanceAttoRep;
		if (outcomeState[2].balanceAttoRep < minimumBalance) minimumBalance = outcomeState[2].balanceAttoRep;
		uint256 amount = minimumBalance - creditedSurplusAttoRep;
		if (amount == 0) return;
		creditedSurplusAttoRep = minimumBalance;
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		EscalationGameRepCustody.transfer(game.questionLedger(), game.repToken(), game.questionLedger(), amount);
		IEscalationGameQuestionLedgerContext(game.questionLedger()).creditEscalationSurplus(amount);
		emit EscalationSurplusAccrued(amount, minimumBalance);
	}

	function _validateAcceptedDeposit(BinaryOutcomes.BinaryOutcome outcome, uint8 outcomeIndex, uint256 currentBalanceAttoRep, uint256 amountAttoRep, uint256 expectedCumulativeRepAmountAttoRep) private view {
		require(!forkContinuation || forkCarrySnapshotOutcomesInitialized == 3, 'Fork snapshot incomplete');
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(_isDepositResolutionOpen(IEscalationGameDepositContext(address(this)).getQuestionResolution()), 'Question resolved');
		require(currentBalanceAttoRep < nonDecisionThresholdAttoRep, 'Outcome full');
		require(amountAttoRep > 0, 'Deposit zero');
		require(expectedCumulativeRepAmountAttoRep == currentBalanceAttoRep + amountAttoRep, 'Preview mismatch');
		require(expectedCumulativeRepAmountAttoRep <= nonDecisionThresholdAttoRep, 'Deposit exceeds room');
		uint256 maxBalance = outcomeState[0].balanceAttoRep;
		if (outcomeState[1].balanceAttoRep > maxBalance) maxBalance = outcomeState[1].balanceAttoRep;
		if (outcomeState[2].balanceAttoRep > maxBalance) maxBalance = outcomeState[2].balanceAttoRep;
		// A start-bond report that would tie the leader is trimmed by one attoREP.
		require(amountAttoRep >= startBondAttoRep || expectedCumulativeRepAmountAttoRep == nonDecisionThresholdAttoRep || (amountAttoRep + 1 == startBondAttoRep && expectedCumulativeRepAmountAttoRep + 1 == maxBalance && maxBalance < nonDecisionThresholdAttoRep), 'Below start bond');
		if (expectedCumulativeRepAmountAttoRep != maxBalance || maxBalance >= nonDecisionThresholdAttoRep) return;
		for (uint8 otherOutcomeIndex = 0; otherOutcomeIndex < 3; otherOutcomeIndex++) {
			if (otherOutcomeIndex != outcomeIndex && outcomeState[otherOutcomeIndex].balanceAttoRep == maxBalance) {
				revert('Preview mismatch');
			}
		}
	}

	/// @dev A final continuation can materialize after its universe forked again.
	/// Migration after finality must not scale down its already-earned claims.
	function _recordSettlementForkThreshold(address poolAddress) private {
		IEscalationGameQuestionLedgerContext pool = IEscalationGameQuestionLedgerContext(poolAddress);
		Zoltar registry = Zoltar(pool.zoltar());
		settlementForkThresholdAttoRep =
			registry.getForkTime(pool.universeId()) != 0
				? nonDecisionThresholdAttoRep
				: registry.getForkThresholdAttoRep(pool.universeId());
	}

	function _appendCarryLeaf(OutcomeState storage state, uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(node.depositor, node.outcome, node.amountAttoRep, node.parentDepositIndex, node.cumulativeAmountAttoRep, nodeId);
		uint256 leafCount = state.currentLeafCount;
		uint256 peakHeight;
		uint256 carryStartIndex = leafCount;
		state.currentCarryNodeHashes[0][carryStartIndex] = carryHash;
		while (((leafCount >> peakHeight) & 1) == 1) {
			uint256 siblingStartIndex = carryStartIndex - (uint256(1) << peakHeight);
			carryHash = MerkleMountainRange.hashParent(state.currentPeaks[peakHeight], carryHash);
			delete state.currentPeaks[peakHeight];
			peakHeight += 1;
			carryStartIndex = siblingStartIndex;
			state.currentCarryNodeHashes[peakHeight][carryStartIndex] = carryHash;
		}
		require(peakHeight < MERKLE_MOUNTAIN_RANGE_MAX_PEAKS, 'MMR too tall');
		state.currentPeaks[peakHeight] = carryHash;
		state.currentLeafCount = leafCount + 1;
	}

	/// @notice Game delegatecall target, pool-only: resumes a paused fork-continuation game once its carry funding is complete.
	function resumeFromFork() external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		require(msg.sender == game.questionLedger(), 'Only pool');
		require(forkContinuation, 'No fork mode');
		require(forkResumedAt == 0, 'Fork resumed');
		require(forkCarrySnapshotOutcomesInitialized == 3, 'Fork snapshot incomplete');
		require(game.isForkCarryFundingComplete(), 'Fork carry underfunded');
		if (forkCarryDisputeStakedAttoRep == 0 && forkCarrySnapshotRequiresForkedEscrow) {
			for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
				forkCarryDisputeStakedAttoRep += (outcomeState[outcomeIndex].inheritedUnresolvedTotalAttoRep);
			}
			totalDisputeStakedAttoRep += forkCarryDisputeStakedAttoRep;
		}
		address authority = EscalationGameRepCustody.portfolio(game.questionLedger());
		if (authority == address(0)) forkResumedAt = block.timestamp;
		else {
			uint248 universeId = IEscalationGameQuestionLedgerContext(game.questionLedger()).universeId();
			ISecurityPoolReporterPortfolio portfolio = ISecurityPoolReporterPortfolio(authority);
			uint48 portfolioTimeAnchor = portfolio.portfolioTimeForNative(universeId, 0);
			forkResumedAt = portfolio.nativeTimeForPortfolioTime(universeId, portfolioTimeAnchor);
			require(block.timestamp >= forkResumedAt, 'Portfolio response period has not started');
		}
		_recordSettlementForkThreshold(game.questionLedger());
		if (game.getEscalationGameEndDate() >= block.timestamp) _scheduleReporterFinality();
		IEscalationGameQuestionLedgerContext(game.questionLedger()).refreshPortfolioFees();
		emit ForkContinuationResumed(forkResumedAt);
	}

	/// @notice Game delegatecall target: marks an inherited parent deposit consumed and records its retained principal.
	function consumeCarriedDeposit(uint8 outcomeIndex, uint256 parentDepositIndex, uint256 amountAttoRep, uint256 effectiveInheritedAttoRep) external {
		require(!outcomeState[outcomeIndex].consumedParentDepositIndexes[parentDepositIndex], 'Deposit settled');
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 sourceBasisAttoRep = amountAttoRep;
		uint256 sourceRetainedAmountAttoRep = amountAttoRep;
		require(effectiveInheritedAttoRep >= sourceRetainedAmountAttoRep, 'Carried REP low');
		state.consumedParentDepositIndexes[parentDepositIndex] = true;
		state.inheritedConsumedSourceAttoRep += sourceBasisAttoRep;
		state.inheritedConsumedRetainedAttoRep += sourceRetainedAmountAttoRep;
		require(sourceBasisAttoRep <= state.inheritedUnresolvedTotalAttoRep, 'Carried source low');
		state.inheritedUnresolvedTotalAttoRep -= sourceBasisAttoRep;
	}

	/// @notice Game delegatecall target: reduces `bundleId`'s local unresolved principal on `outcomeIndex` by `amountAttoRep`.
	function consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amountAttoRep) external {
		require(vaultAccounting[bundleId].unresolvedAttoRep >= amountAttoRep, 'Claim accounting remainder');
		require(vaultAccounting[bundleId].localUnresolvedPrincipalByOutcome[outcomeIndex] >= amountAttoRep, 'Claim accounting remainder');
		vaultAccounting[bundleId].unresolvedAttoRep -= amountAttoRep;
		vaultAccounting[bundleId].localUnresolvedPrincipalByOutcome[outcomeIndex] -= amountAttoRep;
		totalLocalUnresolvedAttoRep -= amountAttoRep;
	}

	/// @notice Game delegatecall target: transfers `amountAttoRep` of REP to `bundleId`.
	function creditClaimOwners(address bundleId, uint256 amountAttoRep) external {
		if (amountAttoRep == 0) return;
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		EscalationGameRepCustody.transfer(game.questionLedger(), game.repToken(), bundleId, amountAttoRep);
	}

	/// @notice Game delegatecall target: pays a carried-deposit claim to `bundleId` and releases the consumed fork-carry dispute stake.
	function creditExternalClaimOwners(address, address bundleId, uint256, uint256 amountAttoRep, uint256 burnAmountAttoRep) external {
		uint256 backingConsumed = amountAttoRep + (winnerHaircutPaidByFork ? 0 : burnAmountAttoRep);
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		// Losing local principal may already be settled while its tokens still fund
		// this reward. Check actual expenditure against tokens, not logical escrow.
		require(EscalationGameRepCustody.balance(game.questionLedger(), game.repToken()) >= backingConsumed, 'Escrow low');
		uint256 inheritedBackingConsumed =
			backingConsumed < forkCarryDisputeStakedAttoRep ? backingConsumed : forkCarryDisputeStakedAttoRep;
		forkCarryDisputeStakedAttoRep -= inheritedBackingConsumed;
		totalDisputeStakedAttoRep -= inheritedBackingConsumed;
		if (amountAttoRep == 0) return;
		EscalationGameRepCustody.transfer(game.questionLedger(), game.repToken(), bundleId, amountAttoRep);
	}

	function _scheduleReporterFinality() private {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		if (address(EscalationGameRepCustody.ledger(game.questionLedger())) == address(0)) return;
		uint256 highest;
		uint256 leaders;
		for (uint256 index = 0; index < 3; index++) {
			uint256 amount = outcomeState[index].balanceAttoRep;
			if (amount > highest) {
				highest = amount;
				leaders = 1;
			} else if (amount == highest) leaders += 1;
		}
		uint256 finalAfter;
		if (
			fixedQuestionOutcome != BinaryOutcomes.BinaryOutcome.None ||
			(nonDecisionState == NonDecisionState.None && leaders == 1)
		) finalAfter = game.getEscalationGameEndDate();
		require(finalAfter <= type(uint48).max, 'Reporter finality timestamp too high');
		EscalationGameRepCustody.scheduleFinality(game.questionLedger(), uint48(finalAfter));
	}
}
