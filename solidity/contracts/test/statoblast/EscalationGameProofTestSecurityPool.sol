// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { BinaryOutcomes } from '../../statoblast/BinaryOutcomes.sol';
import { EscalationGame } from '../../statoblast/EscalationGame.sol';
import { CarriedDepositProof } from '../../statoblast/EscalationGameTypes.sol';

contract EscalationGameProofTestSecurityPool {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	address private immutable configuredSecurityPoolForker;
	EscalationGame public escalationGame;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId, address _configuredSecurityPoolForker) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		configuredSecurityPoolForker = _configuredSecurityPoolForker;
		zoltarAddress.getRepToken(configuredUniverseId).approve(address(zoltarAddress), type(uint256).max);
	}

	function securityPoolForker() external view returns (address) {
		if (configuredSecurityPoolForker == address(0)) return address(this);
		return configuredSecurityPoolForker;
	}

	function isEscalationDepositClaimedDirectly(address, BinaryOutcomes.BinaryOutcome, uint256) external pure returns (bool) {
		return false;
	}

	function getQuestionOutcome(address) external view returns (BinaryOutcomes.BinaryOutcome) {
		return escalationGame.getFinalQuestionResolution();
	}

	function parent() external pure returns (address) {
		return address(0x0);
	}

	function setEscalationGame(EscalationGame game) external {
		require(address(escalationGame) == address(0), 'Escalation game proof harness already has a configured game');
		escalationGame = game;
	}

	function resumeEscalationGameFromFork() external {
		escalationGame.resumeFromFork();
	}

	function repToken() external view returns (ReputationToken) {
		return zoltar.getRepToken(universeId);
	}

	function burnEscalationWinnerHaircut(uint256 amount) external {
		require(msg.sender == address(escalationGame), 'Only game');
		zoltar.burnRep(universeId, amount);
	}

	function depositOnOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount) external returns (uint256, uint256) {
		(uint256 acceptedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(outcome, amount);
		ReputationToken rep = zoltar.getRepToken(universeId);
		rep.transferFrom(msg.sender, address(escalationGame), acceptedAmount);
		uint256 parentDepositIndex = escalationGame.recordDepositFromSecurityPool(depositor, outcome, acceptedAmount, resultingCumulativeAmount);
		return (acceptedAmount, parentDepositIndex);
	}

	function recordDeposit(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 amount, uint256 expectedCumulativeAmount) external returns (uint256 parentDepositIndex) {
		return escalationGame.recordDepositFromSecurityPool(depositor, outcome, amount, expectedCumulativeAmount);
	}

	function applyTruthAuctionHaircut(uint256 repToRemoveAttoRep) external {
		escalationGame.applyTruthAuctionHaircut(repToRemoveAttoRep);
	}

	function initializeForkCarrySnapshot(bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals, bytes32[3] memory inheritedNullifierRoots) external {
		uint256 totalInheritedPrincipal = inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2];
		if (totalInheritedPrincipal > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalInheritedPrincipal);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(address(0x0), bytes32(0), inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedCarryTotals, inheritedNullifierRoots);
	}

	function initializeForkCarrySnapshotWithResolutionBalances(bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals, uint256[3] memory inheritedResolutionBalances, bytes32[3] memory inheritedNullifierRoots) external {
		uint256 totalResolutionBalance =
			inheritedResolutionBalances[0] + inheritedResolutionBalances[1] + inheritedResolutionBalances[2];
		if (totalResolutionBalance > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalResolutionBalance);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(address(0x0), bytes32(0), inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedResolutionBalances, inheritedNullifierRoots);
	}

	function initializeForkCarrySnapshotFromSource(address sourceGame, bytes32 snapshotId, bytes32[64][3] memory inheritedCarryPeaks, uint256[3] memory inheritedCarryLeafCounts, uint256[3] memory inheritedCarryTotals, bytes32[3] memory inheritedNullifierRoots) external {
		uint256 totalInheritedPrincipal = inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2];
		if (totalInheritedPrincipal > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalInheritedPrincipal);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(sourceGame, snapshotId, inheritedCarryPeaks, inheritedCarryLeafCounts, inheritedCarryTotals, inheritedCarryTotals, inheritedNullifierRoots);
	}

	function withdrawDeposit(BinaryOutcomes.BinaryOutcome outcome, CarriedDepositProof calldata proof) external returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		return escalationGame.withdrawDeposit(proof, outcome);
	}

	function recordForkedEscrowForOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 sourcePrincipalAttoRep, uint256 childRepAmountAttoRep) external {
		escalationGame.recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep);
	}

	function exportVaultUnresolvedDeposits(address vault, address repReceiver) external returns (uint256 principalToTransferAttoRep) {
		uint256[3] memory principalByOutcomeAttoRep = escalationGame.exportVaultUnresolvedTotals(vault, repReceiver);
		return principalByOutcomeAttoRep[0] + principalByOutcomeAttoRep[1] + principalByOutcomeAttoRep[2];
	}

	function exportForkedEscrowByOutcome(address vault, address repReceiver) external returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory childRepByOutcomeAttoRep) {
		return escalationGame.exportForkedEscrowByOutcome(vault, repReceiver);
	}

	function exportForkedEscrowByOutcomeWithoutTransfer(address vault) external returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory childRepByOutcomeAttoRep) {
		return escalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
	}

	function exportLocalUnresolvedDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) external returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		return escalationGame.exportUnresolvedDeposit(depositIndex, outcome);
	}

	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) external returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		return escalationGame.claimDepositForWinning(depositIndex, outcome);
	}

	function sweepResidualRepToSecurityPool() external {
		escalationGame.sweepResidualRepToSecurityPool();
	}

	function drainAllRep(address receiver) external returns (uint256 amount) {
		return escalationGame.drainAllRep(receiver);
	}
}
