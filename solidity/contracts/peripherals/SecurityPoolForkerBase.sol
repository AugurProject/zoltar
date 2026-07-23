// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import { EscalationForkSnapshot, SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { ISecurityPoolForkerEvents } from './interfaces/ISecurityPoolForker.sol';

abstract contract SecurityPoolForkerBase is SecurityPoolForkerStorage, ISecurityPoolForkerEvents {
	Zoltar public immutable zoltar;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function _getEscalationDepositId(
		ISecurityPool securityPool,
		uint8 outcomeIndex,
		uint256 parentDepositIndex
	) internal view returns (bytes32) {
		ISecurityPoolFactory factory = securityPool.securityPoolFactory();
		bytes32 originId = factory.getSecurityPoolOriginId(securityPool);
		return keccak256(abi.encode(factory, originId, outcomeIndex, parentDepositIndex));
	}

	function repToPoolOwnership(ISecurityPool securityPool, uint256 repAmount) public view returns (uint256) {
		uint256 poolOwnershipDenominator = securityPool.poolOwnershipDenominator();
		uint256 childRepBalance = securityPool.repToken().balanceOf(address(securityPool));
		if (poolOwnershipDenominator == 0 || childRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return (repAmount * poolOwnershipDenominator) / childRepBalance;
	}

	function poolOwnershipToRep(ISecurityPool securityPool, uint256 poolOwnership) public view returns (uint256) {
		return
			(poolOwnership * securityPool.repToken().balanceOf(address(securityPool))) /
			securityPool.poolOwnershipDenominator();
	}

	function _validateChildEscalationGame(ISecurityPool child, EscalationGame childEscalationGame) internal view {
		require(
			address(childEscalationGame) == address(0x0) ||
				address(childEscalationGame.securityPool()) == address(child),
			'Child game'
		);
	}

	function _finalizeAwaitingForkContinuationIfReady(
		ISecurityPool child,
		EscalationGame childEscalationGame
	) internal {
		if (
			address(childEscalationGame) == address(0x0) ||
			child.systemState() != SystemState.Operational ||
			childEscalationGame.forkResumedAt() != 0
		) return;
		if (child.awaitingForkContinuation()) {
			child.setAwaitingForkContinuation(false);
		}
		child.resumeForkedEscalationGame();
	}

	function _finalizeEscalationStateAfterAuction(ISecurityPool child, bool unresolvedEscalationAtFork) internal {
		if (!unresolvedEscalationAtFork) return;
		EscalationGame childEscalationGame = child.escalationGame();
		_validateChildEscalationGame(child, childEscalationGame);
		if (address(childEscalationGame) == address(0x0)) return;
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
	}

	function _initializeChildForkedEscalationGameIfNeeded(
		ISecurityPool parent,
		ISecurityPool child,
		EscalationGame childEscalationGame
	) internal virtual returns (EscalationGame) {
		_validateChildEscalationGame(child, childEscalationGame);
		EscalationGame parentEscalationGame = parent.escalationGame();
		if (
			forkDataByPool[parent].unresolvedEscalationAtFork &&
			address(parentEscalationGame) != address(0x0) &&
			address(childEscalationGame) != address(0x0) &&
			!childEscalationGame.forkCarrySnapshotInitialized()
		) {
			EscalationForkSnapshot storage snapshot = escalationForkSnapshotByPool[parent];
			require(snapshot.initialized, 'Fork snapshot missing');
			child.initializeForkCarrySnapshotWithResolutionBalances(
				address(parentEscalationGame),
				forkDataByPool[parent].escalationSnapshotId,
				snapshot.carryPeaks,
				snapshot.carryLeafCounts,
				snapshot.carryTotals,
				snapshot.resolutionBalances,
				snapshot.nullifierRoots
			);
		}
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
		return childEscalationGame;
	}

	function _initializeOwnForkRepBuckets(
		ISecurityPool parent,
		uint256 vaultRepAtFork,
		uint256 escalationChildRepAtFork,
		uint256 escalationSourceRep
	) internal {
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[parent];
		repBuckets.vaultRepAtFork = vaultRepAtFork;
		repBuckets.escalationChildRepAtFork = escalationChildRepAtFork;
		repBuckets.escalationSourceRepAtFork = escalationSourceRep;
	}
}
