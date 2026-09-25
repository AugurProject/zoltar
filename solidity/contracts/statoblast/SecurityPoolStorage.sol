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
	uint256 internal activeObligationUnits;
	uint256 internal uncheckpointedActiveObligationUnits;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;
	mapping(address => SecurityVault) public securityVaults;
	mapping(uint256 => mapping(address => uint256)) internal vaultFeeRemainders;
	address[] internal vaultAddresses;
	mapping(address => bool) internal isKnownVault;
	SystemState public systemState;
	/// @dev Historical ETH written off, not a liability offset. writtenOffObligationUnits is authoritative.
	uint256 public totalBadDebtAttoEth;
	mapping(address => VaultBadDebt) internal vaultBadDebtByVault;
	// Appended for delegatecall compatibility. Never reorder fields above this line.
	uint256 public minimumSecurityBondDebtAttoEth;
	uint256 public minimumVaultRepDepositAttoRep;
	/// @dev Set only when this child initializes an inherited fork-continuation game whose terminal residual is burned.
	bool internal postEndVaultAdmissionAllowed;
	uint256 internal badDebtGeneration;
	/// @dev Initial pools use the question end; an activated child uses max until resolution or its next fork fixes the cutoff.
	uint256 internal feeEpochEndTime;
	mapping(address => uint256) public vaultTargetBackingFactorBps;

	struct CoverageOffer {
		bool enabled;
		uint256 maximumObligationAttoEth;
		uint256 minimumHealthFactorBps;
	}

	struct CoveragePosition {
		uint256 units;
		uint256 epoch;
	}

	uint256 public totalObligationUnits;
	uint256 public writtenOffObligationUnits;
	uint256 public unassignedObligationUnits;
	/// @dev Frozen parent positions moved into a child. Kept in the parent denominator.
	uint256 public migratedOutObligationUnits;
	mapping(address => CoverageOffer) public coverageOffers;
	mapping(address => CoveragePosition) internal coveragePositions;
	mapping(uint256 => uint256) public finalFeeIndexByEpoch;

	function getVaultObligationUnits(address vault) public view returns (uint256) {
		CoveragePosition storage position = coveragePositions[vault];
		return position.epoch == badDebtGeneration ? position.units : 0;
	}

	function _closeCoverageEpoch() internal {
		require(shareTokenSupplyAttoShares == 0 && settlementCollateralAttoEth == 0, 'Economic claims remain');
		finalFeeIndexByEpoch[badDebtGeneration] = feeIndex;
		totalObligationUnits = 0;
		writtenOffObligationUnits = 0;
		unassignedObligationUnits = 0;
		migratedOutObligationUnits = 0;
		activeObligationUnits = 0;
		uncheckpointedActiveObligationUnits = 0;
		feeIndexRemainder = 0;
		totalFeesOwedRemainder = 0;
		totalBadDebtAttoEth = 0;
		badDebtGeneration++;
	}

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
