// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { EscalationGame } from '../../peripherals/EscalationGame.sol';
import { CarriedDepositProof } from '../../peripherals/EscalationGameTypes.sol';

contract EscalationGameProofTestSecurityPool {
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	address private immutable configuredSecurityPoolForker;
	EscalationGame public escalationGame;

	constructor(Zoltar zoltarAddress, uint248 configuredUniverseId, address _configuredSecurityPoolForker) {
		zoltar = zoltarAddress;
		universeId = configuredUniverseId;
		configuredSecurityPoolForker = _configuredSecurityPoolForker;
	}

	function securityPoolForker() external view returns (address) {
		if (configuredSecurityPoolForker == address(0)) return address(this);
		return configuredSecurityPoolForker;
	}

	function isEscalationDepositClaimedDirectly(
		address,
		BinaryOutcomes.BinaryOutcome,
		uint256
	) external pure returns (bool) {
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

	function repToken() external view returns (ReputationToken) {
		return zoltar.getRepToken(universeId);
	}

	function depositOnOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount
	) external returns (uint256, uint256) {
		(uint256 acceptedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(
			outcome,
			amount
		);
		ReputationToken rep = zoltar.getRepToken(universeId);
		rep.transferFrom(msg.sender, address(escalationGame), acceptedAmount);
		uint256 parentDepositIndex = escalationGame.recordDepositFromSecurityPool(
			depositor,
			outcome,
			acceptedAmount,
			resultingCumulativeAmount
		);
		return (acceptedAmount, parentDepositIndex);
	}

	function initializeForkCarrySnapshot(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		uint256 totalInheritedPrincipal = inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2];
		if (totalInheritedPrincipal > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalInheritedPrincipal);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(
			address(0x0),
			bytes32(0),
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedCarryTotals,
			inheritedNullifierRoots
		);
	}

	function initializeForkCarrySnapshotWithResolutionBalances(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		uint256[3] memory inheritedResolutionBalances,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		uint256 totalResolutionBalance =
			inheritedResolutionBalances[0] + inheritedResolutionBalances[1] + inheritedResolutionBalances[2];
		if (totalResolutionBalance > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalResolutionBalance);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(
			address(0x0),
			bytes32(0),
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedResolutionBalances,
			inheritedNullifierRoots
		);
	}

	function initializeForkCarrySnapshotFromSource(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external {
		uint256 totalInheritedPrincipal = inheritedCarryTotals[0] + inheritedCarryTotals[1] + inheritedCarryTotals[2];
		if (totalInheritedPrincipal > 0) {
			ReputationToken rep = zoltar.getRepToken(universeId);
			rep.transferFrom(msg.sender, address(escalationGame), totalInheritedPrincipal);
		}
		escalationGame.initializeForkCarrySnapshotWithResolutionBalances(
			sourceGame,
			snapshotId,
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedCarryTotals,
			inheritedNullifierRoots
		);
	}

	function withdrawDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		CarriedDepositProof calldata proof
	) external returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		return escalationGame.withdrawDeposit(proof, outcome);
	}

	function recordForkedEscrowForOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipal,
		uint256 childRepAmount
	) external {
		escalationGame.recordForkedEscrowForOutcome(depositor, outcome, sourcePrincipal, childRepAmount);
	}

	function exportVaultUnresolvedDeposits(
		address vault,
		address repReceiver
	) external returns (uint256 principalToTransfer) {
		uint256[3] memory principalByOutcome = escalationGame.exportVaultUnresolvedTotals(vault, repReceiver);
		return principalByOutcome[0] + principalByOutcome[1] + principalByOutcome[2];
	}

	function exportForkedEscrowByOutcome(
		address vault,
		address repReceiver
	) external returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory childRepByOutcome) {
		return escalationGame.exportForkedEscrowByOutcome(vault, repReceiver);
	}

	function exportForkedEscrowByOutcomeWithoutTransfer(
		address vault
	) external returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory childRepByOutcome) {
		return escalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
	}

	function exportUnresolvedDeposit(
		BinaryOutcomes.BinaryOutcome outcome,
		CarriedDepositProof calldata proof
	) external returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		return escalationGame.exportUnresolvedDeposit(proof, outcome);
	}

	function exportLocalUnresolvedDeposit(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	) external returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		return escalationGame.exportUnresolvedDeposit(depositIndex, outcome);
	}

	function claimDepositForWinning(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	) external returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		return escalationGame.claimDepositForWinning(depositIndex, outcome);
	}
}
