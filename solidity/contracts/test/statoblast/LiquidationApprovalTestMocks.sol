// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	LiquidationApprovalParams,
	LiquidationApprovalRegistry
} from '../../statoblast/LiquidationApprovalRegistry.sol';
import { IERC1271 } from '../../statoblast/SignatureValidation.sol';
import { SecurityPoolLiquidationDelegate } from '../../statoblast/SecurityPoolLiquidationDelegate.sol';
import { SecurityPoolUtils } from '../../statoblast/SecurityPoolUtils.sol';

contract LiquidationApprovalCoordinatorMock {
	address public securityPool;
	LiquidationApprovalRegistry public registry;

	function configure(address pool, LiquidationApprovalRegistry approvalRegistry) external {
		securityPool = pool;
		registry = approvalRegistry;
	}

	function reserve(uint256 operationId, bytes32 approvalId, address receiverVault, address targetVault, address operator, uint256 requestedDebtAttoEth, uint256 snapshotTargetDebtAttoEth, uint256 latestExecutionTimestamp) external returns (uint256) {
		return
			registry.reserve(operationId, approvalId, receiverVault, targetVault, operator, requestedDebtAttoEth, snapshotTargetDebtAttoEth, latestExecutionTimestamp);
	}

	function release(uint256 operationId) external {
		registry.release(operationId);
	}

	function consume(uint256 operationId, uint256 debtMovedAttoEth) external {
		registry.consume(operationId, debtMovedAttoEth);
	}
}

contract Erc1271LiquidationReceiverMock is IERC1271 {
	bytes32 public acceptedDigest;
	bytes32 public acceptedSignatureHash;
	bool public enabled;

	function configure(bytes32 digest, bytes calldata signature, bool isEnabled) external {
		acceptedDigest = digest;
		acceptedSignatureHash = keccak256(signature);
		enabled = isEnabled;
	}

	function isValidSignature(bytes32 digest, bytes calldata signature) external view returns (bytes4) {
		return
			enabled && digest == acceptedDigest && keccak256(signature) == acceptedSignatureHash
				? IERC1271.isValidSignature.selector
				: bytes4(0xffffffff);
	}
}

contract CoarseLiquidationRoundingHarness is SecurityPoolLiquidationDelegate {
	function configureBadDebtParticipants(address targetVault, address receiverVault, uint256 targetBadDebtAttoEth, uint256 receiverBadDebtAttoEth) external {
		settlementCollateralAttoEth = 100;
		activeObligationUnits = 100;
		totalObligationUnits = 100;
		totalRepBackingUnits = 1_010;
		statoblastSecurityMultiplierBps = 20_000;
		minimumSecurityBondDebtAttoEth = 1;
		minimumVaultRepDepositAttoRep = 1;
		securityVaults[targetVault].repBackingUnits = 10;
		coveragePositions[targetVault].units = 50;
		securityVaults[receiverVault].repBackingUnits = 1_000;
		coveragePositions[receiverVault].units = 50;
		_setVaultBadDebtAttoEth(targetVault, targetBadDebtAttoEth);
		_setVaultBadDebtAttoEth(receiverVault, receiverBadDebtAttoEth);
		totalBadDebtAttoEth = targetBadDebtAttoEth + receiverBadDebtAttoEth;
	}

	function advanceBadDebtGeneration() external {
		totalBadDebtAttoEth = 0;
		badDebtGeneration++;
	}

	function configure(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 1;
		activeObligationUnits = 2;
		totalObligationUnits = 2;
		totalRepBackingUnits = 2;
		statoblastSecurityMultiplierBps = 30_000;
		securityVaults[targetVault].repBackingUnits = 2;
		coveragePositions[targetVault].units = 1;
		coveragePositions[receiverVault].units = 1;
	}

	function configurePositiveResidual(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 4;
		activeObligationUnits = 3;
		totalObligationUnits = 3;
		totalRepBackingUnits = 13;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 3;
		coveragePositions[targetVault].units = 1;
		securityVaults[receiverVault].repBackingUnits = 10;
		coveragePositions[receiverVault].units = 1;
	}

	function configureLiveLiquidationDistance(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 5;
		activeObligationUnits = 10;
		totalObligationUnits = 10;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		coveragePositions[targetVault].units = 10;
		securityVaults[receiverVault].repBackingUnits = 100;
	}

	function configureUnclaimedCapacity(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 8;
		activeObligationUnits = 2;
		totalObligationUnits = 4;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		coveragePositions[targetVault].units = 2;
		securityVaults[receiverVault].repBackingUnits = 100;
		coveragePositions[receiverVault].units = 1;
	}

	function setSettlementCollateralAttoEth(uint256 nextSettlementCollateralAttoEth) external {
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
	}

	function backingUnitsToAttoRep(uint256 backingUnits) external pure returns (uint256) {
		return backingUnits;
	}

	function getTotalPoolHeldAttoRep() external view returns (uint256) {
		return totalRepBackingUnits;
	}

	function getVaultOpenInterestAttoEth(address vault) external view returns (uint256) {
		return
			SecurityPoolUtils.calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, getVaultObligationUnits(vault), totalObligationUnits);
	}

	function vaultState(address vault) external view returns (uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 badDebtAttoEth) {
		return (securityVaults[vault].repBackingUnits, getVaultObligationUnits(vault), _getVaultBadDebtAttoEth(vault));
	}
}
