// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	LiquidationApprovalParams,
	LiquidationApprovalRegistry
} from '../../statoblast/LiquidationApprovalRegistry.sol';
import { IERC1271 } from '../../statoblast/SignatureValidation.sol';
import { SecurityPoolOperationsDelegate } from '../../statoblast/SecurityPoolOperationsDelegate.sol';
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

contract CoarseLiquidationRoundingHarness is SecurityPoolOperationsDelegate {
	function configureBadDebtParticipants(address targetVault, address receiverVault, uint256 targetBadDebtAttoEth, uint256 receiverBadDebtAttoEth) external {
		settlementCollateralAttoEth = 100;
		feeEligibleUnderwritingLimitAttoEth = 100;
		totalUnderwritingLimitAttoEth = 100;
		totalRepBackingUnits = 1_010;
		statoblastSecurityMultiplierBps = 20_000;
		minimumSecurityBondDebtAttoEth = 1;
		minimumVaultRepDepositAttoRep = 1;
		securityVaults[targetVault].repBackingUnits = 10;
		securityVaults[targetVault].underwritingLimitAttoEth = 50;
		securityVaults[receiverVault].repBackingUnits = 1_000;
		securityVaults[receiverVault].underwritingLimitAttoEth = 50;
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
		feeEligibleUnderwritingLimitAttoEth = 2;
		totalUnderwritingLimitAttoEth = 2;
		totalRepBackingUnits = 2;
		statoblastSecurityMultiplierBps = 30_000;
		securityVaults[targetVault].repBackingUnits = 2;
		securityVaults[targetVault].underwritingLimitAttoEth = 1;
		securityVaults[receiverVault].underwritingLimitAttoEth = 1;
	}

	function configurePositiveResidual(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 4;
		feeEligibleUnderwritingLimitAttoEth = 3;
		totalUnderwritingLimitAttoEth = 3;
		totalRepBackingUnits = 13;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 3;
		securityVaults[targetVault].underwritingLimitAttoEth = 1;
		securityVaults[receiverVault].repBackingUnits = 10;
		securityVaults[receiverVault].underwritingLimitAttoEth = 1;
	}

	function configureLiveLiquidationDistance(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 5;
		feeEligibleUnderwritingLimitAttoEth = 10;
		totalUnderwritingLimitAttoEth = 10;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		securityVaults[targetVault].underwritingLimitAttoEth = 10;
		securityVaults[receiverVault].repBackingUnits = 100;
	}

	function configureUnclaimedCapacity(address targetVault, address receiverVault) external {
		settlementCollateralAttoEth = 8;
		feeEligibleUnderwritingLimitAttoEth = 2;
		totalUnderwritingLimitAttoEth = 4;
		totalRepBackingUnits = 107;
		statoblastSecurityMultiplierBps = 20_000;
		securityVaults[targetVault].repBackingUnits = 7;
		securityVaults[targetVault].underwritingLimitAttoEth = 2;
		securityVaults[receiverVault].repBackingUnits = 100;
		securityVaults[receiverVault].underwritingLimitAttoEth = 1;
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
		uint256 grossOpenInterestAttoEth = SecurityPoolUtils.calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, securityVaults[vault].underwritingLimitAttoEth, totalUnderwritingLimitAttoEth);
		uint256 vaultBadDebtAttoEth = _getVaultBadDebtAttoEth(vault);
		return grossOpenInterestAttoEth > vaultBadDebtAttoEth ? grossOpenInterestAttoEth - vaultBadDebtAttoEth : 0;
	}

	function vaultState(address vault) external view returns (uint256 repBackingUnits, uint256 underwritingLimitAttoEth, uint256 badDebtAttoEth) {
		return (
			securityVaults[vault].repBackingUnits,
			securityVaults[vault].underwritingLimitAttoEth,
			_getVaultBadDebtAttoEth(vault)
		);
	}
}
