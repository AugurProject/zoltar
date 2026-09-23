// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
uint256 constant PRICE_PRECISION = 1e18;
uint256 constant MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes;
uint256 constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
// Keeps the request bounty strictly above the settlement gas product so the settler reward has a positive buffer.
uint256 constant REQUEST_BOUNTY_OFFSET_ATTO_ETH = 101;
uint8 constant OPEN_ORACLE_FLAG_TIME_TYPE = 1 << 0;
uint8 constant OPEN_ORACLE_FLAG_TRACK_DISPUTES = 1 << 1;
uint8 constant OPEN_ORACLE_FLAG_STORE_ALL = 1 << 2;

interface IStoredOpenOracleGame {
	function storedGame(uint256 reportId)
		external
		view
		returns (
			uint128 currentAmount1,
			uint128 currentAmount2,
			address currentReporter,
			uint48 reportTimestamp,
			uint48 settlementTimestamp
		);
}

enum OperationType {
	Liquidation,
	WithdrawRep,
	AdjustVaultBackingFactor
}

enum CoordinatorCheckpointReason {
	SecurityPoolSetup,
	PriceSeeded,
	PriceRequested,
	PriceReported,
	PriceRejected,
	PendingReportRecovered,
	OperationQueued,
	OperationExecuted
}

struct StagedOperation {
	OperationType operation;
	address operator;
	address receiverVault;
	address targetVault;
	uint256 operationValue;
	uint256 queuedAt;
	uint256 validForSeconds;
	uint256 snapshotTargetBackingUnits;
	uint256 snapshotTargetCapacityOwnershipAttoRep;
	bytes32 liquidationApprovalId;
	uint256 reservedLiquidationDebtAttoEth;
}

struct HistoricalQueueSnapshot {
	uint256 targetBackingUnits;
	uint256 targetCapacityOwnershipAttoRep;
	uint256 targetOpenInterestAttoEth;
	uint256 targetDisputeStakedAttoRep;
	uint256 totalPoolHeldAttoRep;
	uint256 totalRepBackingUnits;
}
