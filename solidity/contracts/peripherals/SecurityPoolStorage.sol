// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SecurityVault, SystemState } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolStorage {
	EscalationGame public escalationGame;
	uint256 public totalCoverageCommitmentAttoEth;
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
	uint256 internal feeEligibleCoverageCommitmentAttoEth;
	uint256 internal uncheckpointedFeeEligibleCoverageCommitmentAttoEth;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;
	mapping(address => SecurityVault) public securityVaults;
	mapping(address => uint256) internal vaultFeeRemainders;
	address[] internal vaults;
	mapping(address => uint256) internal vaultIndexesPlusOne;
	uint256 internal activeVaultCount;
	address internal latestActiveVault;
	mapping(address => address) internal olderActiveVaults;
	mapping(address => address) internal newerActiveVaults;
	mapping(address => bool) internal isActiveVault;
	SystemState public systemState;
	uint256 public totalBadDebtAttoEth;
	mapping(address => uint256) public vaultBadDebtAttoEth;
}
