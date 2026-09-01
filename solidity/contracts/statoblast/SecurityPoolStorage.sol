// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SecurityVault, SystemState } from './interfaces/ISecurityPool.sol';

struct VaultBadDebt {
	uint256 badDebtAttoEth;
	uint256 generation;
}

abstract contract SecurityPoolStorage {
	EscalationGame public escalationGame;
	uint256 public totalCapacityOwnershipAttoRep;
	uint256 public settlementCollateralAttoEth;
	uint256 public totalRepBackingUnits;
	uint256 public statoblastSecurityMultiplierBps;
	uint256 public shareTokenSupplyAttoShares;
	uint256 public totalClaimableVaultFeesAttoEth;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 internal feeIndexRemainder;
	uint256 internal totalFeesOwedRemainder;
	uint256 internal unallocatedAccruedFeesAttoEth;
	uint256 internal feeEligibleCapacityOwnershipAttoRep;
	uint256 internal uncheckpointedFeeEligibleCapacityOwnershipAttoRep;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;
	mapping(address => SecurityVault) public securityVaults;
	mapping(address => uint256) internal vaultFeeRemainders;
	address[] internal vaultAddresses;
	mapping(address => bool) internal isKnownVault;
	SystemState public systemState;
	uint256 public totalBadDebtAttoEth;
	mapping(address => VaultBadDebt) internal vaultBadDebtByVault;
	// Appended for delegatecall compatibility. Never reorder fields above this line.
	uint256 public minimumSecurityBondDebtAttoEth;
	uint256 public minimumVaultRepDepositAttoRep;
	/// @notice Latest target supplied with a positive REP deposit; metadata only, not aggregate vault health.
	mapping(address => uint256) public lastDepositTargetHealthFactorBpsByVault;
	/// @dev Set only when this child initializes an inherited fork-continuation game whose terminal residual is burned.
	bool internal postEndVaultAdmissionAllowed;
	uint256 internal badDebtGeneration;

	function _getVaultBadDebtAttoEth(address vault) internal view returns (uint256 badDebtAttoEth) {
		VaultBadDebt storage vaultBadDebt = vaultBadDebtByVault[vault];
		if (vaultBadDebt.generation == badDebtGeneration) return vaultBadDebt.badDebtAttoEth;
		return 0;
	}

	function _setVaultBadDebtAttoEth(address vault, uint256 badDebtAttoEth) internal {
		VaultBadDebt storage vaultBadDebt = vaultBadDebtByVault[vault];
		vaultBadDebt.badDebtAttoEth = badDebtAttoEth;
		vaultBadDebt.generation = badDebtGeneration;
	}
}
