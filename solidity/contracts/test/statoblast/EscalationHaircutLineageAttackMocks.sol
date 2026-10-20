// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ISecurityPool,
	ISecurityPoolFactory,
	PoolAccountingSnapshot,
	SystemState
} from '../../statoblast/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../statoblast/interfaces/IShareToken.sol';
import { EscalationGame } from '../../statoblast/EscalationGame.sol';
import { ReputationToken } from '../../ReputationToken.sol';

contract EscalationHaircutLineageAttackParentMock {
	SystemState private currentSystemState = SystemState.Operational;
	ReputationToken private immutable configuredRepToken;
	ISecurityPoolFactory private immutable configuredFactory;
	IShareToken private immutable configuredShareToken;
	uint248 private immutable configuredUniverse;
	uint256 private immutable configuredQuestion;
	uint256 private immutable configuredMultiplier;

	constructor(ReputationToken repTokenAddress, ISecurityPoolFactory factory, IShareToken shareTokenAddress, uint248 universe, uint256 question, uint256 multiplier) {
		configuredRepToken = repTokenAddress;
		configuredFactory = factory;
		configuredShareToken = shareTokenAddress;
		configuredUniverse = universe;
		configuredQuestion = question;
		configuredMultiplier = multiplier;
	}

	function systemState() external view returns (SystemState) {
		return currentSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function questionId() external view returns (uint256) {
		return configuredQuestion;
	}

	function statoblastSecurityMultiplierBps() external view returns (uint256) {
		return configuredMultiplier;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function shareToken() external view returns (IShareToken) {
		return configuredShareToken;
	}

	function repToken() external view returns (ReputationToken) {
		return configuredRepToken;
	}

	function escalationGame() external pure returns (address) {
		return address(0x0);
	}

	function activateForkMode() external {
		currentSystemState = SystemState.PoolForked;
	}

	function settlementCollateralAttoEth() external pure returns (uint256) {
		return 0;
	}

	function getCurrentMintingCapacityAttoEth() external pure returns (uint256) {
		return 0;
	}

	function totalBadDebtAttoEth() external pure returns (uint256) {
		return 0;
	}

	function authorizeChildPool(ISecurityPool) external pure {}
}

contract EscalationHaircutLineageAttackAuctionMock {
	uint256 public totalAttoRepPurchased;

	function setTotalAttoRepPurchased(uint256 attoRep) external {
		totalAttoRepPurchased = attoRep;
	}

	function auctionStarted() external pure returns (uint256) {
		return 1;
	}

	function finalize() external pure {}
}

// Registers under a fake parent, then reports a canonical parent and a canonical
// child escalation game so the forker applies a truth-auction haircut to that game.
contract EscalationHaircutLineageAttackChildMock {
	ISecurityPool private immutable fakeParent;
	ISecurityPoolFactory private immutable configuredFactory;
	address private immutable configuredForker;
	address private immutable configuredTruthAuction;
	uint248 private immutable configuredUniverse;
	ISecurityPool private victimParent;
	EscalationGame private victimEscalationGame;
	SystemState private currentSystemState = SystemState.ForkMigration;
	uint256 private backingUnitsDenominator;

	constructor(ISecurityPool parentPool, ISecurityPoolFactory factory, address forker, address truthAuctionAddress, uint248 universe) {
		fakeParent = parentPool;
		configuredFactory = factory;
		configuredForker = forker;
		configuredTruthAuction = truthAuctionAddress;
		configuredUniverse = universe;
	}

	function arm(ISecurityPool canonicalParent, EscalationGame canonicalEscalationGame) external {
		victimParent = canonicalParent;
		victimEscalationGame = canonicalEscalationGame;
		currentSystemState = SystemState.ForkTruthAuction;
	}

	function parent() external view returns (ISecurityPool) {
		return address(victimParent) == address(0x0) ? fakeParent : victimParent;
	}

	// Report the victim game only until its one-shot haircut is consumed, so the
	// forker's post-auction child-game validation sees no game.
	function escalationGame() external view returns (EscalationGame) {
		if (address(victimEscalationGame) == address(0x0) || victimEscalationGame.truthAuctionRepBeforeAttoRep() != 0)
			return EscalationGame(address(0x0));
		return victimEscalationGame;
	}

	function systemState() external view returns (SystemState) {
		return currentSystemState;
	}

	function universeId() external view returns (uint248) {
		return configuredUniverse;
	}

	function securityPoolFactory() external view returns (ISecurityPoolFactory) {
		return configuredFactory;
	}

	function securityPoolForker() external view returns (address) {
		return configuredForker;
	}

	function truthAuction() external view returns (address) {
		return configuredTruthAuction;
	}

	function setTotalRepBackingUnits(uint256 newTotalRepBackingUnits) external {
		backingUnitsDenominator = newTotalRepBackingUnits;
	}

	function totalRepBackingUnits() external view returns (uint256) {
		return backingUnitsDenominator;
	}

	function setSystemState(SystemState newState) external {
		currentSystemState = newState;
	}

	function getPoolAccountingSnapshot() external pure returns (PoolAccountingSnapshot memory snapshot) {
		return snapshot;
	}

	function feeIndex() external pure returns (uint256) {
		return 0;
	}

	function setPoolFinancials(uint256, uint256, uint256, uint256) external pure {}

	function updateRetentionRate() external pure {}
}
