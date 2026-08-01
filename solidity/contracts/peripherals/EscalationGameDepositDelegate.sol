// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import {
	Deposit,
	EscalationClaimBundle,
	ForkedEscrowState,
	MERKLE_MOUNTAIN_RANGE_MAX_PEAKS,
	MAX_CLAIM_BUNDLES_PER_VAULT,
	MAX_CLAIM_OWNERS_PER_BUNDLE,
	MAX_CLAIM_SOURCE_DEPTH,
	Node,
	NonDecisionState,
	OutcomeState
} from './EscalationGameTypes.sol';

interface IEscalationGameDepositContext {
	function getQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function hasReachedNonDecision() external view returns (bool);
	function repToken() external view returns (address);
	function securityPool() external view returns (address);
	function getBindingCapital() external view returns (uint256);
	function computeTimeSinceStartFromAttritionCost(uint256 amount) external view returns (uint256);
	function isForkCarryFundingComplete() external view returns (bool);
}

interface IEscalationGameSecurityPoolContext {
	function securityPoolForker() external view returns (address);
}

interface IExternalEscalationClaimBundleSource {
	function getClaimOwner(
		address bundleId,
		uint256 ownerIndex
	) external view returns (address ownerAddress, uint256 ownerShares, uint256 totalShares);
}

contract EscalationGameDepositDelegate is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;
	event VaultEscrowUpdated(address indexed vault, uint256 escrowedRepByVault, uint256 totalEscrowedRep);

	event EscalationClaimMoved(
		address indexed fromVault,
		address indexed toVault,
		uint256 numerator,
		uint256 denominator
	);
	event TruthAuctionHaircutApplied(
		uint256 repBefore,
		uint256 repRemoved,
		uint256 repRemaining,
		uint256 rebasedElapsed
	);
	event ForkContinuationResumed(uint256 resumedAt);
	event ForkedEscrowRecorded(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipal,
		uint256 childRep,
		uint256 escrowedRepByVault,
		uint256 totalEscrowedRep,
		uint256 outcomeBalance
	);

	function recordDeposit(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) external returns (uint256 parentDepositIndex) {
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage selectedOutcomeState = outcomeState[outcomeIndex];
		_validateAcceptedDeposit(
			outcome,
			outcomeIndex,
			selectedOutcomeState.balance,
			repAmount,
			expectedCumulativeRepAmount
		);
		_requireClaimBundleUnsplit(depositor);
		selectedOutcomeState.balance = expectedCumulativeRepAmount;
		_increaseEscrowedRepForBundle(depositor, repAmount);
		_registerClaimBundle(claimBundlesByOwner, depositor, depositor);
		_registerClaimBundle(payoutClaimBundlesByOwner, depositor, depositor);
		unresolvedRepByVault[depositor] += repAmount;
		totalLocalUnresolvedRep += repAmount;
		localUnresolvedPrincipalByVaultAndOutcome[depositor][outcomeIndex] += repAmount;

		selectedOutcomeState.deposits.push(
			Deposit({ depositor: depositor, amount: repAmount, cumulativeAmount: expectedCumulativeRepAmount })
		);
		uint256 depositIndex = selectedOutcomeState.deposits.length - 1;
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
		node.amount = repAmount;
		node.parentDepositIndex = parentDepositIndex;
		node.cumulativeAmount = expectedCumulativeRepAmount;
		node.carryLeafIndex = selectedOutcomeState.currentLeafCount;
		selectedOutcomeState.localNodeIds.push(nodeId);
		selectedOutcomeState.localHeadNodeId = nodeId;
		selectedOutcomeState.localUnresolvedTotal += repAmount;
		_appendCarryLeaf(selectedOutcomeState, nodeId);

		emit LocalDepositAppended(
			nodeId,
			outcome,
			depositor,
			repAmount,
			parentDepositIndex,
			expectedCumulativeRepAmount
		);
		emit DepositOnOutcome(
			depositor,
			outcome,
			repAmount,
			depositIndex,
			expectedCumulativeRepAmount,
			_claimEscrowedRepByVault(depositor),
			totalEscrowedRep
		);
		if (IEscalationGameDepositContext(address(this)).hasReachedNonDecision()) {
			nonDecisionState = NonDecisionState.Local;
			nonDecisionTimestamp = block.timestamp;
			emit NonDecisionReached(nonDecisionTimestamp);
		}
	}

	function recordForkedEscrowForOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipal,
		uint256 childRepAmount
	) external {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(depositor != address(0x0), 'Depositor is zero');
		if (sourcePrincipal == 0 && childRepAmount == 0) return;
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		state.sourcePrincipal += sourcePrincipal;
		uint256 effectiveChildRep = _applyTruthAuctionRetention(childRepAmount);
		state.childRep += childRepAmount;
		_increaseEscrowedRepForBundle(depositor, effectiveChildRep);
		_registerClaimBundle(claimBundlesByOwner, depositor, depositor);
		_registerClaimBundle(payoutClaimBundlesByOwner, depositor, depositor);
		emit ForkedEscrowRecorded(
			depositor,
			outcome,
			state.sourcePrincipal,
			state.childRep,
			_claimEscrowedRepByVault(depositor),
			totalEscrowedRep,
			outcomeState[uint8(outcome)].balance
		);
	}

	function _validateAcceptedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		uint8 outcomeIndex,
		uint256 currentBalance,
		uint256 repAmount,
		uint256 expectedCumulativeRepAmount
	) private view {
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(
			IEscalationGameDepositContext(address(this)).getQuestionResolution() == BinaryOutcomes.BinaryOutcome.None,
			'Question resolved'
		);
		require(currentBalance < nonDecisionThreshold, 'Outcome full');
		require(repAmount > 0, 'Deposit zero');
		require(expectedCumulativeRepAmount == currentBalance + repAmount, 'Preview mismatch');
		require(expectedCumulativeRepAmount <= nonDecisionThreshold, 'Deposit exceeds room');
		require(repAmount >= startBond || expectedCumulativeRepAmount == nonDecisionThreshold, 'Below start bond');

		uint256 maxBalance = outcomeState[0].balance;
		if (outcomeState[1].balance > maxBalance) maxBalance = outcomeState[1].balance;
		if (outcomeState[2].balance > maxBalance) maxBalance = outcomeState[2].balance;
		if (expectedCumulativeRepAmount != maxBalance || maxBalance >= nonDecisionThreshold) return;
		for (uint8 otherOutcomeIndex = 0; otherOutcomeIndex < 3; otherOutcomeIndex++) {
			if (otherOutcomeIndex != outcomeIndex && outcomeState[otherOutcomeIndex].balance == maxBalance) {
				revert('Preview mismatch');
			}
		}
	}

	function _appendCarryLeaf(OutcomeState storage state, uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		bytes32 carryHash = MerkleMountainRange.hashLeaf(
			node.depositor,
			node.outcome,
			node.amount,
			node.parentDepositIndex,
			node.cumulativeAmount,
			nodeId
		);
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

	function moveEscalationClaim(address fromVault, address toVault, uint256 numerator, uint256 denominator) external {
		_validateClaimMover();
		require(fromVault != address(0x0) && toVault != address(0x0) && fromVault != toVault, 'Vault');
		require(numerator > 0 && numerator <= denominator, 'Fraction');
		_movePayoutClaimOwnership(fromVault, toVault, numerator, denominator);
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = claimBundlesByOwner[fromVault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
			uint256 fromOwnerIndex = _getBundleOwnerIndex(bundle, fromVault);
			uint256 fromShares = bundle.ownerShares[fromOwnerIndex];
			if (fromShares == 0) continue;
			uint256 sharesToMove = numerator == denominator ? fromShares : (fromShares * numerator) / denominator;
			require(sharesToMove > 0, 'Fraction');
			uint256 toOwnerIndex = _getOrAddBundleOwner(bundleId, bundle, toVault);
			bundle.ownerShares[fromOwnerIndex] = fromShares - sharesToMove;
			bundle.ownerShares[toOwnerIndex] += sharesToMove;
			if (bundle.ownerShares[fromOwnerIndex] == 0) bundleIds[bundleIndex] = address(0x0);
		}
		_moveClaimAccounting(fromVault, toVault, numerator, denominator);
		emit EscalationClaimMoved(fromVault, toVault, numerator, denominator);
	}

	function _validateClaimMover() private view {
		ISecurityPool sourcePool = ISecurityPool(payable(IEscalationGameDepositContext(address(this)).securityPool()));
		if (msg.sender == address(sourcePool)) return;
		ISecurityPool callerPool = ISecurityPool(payable(msg.sender));
		require(address(callerPool.securityPoolFactory()) == address(sourcePool.securityPoolFactory()), 'Factory');
		bytes32 originId = callerPool.securityPoolFactory().getSecurityPoolOriginId(callerPool);
		require(
			originId != bytes32(0) &&
				originId == sourcePool.securityPoolFactory().getSecurityPoolOriginId(sourcePool) &&
				address(callerPool.securityPoolFactory().getSecurityPool(originId, callerPool.universeId())) ==
					msg.sender,
			'Claim source'
		);
	}

	function _moveClaimAccounting(address fromVault, address toVault, uint256 numerator, uint256 denominator) private {
		uint256 unresolvedToMove = _fraction(unresolvedRepByVault[fromVault], numerator, denominator);
		unresolvedRepByVault[fromVault] -= unresolvedToMove;
		unresolvedRepByVault[toVault] += unresolvedToMove;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 localToMove = _fraction(
				localUnresolvedPrincipalByVaultAndOutcome[fromVault][outcomeIndex],
				numerator,
				denominator
			);
			localUnresolvedPrincipalByVaultAndOutcome[fromVault][outcomeIndex] -= localToMove;
			localUnresolvedPrincipalByVaultAndOutcome[toVault][outcomeIndex] += localToMove;

			ForkedEscrowState storage fromForked = forkedEscrowByVaultAndOutcome[fromVault][outcomeIndex];
			ForkedEscrowState storage toForked = forkedEscrowByVaultAndOutcome[toVault][outcomeIndex];
			uint256 sourceToMove = _fraction(
				fromForked.sourcePrincipal - fromForked.sourcePrincipalClaimed,
				numerator,
				denominator
			);
			uint256 childToMove = _fraction(fromForked.childRep - fromForked.childRepClaimed, numerator, denominator);
			fromForked.sourcePrincipal -= sourceToMove;
			fromForked.childRep -= childToMove;
			toForked.sourcePrincipal += sourceToMove;
			toForked.childRep += childToMove;
		}
	}

	function _fraction(uint256 amount, uint256 numerator, uint256 denominator) private pure returns (uint256) {
		return numerator == denominator ? amount : (amount * numerator) / denominator;
	}

	function applyTruthAuctionHaircut(uint256 repToRemove) external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		address poolAddress = game.securityPool();
		require(msg.sender == IEscalationGameSecurityPoolContext(poolAddress).securityPoolForker(), 'Only forker');
		require(forkContinuation && forkResumedAt == 0, 'Fork not paused');
		require(truthAuctionRepBefore == 0, 'Haircut applied');
		uint256 repBefore = IERC20(game.repToken()).balanceOf(address(this));
		require(repToRemove < repBefore, 'Haircut too high');
		uint256 repRemaining = repBefore - repToRemove;
		truthAuctionRepBefore = repBefore;
		truthAuctionRepRemaining = repRemaining;
		totalEscrowedRep = (totalEscrowedRep * repRemaining) / repBefore;
		forkCarryEscrowedRep = (forkCarryEscrowedRep * repRemaining) / repBefore;
		for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			outcomeState[outcomeIndex].balance = (outcomeState[outcomeIndex].balance * repRemaining) / repBefore;
		}
		forkElapsedAtStart = game.computeTimeSinceStartFromAttritionCost(game.getBindingCapital());
		IERC20(game.repToken()).safeTransfer(poolAddress, repToRemove);
		emit TruthAuctionHaircutApplied(repBefore, repToRemove, repRemaining, forkElapsedAtStart);
	}

	function resumeFromFork() external {
		IEscalationGameDepositContext game = IEscalationGameDepositContext(address(this));
		require(msg.sender == game.securityPool(), 'Only pool');
		require(forkContinuation, 'No fork mode');
		require(forkResumedAt == 0, 'Fork resumed');
		require(game.isForkCarryFundingComplete(), 'Fork carry underfunded');
		if (forkCarryEscrowedRep == 0 && forkCarrySnapshotRequiresForkedEscrow) {
			for (uint256 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
				forkCarryEscrowedRep += _applyTruthAuctionRetention(
					outcomeState[outcomeIndex].inheritedUnresolvedTotal
				);
			}
			totalEscrowedRep += forkCarryEscrowedRep;
		}
		forkResumedAt = block.timestamp;
		emit ForkContinuationResumed(block.timestamp);
	}

	function consumeEscrowedRepForOwner(address ownerAddress, uint256 amount) external {
		if (amount == 0) return;
		uint256 remaining = amount;
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = claimBundlesByOwner[ownerAddress];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
			for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
				if (bundle.owners[ownerIndex] != ownerAddress || bundle.ownerShares[ownerIndex] == 0) continue;
				uint256 ownerRawRep = (bundle.escrowedRep * bundle.ownerShares[ownerIndex]) / bundle.totalShares;
				uint256 ownerRep = _applyTruthAuctionRetention(ownerRawRep);
				uint256 repToConsume = ownerRep < remaining ? ownerRep : remaining;
				if (repToConsume == 0) break;
				uint256 rawRepToConsume = _repToClaimShares(repToConsume);
				if (rawRepToConsume > ownerRawRep) rawRepToConsume = ownerRawRep;
				uint256 sharesToConsume =
					rawRepToConsume == ownerRawRep
						? bundle.ownerShares[ownerIndex]
						: (rawRepToConsume * bundle.totalShares + bundle.escrowedRep - 1) / bundle.escrowedRep;
				bundle.escrowedRep -= rawRepToConsume;
				bundle.totalShares -= sharesToConsume;
				bundle.ownerShares[ownerIndex] -= sharesToConsume;
				totalEscrowedRep -= repToConsume;
				remaining -= repToConsume;
				if (bundle.ownerShares[ownerIndex] == 0) bundleIds[bundleIndex] = address(0x0);
				break;
			}
			if (remaining == 0) break;
		}
		require(remaining == 0, 'Escrowed REP low');
		emit VaultEscrowUpdated(ownerAddress, _claimEscrowedRepByVault(ownerAddress), totalEscrowedRep);
	}

	function consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amount) external {
		EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
		uint256 remaining = amount;
		uint256 remainingShares = bundle.totalShares;
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			address ownerAddress = bundle.owners[ownerIndex];
			uint256 ownerShares = bundle.ownerShares[ownerIndex];
			if (ownerAddress == address(0x0) || ownerShares == 0) continue;
			uint256 ownerAmount =
				ownerShares == remainingShares ? remaining : (amount * ownerShares) / bundle.totalShares;
			uint256 ownerUnresolved = unresolvedRepByVault[ownerAddress];
			uint256 ownerOutcomePrincipal = localUnresolvedPrincipalByVaultAndOutcome[ownerAddress][outcomeIndex];
			uint256 ownerAvailable = ownerUnresolved < ownerOutcomePrincipal ? ownerUnresolved : ownerOutcomePrincipal;
			uint256 amountToConsume = ownerAmount < ownerAvailable ? ownerAmount : ownerAvailable;
			unresolvedRepByVault[ownerAddress] = ownerUnresolved - amountToConsume;
			localUnresolvedPrincipalByVaultAndOutcome[ownerAddress][outcomeIndex] =
				ownerOutcomePrincipal - amountToConsume;
			remaining -= amountToConsume;
			remainingShares -= ownerShares;
		}
		// Bundle-share floors and aggregate-principal floors can differ by a few
		// base units. Consume that bounded rounding residue from any current owner;
		// payout ownership remains entirely governed by the bundle shares above.
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE && remaining > 0; ownerIndex++) {
			address ownerAddress = bundle.owners[ownerIndex];
			if (ownerAddress == address(0x0) || bundle.ownerShares[ownerIndex] == 0) continue;
			uint256 ownerUnresolved = unresolvedRepByVault[ownerAddress];
			uint256 ownerOutcomePrincipal = localUnresolvedPrincipalByVaultAndOutcome[ownerAddress][outcomeIndex];
			uint256 ownerAvailable = ownerUnresolved < ownerOutcomePrincipal ? ownerUnresolved : ownerOutcomePrincipal;
			uint256 amountToConsume = remaining < ownerAvailable ? remaining : ownerAvailable;
			unresolvedRepByVault[ownerAddress] = ownerUnresolved - amountToConsume;
			localUnresolvedPrincipalByVaultAndOutcome[ownerAddress][outcomeIndex] =
				ownerOutcomePrincipal - amountToConsume;
			remaining -= amountToConsume;
		}
		require(remaining == 0, 'Claim accounting remainder');
		totalLocalUnresolvedRep -= amount;
	}

	function creditClaimOwners(address bundleId, uint256 amount) external {
		if (amount == 0) return;
		EscalationClaimBundle storage bundle = payoutClaimBundles[bundleId];
		uint256 remaining = amount;
		uint256 remainingShares = bundle.totalShares;
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			address ownerAddress = bundle.owners[ownerIndex];
			uint256 shares = bundle.ownerShares[ownerIndex];
			if (ownerAddress == address(0x0) || shares == 0) continue;
			uint256 ownerAmount = shares == remainingShares ? remaining : (amount * shares) / bundle.totalShares;
			IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(ownerAddress, ownerAmount);
			remaining -= ownerAmount;
			remainingShares -= shares;
		}
		require(remaining == 0, 'Claim payout remainder');
	}

	function creditExternalClaimOwners(
		address sourceGame,
		address bundleId,
		uint256 parentDepositIndex,
		uint256 amount,
		uint256 burnAmount
	) external {
		uint256 backingConsumed = amount + (winnerHaircutPaidByFork ? 0 : burnAmount);
		require(totalEscrowedRep >= backingConsumed, 'Escrow low');
		uint256 inheritedBackingConsumed =
			backingConsumed < forkCarryEscrowedRep ? backingConsumed : forkCarryEscrowedRep;
		forkCarryEscrowedRep -= inheritedBackingConsumed;
		totalEscrowedRep -= backingConsumed;
		if (amount == 0) return;
		address encodedSourceGame = address(uint160(parentDepositIndex >> 96));
		if (encodedSourceGame != address(0x0)) sourceGame = encodedSourceGame;
		else sourceGame = _resolveRootClaimSource(sourceGame);
		// Pre-bundling carry snapshots (and proof harnesses that model them) have no
		// source-game owner registry. Their depositor remains the sole claim owner.
		(bool hasOwnerRegistry, bytes memory firstOwnerData) = sourceGame.staticcall(
			abi.encodeCall(IExternalEscalationClaimBundleSource.getClaimOwner, (bundleId, 0))
		);
		if (!hasOwnerRegistry || firstOwnerData.length != 96) {
			IERC20(IEscalationGameDepositContext(address(this)).repToken()).safeTransfer(bundleId, amount);
			return;
		}
		uint256 remaining = amount;
		uint256 totalShares;
		uint256 remainingShares;
		IERC20 token = IERC20(IEscalationGameDepositContext(address(this)).repToken());
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			(address ownerAddress, uint256 shares, uint256 bundleTotalShares) = ownerIndex == 0
				? abi.decode(firstOwnerData, (address, uint256, uint256))
				: IExternalEscalationClaimBundleSource(sourceGame).getClaimOwner(bundleId, ownerIndex);
			if (totalShares == 0) {
				totalShares = bundleTotalShares;
				remainingShares = bundleTotalShares;
			}
			if (ownerAddress == address(0x0) || shares == 0) continue;
			uint256 ownerAmount = shares == remainingShares ? remaining : (amount * shares) / totalShares;
			remaining -= ownerAmount;
			remainingShares -= shares;
			if (ownerAmount > 0) token.safeTransfer(ownerAddress, ownerAmount);
		}
		require(totalShares > 0 && remaining == 0, 'Claim payout remainder');
	}

	function _resolveRootClaimSource(address sourceGame) private view returns (address) {
		for (uint256 depth = 0; depth < MAX_CLAIM_SOURCE_DEPTH; depth++) {
			(bool hasSource, bytes memory sourceData) = sourceGame.staticcall(hex'db05d0b2');
			if (!hasSource || sourceData.length != 32) return sourceGame;
			address nextSourceGame = abi.decode(sourceData, (address));
			if (nextSourceGame == address(0x0) || nextSourceGame == sourceGame) return sourceGame;
			sourceGame = nextSourceGame;
		}
		revert('Claim depth');
	}

	function _movePayoutClaimOwnership(
		address fromVault,
		address toVault,
		uint256 numerator,
		uint256 denominator
	) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = payoutClaimBundlesByOwner[fromVault];
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address bundleId = bundleIds[bundleIndex];
			if (bundleId == address(0x0)) continue;
			EscalationClaimBundle storage bundle = payoutClaimBundles[bundleId];
			uint256 fromOwnerIndex = _getBundleOwnerIndex(bundle, fromVault);
			uint256 fromShares = bundle.ownerShares[fromOwnerIndex];
			if (fromShares == 0) continue;
			uint256 sharesToMove = numerator == denominator ? fromShares : (fromShares * numerator) / denominator;
			require(sharesToMove > 0, 'Fraction');
			uint256 toOwnerIndex = _getOrAddPayoutBundleOwner(bundleId, bundle, toVault);
			bundle.ownerShares[fromOwnerIndex] = fromShares - sharesToMove;
			bundle.ownerShares[toOwnerIndex] += sharesToMove;
			if (bundle.ownerShares[fromOwnerIndex] == 0) bundleIds[bundleIndex] = address(0x0);
		}
	}

	function _requireClaimBundleUnsplit(address bundleId) private view {
		EscalationClaimBundle storage bundle = escalationClaimBundles[bundleId];
		if (bundle.totalShares == 0) return;
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != bundleId) continue;
			require(bundle.ownerShares[ownerIndex] == bundle.totalShares, 'Claim ownership split');
			return;
		}
		revert('Claim ownership split');
	}

	function _getBundleOwnerIndex(
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private view returns (uint256) {
		for (uint256 ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] == ownerAddress) return ownerIndex;
		}
		revert('Claim owner missing');
	}

	function _getOrAddBundleOwner(
		address bundleId,
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private returns (uint256 ownerIndex) {
		for (ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != ownerAddress) continue;
			_registerClaimBundle(claimBundlesByOwner, ownerAddress, bundleId);
			return ownerIndex;
		}
		for (ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != address(0x0) && bundle.ownerShares[ownerIndex] != 0) continue;
			bundle.owners[ownerIndex] = ownerAddress;
			_registerClaimBundle(claimBundlesByOwner, ownerAddress, bundleId);
			return ownerIndex;
		}
		revert('Claim owners full');
	}

	function _registerClaimBundle(
		mapping(address => address[MAX_CLAIM_BUNDLES_PER_VAULT]) storage registry,
		address ownerAddress,
		address bundleId
	) private {
		address[MAX_CLAIM_BUNDLES_PER_VAULT] storage bundleIds = registry[ownerAddress];
		uint256 emptyIndex = MAX_CLAIM_BUNDLES_PER_VAULT;
		for (uint256 bundleIndex = 0; bundleIndex < MAX_CLAIM_BUNDLES_PER_VAULT; bundleIndex++) {
			address registeredBundle = bundleIds[bundleIndex];
			if (registeredBundle == bundleId) return;
			if (registeredBundle == address(0x0) && emptyIndex == MAX_CLAIM_BUNDLES_PER_VAULT) {
				emptyIndex = bundleIndex;
			}
		}
		if (emptyIndex == MAX_CLAIM_BUNDLES_PER_VAULT) revert();
		bundleIds[emptyIndex] = bundleId;
	}

	function _getOrAddPayoutBundleOwner(
		address bundleId,
		EscalationClaimBundle storage bundle,
		address ownerAddress
	) private returns (uint256 ownerIndex) {
		for (ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != ownerAddress) continue;
			_registerClaimBundle(payoutClaimBundlesByOwner, ownerAddress, bundleId);
			return ownerIndex;
		}
		for (ownerIndex = 0; ownerIndex < MAX_CLAIM_OWNERS_PER_BUNDLE; ownerIndex++) {
			if (bundle.owners[ownerIndex] != address(0x0) && bundle.ownerShares[ownerIndex] != 0) continue;
			bundle.owners[ownerIndex] = ownerAddress;
			_registerClaimBundle(payoutClaimBundlesByOwner, ownerAddress, bundleId);
			return ownerIndex;
		}
		revert('Claim owners full');
	}
}
