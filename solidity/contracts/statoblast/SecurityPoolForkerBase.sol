// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../Zoltar.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { SecurityPoolForkerStorage } from './SecurityPoolForkerStorage.sol';
import { EscalationForkSnapshot, SecurityPoolForkerForkData } from './SecurityPoolForkerTypes.sol';
import { ISecurityPoolForkerEvents } from './interfaces/ISecurityPoolForker.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

abstract contract SecurityPoolForkerBase is SecurityPoolForkerStorage, ISecurityPoolForkerEvents {
	Zoltar public immutable zoltar;

	constructor(Zoltar _zoltar) {
		zoltar = _zoltar;
	}

	function _getEscalationDepositId(ISecurityPool securityPool, uint8 outcomeIndex, uint256 parentDepositIndex) internal view returns (bytes32) {
		ISecurityPoolFactory factory = securityPool.securityPoolFactory();
		bytes32 originId = factory.getSecurityPoolOriginId(securityPool);
		return keccak256(abi.encode(factory, originId, outcomeIndex, parentDepositIndex));
	}

	function attoRepToBackingUnits(ISecurityPool securityPool, uint256 amountAttoRep) public view returns (uint256) {
		uint256 totalRepBackingUnits = securityPool.totalRepBackingUnits();
		uint256 childRepBalanceAttoRep = securityPool.repToken().balanceOf(address(securityPool));
		if (totalRepBackingUnits == 0 || childRepBalanceAttoRep == 0)
			return Math.mulDiv(amountAttoRep, SecurityPoolUtils.PRICE_PRECISION, 1);
		return Math.mulDiv(amountAttoRep, totalRepBackingUnits, childRepBalanceAttoRep);
	}

	function backingUnitsToAttoRep(ISecurityPool securityPool, uint256 repBackingUnits) public view returns (uint256) {
		uint256 totalRepBackingUnits = securityPool.totalRepBackingUnits();
		if (totalRepBackingUnits == 0) return 0;
		return
			Math.mulDiv(repBackingUnits, securityPool.repToken().balanceOf(address(securityPool)), totalRepBackingUnits);
	}

	function _validateChildEscalationGame(ISecurityPool child, EscalationGame childEscalationGame) internal view {
		require(address(childEscalationGame) == address(0x0) || address(childEscalationGame.securityPool()) == address(child), 'Child game');
	}

	function _finalizeAwaitingForkContinuationIfReady(ISecurityPool child, EscalationGame childEscalationGame) internal {
		if (
			address(childEscalationGame) == address(0x0) ||
			child.systemState() != SystemState.Operational ||
			childEscalationGame.forkResumedAt() != 0 ||
			!childEscalationGame.forkCarrySnapshotInitialized()
		) return;
		child.resumeForkedEscalationGame();
	}

	function _finalizeEscalationStateAfterAuction(ISecurityPool child, bool unresolvedEscalationAtFork) internal {
		if (!unresolvedEscalationAtFork) return;
		EscalationGame childEscalationGame = child.escalationGame();
		_validateChildEscalationGame(child, childEscalationGame);
		if (address(childEscalationGame) == address(0x0)) return;
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
	}

	function _initializeChildForkedEscalationGameIfNeeded(ISecurityPool, ISecurityPool child, EscalationGame childEscalationGame) internal virtual returns (EscalationGame) {
		_validateChildEscalationGame(child, childEscalationGame);
		_finalizeAwaitingForkContinuationIfReady(child, childEscalationGame);
		return childEscalationGame;
	}

	function _continueChildForkCarry(ISecurityPool parent, ISecurityPool child) internal {
		EscalationGame game = child.escalationGame();
		_validateChildEscalationGame(child, game);
		if (!forkDataByPool[parent].unresolvedEscalationAtFork) return;
		require(address(game) != address(0), 'Child game');
		if (game.forkCarrySnapshotInitialized()) return;
		EscalationForkSnapshot storage snapshot = escalationForkSnapshotByPool[parent];
		require(snapshot.initialized, 'Fork snapshot missing');
		uint8 nextOutcome = game.forkCarrySnapshotOutcomesInitialized();
		child.initializeForkCarryOutcome(address(parent.escalationGame()), forkDataByPool[parent].escalationSnapshotId, snapshot.carryPeaks[nextOutcome], snapshot.carryLeafCounts[nextOutcome], snapshot.carryTotalsAttoRep[nextOutcome], snapshot.resolutionBalancesAttoRep[nextOutcome], snapshot.nullifierRoots[nextOutcome]);
	}

	function _requireChildForkCarryReady(ISecurityPool parent, EscalationGame game) internal view {
		if (!forkDataByPool[parent].unresolvedEscalationAtFork) return;
		require(address(game) != address(0) && game.isForkCarryFundingComplete(), 'Fork carry not ready');
	}

	function _initializeOwnForkRepBuckets(ISecurityPool parent, uint256 vaultRepAtForkAttoRep, uint256 escalationChildRepAtForkAttoRep, uint256 escalationSourceAttoRep) internal {
		SecurityPoolForkerForkData storage repBuckets = forkDataByPool[parent];
		repBuckets.vaultRepAtForkAttoRep = vaultRepAtForkAttoRep;
		repBuckets.escalationChildRepAtForkAttoRep = escalationChildRepAtForkAttoRep;
		repBuckets.escalationSourceRepAtForkAttoRep = escalationSourceAttoRep;
	}
}
