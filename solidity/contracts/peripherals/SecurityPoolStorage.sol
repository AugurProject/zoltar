// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { EscalationGame } from './EscalationGame.sol';
import { SecurityVault, SystemState } from './interfaces/ISecurityPool.sol';

abstract contract SecurityPoolStorage {
	EscalationGame public escalationGame;
	uint256 public totalSecurityBondAllowance;
	uint256 public completeSetCollateralAmount;
	uint256 public poolOwnershipDenominator;
	uint256 public statoblastSecurityMultiplierBps;
	uint256 public shareTokenSupply;
	uint256 public totalFeesOwedToVaults;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 internal feeIndexRemainder;
	uint256 internal totalFeesOwedRemainder;
	uint256 internal unallocatedFeeReserve;
	uint256 internal feeEligibleSecurityBondAllowance;
	uint256 internal uncheckpointedFeeEligibleAllowance;
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
}
