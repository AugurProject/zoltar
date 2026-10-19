// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioVault } from './SecurityPoolPortfolioVault.sol';
import { SecurityPoolPortfolioPosition } from './SecurityPoolPortfolioPosition.sol';

/// @dev Storage and events for common-reserve ownership, allocation custody and cash recovery.
abstract contract SecurityPoolPortfolioState {
	uint256 public maintenanceBudgetAttoEth;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => SecurityPoolPortfolioVault) public vaultOf;
	uint256[] internal questions;
	bool internal entered;
	WithdrawalRequest[] internal withdrawalRequests;
	uint256 public totalSupply;
	uint256 internal shareGeneration = 1;
	uint256 public ownershipVersion = 1;
	uint256 public idleRepAttoRep;
	uint256 internal feeIndex;
	uint256 public positionCount;
	mapping(uint256 => uint256) internal snapshotGenerations;
	mapping(uint256 => uint256) internal closedFeeIndexes;
	mapping(uint256 => mapping(address => uint256)) internal shareBalances;
	mapping(uint256 => mapping(address => Checkpoint[])) internal balanceCheckpoints;
	mapping(address => OwnerFees) internal ownerFees;
	mapping(uint256 => Position) public positions;
	mapping(uint256 => mapping(address => bool)) internal positionClaimed;
	mapping(address => address) internal positionSourcePools;
	mapping(uint256 => uint256) internal positionVersions;
	mapping(uint256 => uint256) internal reusablePositions;
	mapping(uint256 => bool) public positionRecoveryComplete;
	mapping(uint256 => uint256) internal sharedMigratedShares;
	mapping(uint256 => uint256) public recoveryBounties;
	mapping(address => uint256) public processingRewards;
	uint256 public recoveredRepAttoRep;
	uint256 public recoveredFeesAttoEth;

	struct EconomicsConfig {
		uint256 targetHealthFactorBps;
		uint256 purchaseFeeBps;
		uint256 minimumPurchaseFeeAttoEth;
		uint256 completionRewardAttoEth;
		uint256 ownershipChangeFeeAttoEth;
	}

	struct WithdrawalRequest {
		SecurityPoolPortfolioVault vault;
		uint256 requestId;
	}

	struct Checkpoint {
		uint256 snapshotId;
		uint256 shares;
	}

	struct OwnerFees {
		uint256 generation;
		uint256 index;
		uint256 accruedAttoEth;
	}

	struct Position {
		uint256 questionId;
		uint256 totalShares;
		uint256 remainingShares;
		SecurityPoolPortfolioPosition custody;
	}

	event QuestionRegistered(uint256 indexed questionId, bytes32 indexed originId, ISecurityPool indexed originPool);
	event VaultCreated(address indexed owner, SecurityPoolPortfolioVault indexed vault);
	event CompleteSetsFunded(uint256 indexed questionId, address indexed payer, address indexed recipient, uint256 amountAttoEth, uint256 mintedAttoShares);
	event PurchaseFeesPaid(uint256 indexed questionId, address indexed payer, uint256 feesAttoEth);
	event WithdrawalQueued(uint256 indexed index, SecurityPoolPortfolioVault indexed vault, uint256 requestId);
	event Deposited(address indexed owner, uint256 amountAttoRep, uint256 shares, uint256 generation);
	event Withdrawn(address indexed owner, uint256 shares, uint256 idleAttoRep, uint256 generation);
	event PositionAllocated(uint256 indexed questionId, uint256 indexed positionId, SecurityPoolPortfolioPosition indexed custody, uint256 shares, uint256 generation);
	event PositionRebalanced(uint256 indexed positionId, uint256 reserveRepAttoRep, uint256 reserveFeesAttoEth);
	event QuestionPositionClaimed(uint256 indexed positionId, address indexed owner, SecurityPoolPortfolioVault indexed vault, uint256 shares);
	event FeesClaimed(address indexed owner, uint256 amountAttoEth);
	event ShareGenerationStarted(uint256 indexed generation);
	event PositionRecovered(uint256 indexed positionId, uint256 repAttoRep, uint256 feesAttoEth, bool complete);
	event RecoveryCollected(address indexed owner, uint256 repAttoRep, uint256 feesAttoEth);
	event RecoveryRewardCredited(uint256 indexed positionId, address indexed processor, uint256 amountAttoEth);
	event OwnershipChangeFeePaid(address indexed owner, uint256 amountAttoEth);
	event MaintenanceRewardCredited(uint256 indexed positionId, address indexed processor, uint256 amountAttoEth);
	event RecoveryRedeposited(address indexed owner, uint256 repAttoRep, uint256 shares);
	event ReservePrecisionRolledOver(uint256 indexed positionId, uint256 indexed generation, uint256 residualAttoRep);

	function _sendEth(address recipient, uint256 amount) internal {
		if (amount == 0) return;
		(bool sent, ) = payable(recipient).call{value: amount}('');
		require(sent, 'ETH transfer failed');
	}

	/// @dev Accept custody fee payouts; callers explicitly account for the ownership of every receipt.
	receive() external payable {}
}
