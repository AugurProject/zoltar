// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory, PoolAccountingSnapshot, SystemState } from '../../statoblast/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../statoblast/interfaces/IShareToken.sol';
import { BinaryOutcomes } from '../../statoblast/BinaryOutcomes.sol';
import { ReputationToken } from '../../ReputationToken.sol';

// Plays both a fake pool and its own unresolved escalation game. As a parent it forks with
// itself as the game, then reports a canonical game so the forker's escalation module
// exports a vault's canonical escrow totals. As a child it accepts every migration call.
contract EscalationGameForkerLineageAttackPoolMock {
	ISecurityPool private immutable configuredParent;
	ReputationToken private immutable configuredRepToken;
	ISecurityPoolFactory private immutable configuredFactory;
	IShareToken private immutable configuredShareToken;
	address private immutable configuredForker;
	address private immutable configuredTruthAuction;
	uint248 private immutable configuredUniverse;
	uint256 private immutable configuredQuestion;
	uint256 private immutable configuredMultiplier;
	SystemState private currentSystemState;
	address private reportedEscalationGame;

	constructor(ISecurityPool parentPool, ReputationToken repTokenAddress, ISecurityPoolFactory factory, IShareToken shareTokenAddress, address forker, address truthAuctionAddress, uint248 universe, uint256 question, uint256 multiplier) {
		configuredParent = parentPool;
		configuredRepToken = repTokenAddress;
		configuredFactory = factory;
		configuredShareToken = shareTokenAddress;
		configuredForker = forker;
		configuredTruthAuction = truthAuctionAddress;
		configuredUniverse = universe;
		configuredQuestion = question;
		configuredMultiplier = multiplier;
		currentSystemState = address(parentPool) == address(0x0) ? SystemState.Operational : SystemState.ForkMigration;
		reportedEscalationGame = address(this);
	}

	function reportEscalationGame(address escalationGameAddress) external {
		reportedEscalationGame = escalationGameAddress;
	}

	function escalationGame() external view returns (address) {
		return reportedEscalationGame;
	}

	function parent() external view returns (ISecurityPool) {
		return configuredParent;
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

	function securityPoolForker() external view returns (address) {
		return configuredForker;
	}

	function truthAuction() external view returns (address) {
		return configuredTruthAuction;
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

	function vaultBadDebtAttoEth(address) external pure returns (uint256) {
		return 0;
	}

	function totalRepBackingUnits() external pure returns (uint256) {
		return 0;
	}

	function totalUnderwritingLimitAttoEth() external pure returns (uint256) {
		return 0;
	}

	function feeIndex() external pure returns (uint256) {
		return 0;
	}

	function securityVaults(address) external pure returns (uint256, uint256, uint256, uint256) {
		return (0, 0, 0, 0);
	}

	function getPoolAccountingSnapshot() external pure returns (PoolAccountingSnapshot memory snapshot) {
		return snapshot;
	}

	function authorizeChildPool(ISecurityPool) external pure {}

	function setTotalRepBackingUnits(uint256) external pure {}

	function setAwaitingForkContinuation(bool) external pure {}

	function initializeForkedEscalationGame(uint256, uint256, uint256, BinaryOutcomes.BinaryOutcome) external pure {}

	function initializeForkCarrySnapshotWithResolutionBalances(address, bytes32, bytes32[64][3] memory, uint256[3] memory, uint256[3] memory, uint256[3] memory, bytes32[3] memory) external pure {}

	function updateVaultFees(address) external pure {}

	function updateSettlementCollateral() external pure {}

	function configureVault(address, uint256, uint256, uint256, uint256, uint256) external pure {}

	// Escalation game surface read by the forker at fork time and during migration.
	function securityPool() external view returns (address) {
		return address(this);
	}

	function getQuestionResolution() external pure returns (BinaryOutcomes.BinaryOutcome) {
		return BinaryOutcomes.BinaryOutcome.None;
	}

	function getEscalationGameEndDate() external pure returns (uint256) {
		return type(uint256).max;
	}

	function getForkCarrySnapshot() external pure returns (bytes32[64][3] memory carryPeaks, uint256[3] memory carryLeafCounts, uint256[3] memory carryTotalsAttoRep, bytes32[3] memory nullifierRoots) {
		return (carryPeaks, carryLeafCounts, carryTotalsAttoRep, nullifierRoots);
	}

	function getOutcomeBalancesAttoRep() external pure returns (uint256[3] memory balancesAttoRep) {
		return balancesAttoRep;
	}

	function getForkCarryRoots() external pure returns (bytes32[3] memory carryRoots) {
		return carryRoots;
	}

	function startBondAttoRep() external pure returns (uint256) {
		return 0;
	}

	function nonDecisionThresholdAttoRep() external pure returns (uint256) {
		return 0;
	}

	function forkContinuation() external pure returns (bool) {
		return false;
	}

	function activationTime() external pure returns (uint256) {
		return 0;
	}

	function forkCarrySnapshotInitialized() external pure returns (bool) {
		return false;
	}

	function forkResumedAt() external pure returns (uint256) {
		return 0;
	}
}
