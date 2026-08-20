// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SecurityVault, SystemState } from './interfaces/ISecurityPool.sol';

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
	mapping(address => uint256) public vaultBadDebtAttoEth;
	// Appended for delegatecall compatibility. Never reorder fields above this line.
	uint256 public minimumSecurityBondDebtAttoEth;
	uint256 public minimumVaultRepDepositAttoRep;
	/// @notice Latest target supplied with a positive REP deposit; metadata only, not aggregate vault health.
	mapping(address => uint256) public lastDepositTargetHealthFactorBpsByVault;
}
