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
	function configure(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 1;
		feeEligibleCapacityOwnershipAttoRep = 2;
		totalCapacityOwnershipAttoRep = 2;
		totalRepBackingUnits = 2;
		statoblastSecurityMultiplierBps = 30_000;
		securityVaults[targetVault].repBackingUnits = 2;
		securityVaults[targetVault].capacityOwnershipAttoRep = 1;
		securityVaults[receiverVault].capacityOwnershipAttoRep = 1;
	}

	function configurePositiveResidual(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 4;
		feeEligibleCapacityOwnershipAttoRep = 3;
		totalCapacityOwnershipAttoRep = 3;
		totalRepBackingUnits = 13;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 3;
		securityVaults[targetVault].capacityOwnershipAttoRep = 1;
		securityVaults[receiverVault].repBackingUnits = 10;
		securityVaults[receiverVault].capacityOwnershipAttoRep = 1;
	}

	function configureLiveLiquidationDistance(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 5;
		feeEligibleCapacityOwnershipAttoRep = 10;
		totalCapacityOwnershipAttoRep = 10;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		securityVaults[targetVault].capacityOwnershipAttoRep = 10;
		securityVaults[receiverVault].repBackingUnits = 100;
	}

	function configureUnclaimedCapacity(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 8;
		feeEligibleCapacityOwnershipAttoRep = 2;
		totalCapacityOwnershipAttoRep = 4;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		securityVaults[targetVault].capacityOwnershipAttoRep = 2;
		securityVaults[receiverVault].repBackingUnits = 100;
		securityVaults[receiverVault].capacityOwnershipAttoRep = 1;
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
		uint256 grossOpenInterestAttoEth = SecurityPoolUtils.calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, securityVaults[vault].capacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
		uint256 vaultBadDebtAttoEth = _getVaultBadDebtAttoEth(vault);
		return grossOpenInterestAttoEth > vaultBadDebtAttoEth ? grossOpenInterestAttoEth - vaultBadDebtAttoEth : 0;
	}

	function vaultState(address vault) external view returns (uint256 repBackingUnits, uint256 capacityOwnershipAttoRep, uint256 badDebtAttoEth) {
		return (
			securityVaults[vault].repBackingUnits,
			securityVaults[vault].capacityOwnershipAttoRep,
			_getVaultBadDebtAttoEth(vault)
		);
	}
}
