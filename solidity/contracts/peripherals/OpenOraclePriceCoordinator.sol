// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { LiquidationApprovalRegistry } from './LiquidationApprovalRegistry.sol';

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
uint256 constant PRICE_PRECISION = 1e18;
uint256 constant MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes;
uint256 constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
uint8 constant OPEN_ORACLE_FLAG_TIME_TYPE = 1 << 0;
uint8 constant OPEN_ORACLE_FLAG_TRACK_DISPUTES = 1 << 1;
uint8 constant OPEN_ORACLE_FLAG_STORE_ALL = 1 << 2;
uint256 constant FINAL_REPORT_UNECONOMIC = 0;
uint256 constant FINAL_REPORT_PROFITABLE = 1;
uint256 constant FINAL_REPORT_COUNTER_SATURATED = 2;

interface IStoredOpenOracleGame {
	function storedGame(
		uint256 reportId
	)
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
	WithdrawRep
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
	uint256 operationAmountAttoRepOrAttoEth;
	uint256 queuedAt;
	uint256 validForSeconds;
	uint256 snapshotTargetBackingUnits;
	uint256 snapshotTargetCapacityOwnershipAttoRep;
	uint256 snapshotTargetOpenInterestAttoEth;
	uint256 snapshotTargetDisputeStakedAttoRep;
	uint256 snapshotTotalPoolHeldAttoRep;
	uint256 snapshotTotalRepBackingUnits;
	bytes32 liquidationApprovalId;
	uint256 reservedLiquidationDebtAttoEth;
}

contract OpenOraclePriceCoordinator {
	uint256 public constant MAX_PENDING_SETTLEMENT_OPERATIONS = 4;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
	string private constant STAGED_OPERATION_EXECUTION_OK = '';
	string private constant STAGED_OPERATION_ERROR_EXPIRED = 'staged operation expired';
	string private constant STAGED_OPERATION_ERROR_STALE_LIQUIDATION = 'stale liquidation';
	string private constant STAGED_OPERATION_ERROR_ZERO_WITHDRAW = 'withdraw amount has no effect';
	string private constant STAGED_OPERATION_ERROR_PANIC = 'Panic';
	string private constant STAGED_OPERATION_ERROR_UNKNOWN = 'Unknown error';
	uint256 public pendingReportId;
	address public pendingReportSponsor;
	uint256 public pendingOperationSlotId;
	uint256 public lastSettlementTimestamp;
	uint256 public lastPrice; // (REP * PRICE_PRECISION) / ETH;
	ReputationToken public immutable reputationToken;
	ISecurityPool public securityPool;
	OpenOracle public immutable openOracle;
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable gasUnitsForOneDispute;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable targetPriceErrorForDispute;
	uint256 public immutable openOracleSecurityMultiplierBps;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	bool public immutable timeType;
	bool public immutable trackDisputes;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public immutable minLiquidationPriceDistanceBps;
	uint256 public pendingReportMaxSettlementBaseFeeAttoEthPerGas;
	LiquidationApprovalRegistry public liquidationApprovalRegistry;
	address private immutable coordinatorFactory;

	event SecurityPoolSet(ISecurityPool indexed securityPool);
	event RepEthPriceSet(uint256 price);
	event PriceRequested(uint256 indexed reportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas);
	event PriceReportRejected(
		uint256 indexed reportId,
		string reason,
		uint256 pendingReportId,
		uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp
	);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PendingReportRecovered(
		uint256 indexed reportId,
		uint256 settlementTimestamp,
		uint256 pendingReportId,
		uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp
	);
	event LiquidationRouteStaged(
		uint256 indexed operationId,
		address indexed operator,
		address indexed receiverVault,
		address targetVault,
		bytes32 approvalId,
		uint256 requestedDebtAttoEth,
		uint256 reservedDebtAttoEth
	);
	event StagedOperationQueued(
		uint256 indexed operationId,
		OperationType operation,
		address indexed operator,
		address indexed targetVault,
		uint256 operationAmountAttoRepOrAttoEth,
		uint256 queuedAt,
		uint256 validForSeconds,
		uint256 snapshotTargetBackingUnits,
		uint256 snapshotTargetCapacityOwnershipAttoRep,
		uint256 snapshotTargetOpenInterestAttoEth,
		uint256 snapshotTargetDisputeStakedAttoRep,
		uint256 snapshotTotalPoolHeldAttoRep,
		uint256 snapshotTotalRepBackingUnits,
		bool isPendingSlot
	);
	event ExecutedStagedOperation(
		uint256 indexed operationId,
		OperationType operation,
		bool success,
		string errorMessage
	);
	/// @notice Authoritative operation-governing and report state after a coordinator mutation.
	/// REP/ETH prices use 1e18 precision. The base-fee field uses attoETH.
	event CoordinatorStateCheckpoint(
		CoordinatorCheckpointReason reason,
		uint256 indexed reportId,
		uint256 indexed operationId,
		uint256 pendingReportId,
		address pendingReportSponsor,
		uint256 pendingOperationSlotId,
		uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp,
		uint256 stagedOperationCounter,
		uint256 activeStagedOperationCount,
		uint256 pendingSettlementOperationCount
	);

	// This is not a FIFO queue. We keep append-only operation records plus a bounded
	// pending settlement list that auto-executes once a fresh oracle price arrives.
	// Active-operation paging is newest-first so UI previews remain stable after
	// execution removes older entries from the set.
	uint256 public stagedOperationCounter;
	mapping(uint256 => StagedOperation) public stagedOperations;
	uint256 private activeStagedOperationCount;
	uint256 private latestActiveStagedOperationId;
	mapping(uint256 => uint256) private olderActiveStagedOperationIds;
	mapping(uint256 => uint256) private newerActiveStagedOperationIds;
	mapping(uint256 => bool) private isActiveStagedOperation;
	uint256[] private pendingSettlementOperationIds;

	constructor(
		OpenOracle _openOracle,
		ReputationToken _reputationToken,
		IWeth9 _weth,
		uint256 _gasConsumedOpenOracleReportPrice,
		uint32 _gasConsumedSettlement,
		uint256 _gasUnitsForOneDispute,
		uint256 _initialReportPriorityFeeAttoEthPerGas,
		uint256 _targetPriceErrorForDispute,
		uint256 _openOracleSecurityMultiplierBps,
		uint48 _settlementTime,
		uint24 _disputeDelay,
		uint24 _protocolFee,
		uint24 _feePercentage,
		uint16 _multiplier,
		bool _timeType,
		bool _trackDisputes,
		address _protocolFeeRecipient,
		uint256 _escalationHaltMultiplierBps,
		uint256 _maxSettlementBaseFeeMultiplierBps,
		uint256 _minLiquidationPriceDistanceBps
	) {
		coordinatorFactory = msg.sender;
		reputationToken = _reputationToken;
		openOracle = _openOracle;
		weth = _weth;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		require(_gasUnitsForOneDispute > 0, 'Dispute gas units zero');
		require(_initialReportPriorityFeeAttoEthPerGas > 0, 'Initial priority fee zero');
		require(
			_targetPriceErrorForDispute <= OPEN_ORACLE_PERCENTAGE_PRECISION,
			'Target price error cannot exceed one hundred percent'
		);
		require(
			_openOracleSecurityMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR,
			'Open Oracle Security multiplier must be at least one hundred percent'
		);
		require(
			uint256(_protocolFee) + uint256(_feePercentage) < _targetPriceErrorForDispute,
			'Oracle fees must be below the target price error'
		);
		require(_escalationHaltMultiplierBps > 0, 'Escalation multiplier zero');
		require(
			_openOracleSecurityMultiplierBps <=
				type(uint256).max / (OPEN_ORACLE_PERCENTAGE_PRECISION + _targetPriceErrorForDispute),
			'Open Oracle Security multiplier is too large'
		);
		uint256 correctionProfitNumerator =
			_targetPriceErrorForDispute - uint256(_protocolFee) - uint256(_feePercentage);
		uint256 reportNumeratorMultiplier =
			_openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + _targetPriceErrorForDispute);
		uint256 reportDenominator = SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator;
		uint256 maximumPriorityFeeReportAttoEth = Math.mulDiv(
			type(uint128).max,
			SecurityPoolUtils.BPS_DENOMINATOR,
			_escalationHaltMultiplierBps
		);
		if (maximumPriorityFeeReportAttoEth > type(uint128).max) maximumPriorityFeeReportAttoEth = type(uint128).max;
		maximumPriorityFeeReportAttoEth /= 2;
		uint256 maximumPriorityDisputeGasCost = Math.mulDiv(
			maximumPriorityFeeReportAttoEth,
			reportDenominator,
			reportNumeratorMultiplier
		);
		uint256 maximumInitialReportPriorityFeeAttoEthPerGas = maximumPriorityDisputeGasCost / _gasUnitsForOneDispute;
		require(
			_initialReportPriorityFeeAttoEthPerGas <= maximumInitialReportPriorityFeeAttoEthPerGas,
			'Initial report priority fee exceeds OpenOracle limits'
		);
		gasUnitsForOneDispute = _gasUnitsForOneDispute;
		initialReportPriorityFeeAttoEthPerGas = _initialReportPriorityFeeAttoEthPerGas;
		targetPriceErrorForDispute = _targetPriceErrorForDispute;
		openOracleSecurityMultiplierBps = _openOracleSecurityMultiplierBps;
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		timeType = _timeType;
		require(_trackDisputes);
		trackDisputes = _trackDisputes;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		require(
			_maxSettlementBaseFeeMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR,
			'Max settlement base fee multiplier must be at least one hundred percent'
		);
		require(
			_minLiquidationPriceDistanceBps <= SecurityPoolUtils.BPS_DENOMINATOR,
			'Minimum liquidation price distance cannot exceed one hundred percent'
		);
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	function setLiquidationApprovalRegistry(LiquidationApprovalRegistry registry) external {
		require(
			msg.sender == coordinatorFactory &&
				address(liquidationApprovalRegistry) == address(0) &&
				address(registry) != address(0),
			'Registry setup invalid'
		);
		liquidationApprovalRegistry = registry;
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'Security pool already set');
		securityPool = _securityPool;
		emit SecurityPoolSet(securityPool);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.SecurityPoolSetup, 0, 0);
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'Only security pool');
		lastPrice = _lastPrice;
		emit RepEthPriceSet(lastPrice);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceSeeded, 0, 0);
	}

	function getRequestPriceCostAttoEth() public view returns (uint256) {
		return block.basefee * 4 * (getSettlementCallbackGasLimit() + gasConsumedOpenOracleReportPrice) + 101;
	}

	function getQueuedOperationCostAttoEth() public pure returns (uint256) {
		return 0;
	}

	function getSettlementCallbackGasLimit() public view returns (uint32) {
		uint256 callbackGasLimit = uint256(gasConsumedSettlement) * MAX_PENDING_SETTLEMENT_OPERATIONS;
		require(callbackGasLimit <= type(uint32).max, 'Callback gas exceeds uint32');
		return uint32(callbackGasLimit);
	}

	function minimumToken1ReportAttoEth() public view returns (uint256) {
		uint256 priorityFeeReportAttoEth = _minimumToken1ReportAttoEthForGasPrice(
			initialReportPriorityFeeAttoEthPerGas
		);
		uint256 baseFeeReportAttoEth = _minimumToken1ReportAttoEthForGasPrice(block.basefee);
		uint256 openInterestReportAttoEth =
			address(securityPool) == address(0x0)
				? 0
				: Math.ceilDiv(securityPool.settlementCollateralAttoEth(), OPEN_INTEREST_DIVIDER);
		uint256 dynamicReportAttoEth =
			baseFeeReportAttoEth > openInterestReportAttoEth ? baseFeeReportAttoEth : openInterestReportAttoEth;
		uint256 minimumReportAttoEth = priorityFeeReportAttoEth + dynamicReportAttoEth;
		return minimumReportAttoEth > 0 ? minimumReportAttoEth : 1;
	}

	function _minimumToken1ReportAttoEthForGasPrice(uint256 gasPriceAttoEthPerGas) private view returns (uint256) {
		if (gasPriceAttoEthPerGas == 0) return 0;
		uint256 disputeGasCost = Math.mulDiv(gasPriceAttoEthPerGas, gasUnitsForOneDispute, 1);
		uint256 correctionProfitNumerator = targetPriceErrorForDispute - uint256(protocolFee) - uint256(feePercentage);
		return
			Math.mulDiv(
				disputeGasCost,
				openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute),
				SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator,
				Math.Rounding.Ceil
			);
	}

	function requestPrice(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) public payable {
		uint256 costAttoEth = getRequestPriceCostAttoEth();
		require(msg.value >= costAttoEth, 'Oracle bounty too small');
		require(!isPriceValid(), 'Oracle price already fresh');
		_requestPrice(msg.sender, costAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);

		uint256 excess = msg.value - costAttoEth;
		if (excess > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: excess }('');
			require(sent, 'Oracle coordinator failed to refund excess ETH bounty');
		}
	}

	function _requestPrice(
		address sponsor,
		uint256 costAttoEth,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialAttoWeth
	) private {
		require(pendingReportId == 0, 'Oracle request already pending');
		require(proposedRepPerEthPrice > 0, 'Initial oracle price zero');
		uint256 minimumWethReportAttoEth = minimumToken1ReportAttoEth();
		uint256 initialWethReportAttoEth =
			requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth;
		uint256 initialRepReportAttoRep = Math.mulDiv(
			initialWethReportAttoEth,
			proposedRepPerEthPrice,
			PRICE_PRECISION,
			Math.Rounding.Ceil
		);
		uint256 escalationHaltAttoEth = Math.mulDiv(
			initialWethReportAttoEth,
			escalationHaltMultiplierBps,
			SecurityPoolUtils.BPS_DENOMINATOR
		);
		uint256 openInterestEscalationHaltAttoEth = Math.ceilDiv(
			securityPool.settlementCollateralAttoEth(),
			OPEN_INTEREST_DIVIDER
		);
		if (openInterestEscalationHaltAttoEth > escalationHaltAttoEth)
			escalationHaltAttoEth = openInterestEscalationHaltAttoEth;
		uint256 settlerRewardAttoEth = costAttoEth;
		require(initialWethReportAttoEth <= type(uint128).max, 'WETH report exceeds uint128');
		require(initialRepReportAttoRep <= type(uint128).max, 'REP report exceeds uint128');
		require(escalationHaltAttoEth <= type(uint128).max, 'Oracle escalation halt amount exceeds uint128 maximum');
		require(settlerRewardAttoEth <= type(uint96).max, 'Oracle settler reward exceeds uint96 maximum');
		pendingReportMaxSettlementBaseFeeAttoEthPerGas =
			(block.basefee * maxSettlementBaseFeeMultiplierBps) / SecurityPoolUtils.BPS_DENOMINATOR;

		uint8 flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES;
		if (timeType) flags |= OPEN_ORACLE_FLAG_TIME_TYPE;
		OpenOracle.OracleGame memory reportParams = OpenOracle.OracleGame({
			currentAmount1: uint128(initialWethReportAttoEth),
			currentAmount2: uint128(initialRepReportAttoRep),
			currentReporter: address(this),
			reportTimestamp: 0,
			settlementTimestamp: 0,
			token1: address(weth),
			lastReportOppoTime: 0,
			settlementTime: settlementTime,
			escalationHalt: uint128(escalationHaltAttoEth),
			protocolFeeRecipient: protocolFeeRecipient,
			settlerReward: uint96(settlerRewardAttoEth),
			token2: address(reputationToken),
			numReports: 0,
			disputeDelay: disputeDelay,
			feePercentage: feePercentage,
			multiplier: multiplier,
			callbackContract: address(this),
			callbackGasLimit: getSettlementCallbackGasLimit(),
			protocolFee: protocolFee,
			flags: flags
		});

		pendingReportSponsor = sponsor;
		require(
			weth.transferFrom(sponsor, address(this), initialWethReportAttoEth),
			'WETH transfer for initial report failed'
		);
		require(
			reputationToken.transferFrom(sponsor, address(this), initialRepReportAttoRep),
			'REP transfer for initial report failed'
		);
		require(weth.approve(address(openOracle), initialWethReportAttoEth), 'WETH approval for initial report failed');
		require(
			reputationToken.approve(address(openOracle), initialRepReportAttoRep),
			'REP approval for initial report failed'
		);
		pendingReportId = openOracle.report{ value: costAttoEth }(
			reportParams,
			false,
			false,
			OpenOracle.TimingBoundaries({
				blockNumber: 0,
				blockNumberBound: 0,
				blockTimestamp: 0,
				blockTimestampBound: 0
			})
		);
		emit PriceRequested(pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRequested, pendingReportId, 0);
	}

	function recoverSettledPendingReport() public {
		uint256 reportId = pendingReportId;
		require(reportId != 0, 'No report to recover');
		(, , , , uint48 settlementTimestamp) = IStoredOpenOracleGame(address(openOracle)).storedGame(reportId);
		require(settlementTimestamp != 0, 'Report not settled');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		_failPendingSettlementOperations('Report recovered');
		emit PendingReportRecovered(
			reportId,
			settlementTimestamp,
			pendingReportId,
			pendingReportMaxSettlementBaseFeeAttoEthPerGas,
			lastPrice,
			lastSettlementTimestamp
		);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PendingReportRecovered, reportId, 0);
	}

	function openOracleCallback(
		uint256 reportId,
		uint256 amount1,
		uint256 amount2,
		uint256,
		address,
		address
	) external {
		require(msg.sender == address(openOracle), 'Only OpenOracle');
		require(reportId == pendingReportId, 'Oracle report mismatch');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		uint256 maxSettlementBaseFeeAttoEthPerGas = pendingReportMaxSettlementBaseFeeAttoEthPerGas;
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		if (block.basefee > maxSettlementBaseFeeAttoEthPerGas) {
			_rejectReportAndPendingOperations(reportId, 'Base fee too high');
			return;
		}
		uint256 finalReportDisputeStatus = _getFinalReportDisputeStatus(reportId, amount1);
		if (finalReportDisputeStatus != FINAL_REPORT_PROFITABLE) {
			_rejectReportAndPendingOperations(
				reportId,
				finalReportDisputeStatus == FINAL_REPORT_COUNTER_SATURATED ? 'Counter saturated' : 'Report uneconomic'
			);
			return;
		}
		if (amount1 == 0 || amount2 == 0) {
			_rejectReportAndPendingOperations(reportId, 'Empty oracle settlement');
			return;
		}
		uint256 price = Math.mulDiv(amount2, PRICE_PRECISION, amount1);
		if (price == 0) {
			_rejectReportAndPendingOperations(reportId, 'Oracle price is zero');
			return;
		}
		lastSettlementTimestamp = block.timestamp;
		lastPrice = price;
		securityPool.updateRetentionRate();
		emit PriceReported(reportId, lastPrice, lastSettlementTimestamp);
		if (pendingSettlementOperationIds.length != 0) {
			uint256[] memory operationIds = pendingSettlementOperationIds;
			delete pendingSettlementOperationIds;
			pendingOperationSlotId = 0;
			for (uint256 index = 0; index < operationIds.length; index++) {
				if (stagedOperations[operationIds[index]].operator != address(0)) {
					executeStagedOperation(operationIds[index]);
				}
			}
		}
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceReported, reportId, 0);
	}

	function _rejectReportAndPendingOperations(uint256 reportId, string memory reason) private {
		_emitPriceReportRejected(reportId, reason);
		_failPendingSettlementOperations(reason);
	}

	function _failPendingSettlementOperations(string memory reason) private {
		uint256[] memory operationIds = pendingSettlementOperationIds;
		delete pendingSettlementOperationIds;
		pendingOperationSlotId = 0;
		for (uint256 index = 0; index < operationIds.length; index++) {
			uint256 operationId = operationIds[index];
			StagedOperation memory stagedOperation = stagedOperations[operationId];
			if (stagedOperation.operator == address(0)) continue;
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
		}
	}

	function _getFinalReportDisputeStatus(uint256 reportId, uint256 finalAmount1) private view returns (uint256) {
		(, , , , , , , , , , , , uint24 numReports, , , , , , , ) = openOracle.storedGame(reportId);
		if (numReports == type(uint24).max) return FINAL_REPORT_COUNTER_SATURATED;
		if (numReports == 0) return FINAL_REPORT_UNECONOMIC;
		(, , uint128 finalReportBaseFee, ) = openOracle.disputeHistory(reportId, numReports - 1);
		uint256 minimumProfitableReportAttoEth =
			_minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas) +
				_minimumToken1ReportAttoEthForGasPrice(uint256(finalReportBaseFee));
		return finalAmount1 >= minimumProfitableReportAttoEth ? FINAL_REPORT_PROFITABLE : FINAL_REPORT_UNECONOMIC;
	}

	function _withdrawOpenOracleReporterBalances(address sponsor) private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}

	function _emitPriceReportRejected(uint256 reportId, string memory reason) private {
		emit PriceReportRejected(
			reportId,
			reason,
			pendingReportId,
			pendingReportMaxSettlementBaseFeeAttoEthPerGas,
			lastPrice,
			lastSettlementTimestamp
		);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRejected, reportId, 0);
	}

	function isPriceValid() public view returns (bool) {
		return
			lastPrice > 0 &&
			lastSettlementTimestamp != 0 &&
			lastSettlementTimestamp + PRICE_VALID_FOR_SECONDS > block.timestamp;
	}

	function requestPriceIfNeededAndStageOperation(
		OperationType operation,
		address targetVault,
		uint256 operationAmountAttoRepOrAttoEth,
		uint256 validForSeconds,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialAttoWeth
	) public payable {
		_requestPriceIfNeededAndStageOperation(
			operation,
			targetVault,
			msg.sender,
			bytes32(0),
			operationAmountAttoRepOrAttoEth,
			validForSeconds,
			proposedRepPerEthPrice,
			requestedInitialAttoWeth
		);
	}

	function requestPriceIfNeededAndStageLiquidation(
		address targetVault,
		address receiverVault,
		uint256 requestedDebtAttoEth,
		bytes32 approvalId,
		uint256 validForSeconds,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialAttoWeth
	) external payable {
		_requestPriceIfNeededAndStageOperation(
			OperationType.Liquidation,
			targetVault,
			receiverVault,
			approvalId,
			requestedDebtAttoEth,
			validForSeconds,
			proposedRepPerEthPrice,
			requestedInitialAttoWeth
		);
	}

	function _requestPriceIfNeededAndStageOperation(
		OperationType operation,
		address targetVault,
		address receiverVault,
		bytes32 approvalId,
		uint256 operationAmountAttoRepOrAttoEth,
		uint256 validForSeconds,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialAttoWeth
	) private {
		require(operationAmountAttoRepOrAttoEth > 0, 'Staged operation amount must be non-zero');
		require(validForSeconds > 0, 'Staged operation timeout must be positive');
		require(
			validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS,
			'Staged operation timeout exceeds the maximum allowed'
		);
		if (operation != OperationType.Liquidation) {
			require(targetVault == msg.sender, 'Self operation target mismatch');
			require(receiverVault == msg.sender && approvalId == bytes32(0), 'Self route mismatch');
		} else {
			require(receiverVault != targetVault, 'Receiver is target');
		}
		require(
			!securityPool.isEscalationResolved(),
			'question already resolved, so staged operations are unavailable'
		);
		if (pendingReportId != 0) {
			require(
				msg.sender == pendingReportSponsor,
				'Only the pending report sponsor can queue more operations until settlement'
			);
		}
		if (operation == OperationType.WithdrawRep) {
			(, uint256 withdrawRepAmountAttoRep) = _previewWithdrawRep(msg.sender, operationAmountAttoRepOrAttoEth);
			require(withdrawRepAmountAttoRep > 0, 'Withdraw amount has no effect');
		}
		stagedOperationCounter++;
		uint256 operationId = stagedOperationCounter;
		// Capture the complete target collateral bundle at queue time. Any later target
		// REP backing unit or capacity ownership mutation invalidates the quote so a
		// rescue deposit can never become part of the liquidator's purchase. Non-liquidation operations keep
		// the snapshot for history and execution-event context, but price validity no
		// longer meters operations by snapshot or live external-value exposure.
		// Liquidation should value the vault's full collateral claim. That means using the
		// pool's total REP balance here rather than only the currently withdrawable balance.
		(uint256 snapshotTargetBackingUnits, uint256 snapshotTargetCapacityOwnershipAttoRep, , ) = securityPool
			.securityVaults(targetVault);
		uint256 snapshotTargetOpenInterestAttoEth = securityPool.getVaultOpenInterestAttoEth(targetVault);
		uint256 snapshotTotalPoolHeldAttoRep = securityPool.getTotalPoolHeldAttoRep();
		uint256 snapshotTotalRepBackingUnits = securityPool.totalRepBackingUnits();
		uint256 snapshotTargetDisputeStakedAttoRep =
			operation == OperationType.Liquidation && address(securityPool.escalationGame()) != address(0x0)
				? securityPool.escalationGame().disputeStakedRepByVaultAttoRep(targetVault)
				: 0;
		uint256 reservedLiquidationDebtAttoEth;
		if (operation == OperationType.Liquidation && receiverVault != msg.sender) {
			reservedLiquidationDebtAttoEth = liquidationApprovalRegistry.reserve(
				operationId,
				approvalId,
				receiverVault,
				targetVault,
				msg.sender,
				operationAmountAttoRepOrAttoEth,
				snapshotTargetOpenInterestAttoEth,
				block.timestamp + uint256(settlementTime) + validForSeconds
			);
		} else if (operation == OperationType.Liquidation) {
			require(approvalId == bytes32(0), 'Self approval must be zero');
		}
		stagedOperations[operationId] = StagedOperation({
			operation: operation,
			operator: msg.sender,
			receiverVault: receiverVault,
			targetVault: targetVault,
			operationAmountAttoRepOrAttoEth: operationAmountAttoRepOrAttoEth,
			queuedAt: block.timestamp,
			validForSeconds: validForSeconds,
			snapshotTargetBackingUnits: snapshotTargetBackingUnits,
			snapshotTargetCapacityOwnershipAttoRep: snapshotTargetCapacityOwnershipAttoRep,
			snapshotTargetOpenInterestAttoEth: snapshotTargetOpenInterestAttoEth,
			snapshotTargetDisputeStakedAttoRep: snapshotTargetDisputeStakedAttoRep,
			snapshotTotalPoolHeldAttoRep: snapshotTotalPoolHeldAttoRep,
			snapshotTotalRepBackingUnits: snapshotTotalRepBackingUnits,
			liquidationApprovalId: approvalId,
			reservedLiquidationDebtAttoEth: reservedLiquidationDebtAttoEth
		});
		_trackActiveStagedOperation(operationId);
		if (operation == OperationType.Liquidation) {
			emit LiquidationRouteStaged(
				operationId,
				msg.sender,
				receiverVault,
				targetVault,
				approvalId,
				operationAmountAttoRepOrAttoEth,
				reservedLiquidationDebtAttoEth
			);
		}

		uint256 retained = 0; // amount to retain from msg.value (cost incurred)

		if (isPriceValid()) {
			_emitStagedOperationQueued(operationId, false);
			executeStagedOperation(operationId);
			// no cost when price is valid
		} else {
			bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds.length == 0;
			bool isPendingSettlementOperationId = _trackPendingSettlementOperation(operationId);
			_emitStagedOperationQueued(operationId, isPendingSettlementOperationId);
			if (shouldRequestPrice && isPendingSettlementOperationId) {
				uint256 costAttoEth = getRequestPriceCostAttoEth();
				require(msg.value >= costAttoEth, 'Not enough ETH was provided to request a fresh oracle price');
				retained += costAttoEth;
				_requestPrice(msg.sender, costAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);
			}
		}

		// Refund the excess of msg.value that was not retained
		uint256 refund = msg.value - retained;
		if (refund > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: refund }('');
			require(sent, 'Oracle coordinator failed to return unused ETH');
		}
	}

	function executeStagedOperation(uint256 operationId) public {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
			_consumeAndEmitExecutedStagedOperation(
				operationId,
				stagedOperation.operation,
				false,
				STAGED_OPERATION_ERROR_EXPIRED
			);
			return;
		}
		require(isPriceValid(), 'Valid oracle price required');
		if (stagedOperation.operation == OperationType.Liquidation) {
			(uint256 currentTargetBackingUnits, uint256 currentTargetCapacityOwnershipAttoRep, , ) = securityPool
				.securityVaults(stagedOperation.targetVault);
			if (
				currentTargetBackingUnits != stagedOperation.snapshotTargetBackingUnits ||
				currentTargetCapacityOwnershipAttoRep != stagedOperation.snapshotTargetCapacityOwnershipAttoRep
			) {
				_consumeAndEmitExecutedStagedOperation(
					operationId,
					stagedOperation.operation,
					false,
					STAGED_OPERATION_ERROR_STALE_LIQUIDATION
				);
				return;
			}
		}
		if (stagedOperation.operation == OperationType.WithdrawRep && !_hasWithdrawEffect(stagedOperation)) {
			_consumeAndEmitExecutedStagedOperation(
				operationId,
				stagedOperation.operation,
				false,
				STAGED_OPERATION_ERROR_ZERO_WITHDRAW
			);
			return;
		}
		if (stagedOperation.operation == OperationType.Liquidation) {
			_executeLiquidationStagedOperation(operationId, stagedOperation);
		} else {
			_executeWithdrawRepStagedOperation(operationId, stagedOperation);
		}
	}

	function expireStagedOperation(uint256 operationId) external {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		require(
			block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds,
			'Staged operation active'
		);
		_consumeAndEmitExecutedStagedOperation(
			operationId,
			stagedOperation.operation,
			false,
			STAGED_OPERATION_ERROR_EXPIRED
		);
	}

	function _emitExecutedStagedOperation(
		uint256 operationId,
		OperationType operation,
		bool success,
		string memory errorMessage
	) private {
		emit ExecutedStagedOperation(operationId, operation, success, errorMessage);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationExecuted, 0, operationId);
	}

	function _consumeAndEmitExecutedStagedOperation(
		uint256 operationId,
		OperationType operation,
		bool success,
		string memory errorMessage
	) private {
		_consumeStagedOperation(operationId);
		_emitExecutedStagedOperation(operationId, operation, success, errorMessage);
	}

	function _completeExecutedStagedOperation(uint256 operationId, OperationType operation) private {
		_emitExecutedStagedOperation(operationId, operation, true, STAGED_OPERATION_EXECUTION_OK);
	}

	function _emitExecutedStagedOperationFailure(
		uint256 operationId,
		OperationType operation,
		string memory reason
	) private {
		_emitExecutedStagedOperation(operationId, operation, false, reason);
	}

	function _executeLiquidationStagedOperation(uint256 operationId, StagedOperation memory stagedOperation) private {
		uint256 minimumHealthFactorBps = SecurityPoolUtils.BPS_DENOMINATOR;
		uint256 maximumDebtAttoEth = stagedOperation.operationAmountAttoRepOrAttoEth;
		if (stagedOperation.liquidationApprovalId != bytes32(0)) {
			minimumHealthFactorBps = liquidationApprovalRegistry.minimumHealthFactorBps(operationId);
			maximumDebtAttoEth = stagedOperation.reservedLiquidationDebtAttoEth;
		}
		try
			securityPool.performLiquidation(
				operationId,
				stagedOperation.operator,
				stagedOperation.receiverVault,
				stagedOperation.targetVault,
				maximumDebtAttoEth,
				stagedOperation.snapshotTargetBackingUnits,
				stagedOperation.snapshotTargetCapacityOwnershipAttoRep,
				stagedOperation.snapshotTotalPoolHeldAttoRep,
				stagedOperation.snapshotTotalRepBackingUnits,
				minimumHealthFactorBps,
				minLiquidationPriceDistanceBps
			)
		returns (uint256 debtMovedAttoEth, uint256, uint256) {
			if (stagedOperation.liquidationApprovalId != bytes32(0))
				require(debtMovedAttoEth <= stagedOperation.reservedLiquidationDebtAttoEth, 'Debt exceeds reservation');
			liquidationApprovalRegistry.consume(operationId, debtMovedAttoEth);
			_deleteStagedOperation(operationId);
			_completeExecutedStagedOperation(operationId, stagedOperation.operation);
		} catch Error(string memory reason) {
			_consumeStagedOperation(operationId);
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, reason);
		} catch Panic(uint256) {
			_consumeStagedOperation(operationId);
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_PANIC);
		} catch (bytes memory) {
			_consumeStagedOperation(operationId);
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_UNKNOWN);
		}
	}

	function _executeWithdrawRepStagedOperation(uint256 operationId, StagedOperation memory stagedOperation) private {
		_consumeStagedOperation(operationId);
		try
			securityPool.withdrawRepFromVault(stagedOperation.operator, stagedOperation.operationAmountAttoRepOrAttoEth)
		{
			_completeExecutedStagedOperation(operationId, stagedOperation.operation);
		} catch Error(string memory reason) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, reason);
		} catch Panic(uint256) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_PANIC);
		} catch (bytes memory) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_UNKNOWN);
		}
	}

	function _emitStagedOperationQueued(uint256 operationId, bool isPendingSlot) private {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		emit StagedOperationQueued(
			operationId,
			stagedOperation.operation,
			stagedOperation.operator,
			stagedOperation.targetVault,
			stagedOperation.operationAmountAttoRepOrAttoEth,
			stagedOperation.queuedAt,
			stagedOperation.validForSeconds,
			stagedOperation.snapshotTargetBackingUnits,
			stagedOperation.snapshotTargetCapacityOwnershipAttoRep,
			stagedOperation.snapshotTargetOpenInterestAttoEth,
			stagedOperation.snapshotTargetDisputeStakedAttoRep,
			stagedOperation.snapshotTotalPoolHeldAttoRep,
			stagedOperation.snapshotTotalRepBackingUnits,
			isPendingSlot
		);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationQueued, pendingReportId, operationId);
	}

	function _emitCoordinatorStateCheckpoint(
		CoordinatorCheckpointReason reason,
		uint256 reportId,
		uint256 operationId
	) private {
		emit CoordinatorStateCheckpoint(
			reason,
			reportId,
			operationId,
			pendingReportId,
			pendingReportSponsor,
			pendingOperationSlotId,
			pendingReportMaxSettlementBaseFeeAttoEthPerGas,
			lastPrice,
			lastSettlementTimestamp,
			stagedOperationCounter,
			activeStagedOperationCount,
			pendingSettlementOperationIds.length
		);
	}

	function _previewWithdrawRep(
		address vault,
		uint256 attoRepAmount
	) private view returns (uint256 withdrawBackingUnits, uint256 withdrawRepAmountAttoRep) {
		if (attoRepAmount == 0) return (0, 0);
		(uint256 vaultBackingUnits, , , ) = securityPool.securityVaults(vault);
		uint256 backingUnitsToWithdraw = securityPool.attoRepToBackingUnits(attoRepAmount);
		uint256 minimumRemainingBackingUnits = securityPool.attoRepToBackingUnits(
			securityPool.minimumVaultRepDepositAttoRep()
		);
		withdrawBackingUnits =
			backingUnitsToWithdraw + minimumRemainingBackingUnits > vaultBackingUnits
				? vaultBackingUnits
				: backingUnitsToWithdraw;
		withdrawRepAmountAttoRep = securityPool.backingUnitsToAttoRep(withdrawBackingUnits);
	}

	function _hasWithdrawEffect(StagedOperation memory stagedOperation) private view returns (bool) {
		(, uint256 withdrawRepAmountAttoRep) = _previewWithdrawRep(
			stagedOperation.operator,
			stagedOperation.operationAmountAttoRepOrAttoEth
		);
		return withdrawRepAmountAttoRep > 0;
	}

	function _consumeStagedOperation(uint256 operationId) private {
		liquidationApprovalRegistry.release(operationId);
		_deleteStagedOperation(operationId);
	}

	function _deleteStagedOperation(uint256 operationId) private {
		_consumePendingSettlementOperation(operationId);
		_consumeActiveStagedOperation(operationId);
		stagedOperations[operationId].operator = address(0);
	}

	function getPendingOperationSlot() public view returns (StagedOperation memory) {
		return stagedOperations[pendingOperationSlotId];
	}

	function getActiveStagedOperationCount() public view returns (uint256) {
		return activeStagedOperationCount;
	}

	function getPendingSettlementOperationCount() public view returns (uint256) {
		return pendingSettlementOperationIds.length;
	}

	function getPendingSettlementOperationIds() public view returns (uint256[] memory) {
		return pendingSettlementOperationIds;
	}

	function getActiveStagedOperations(
		uint256 startIndex,
		uint256 count
	) public view returns (uint256[] memory operationIds, StagedOperation[] memory operations) {
		if (count == 0 || startIndex >= activeStagedOperationCount) {
			return (new uint256[](0), new StagedOperation[](0));
		}
		uint256 availableCount = activeStagedOperationCount - startIndex;
		uint256 resultCount = count < availableCount ? count : availableCount;
		operationIds = new uint256[](resultCount);
		operations = new StagedOperation[](resultCount);
		uint256 operationId = latestActiveStagedOperationId;
		for (uint256 skipped = 0; skipped < startIndex && operationId != 0; skipped++) {
			operationId = olderActiveStagedOperationIds[operationId];
		}
		for (uint256 index = 0; index < resultCount && operationId != 0; index++) {
			operationIds[index] = operationId;
			operations[index] = stagedOperations[operationId];
			operationId = olderActiveStagedOperationIds[operationId];
		}
	}

	function _trackActiveStagedOperation(uint256 operationId) private {
		if (isActiveStagedOperation[operationId]) return;
		isActiveStagedOperation[operationId] = true;
		activeStagedOperationCount++;
		if (latestActiveStagedOperationId != 0) {
			olderActiveStagedOperationIds[operationId] = latestActiveStagedOperationId;
			newerActiveStagedOperationIds[latestActiveStagedOperationId] = operationId;
		}
		latestActiveStagedOperationId = operationId;
	}

	function _trackPendingSettlementOperation(uint256 operationId) private returns (bool) {
		if (pendingSettlementOperationIds.length >= MAX_PENDING_SETTLEMENT_OPERATIONS) return false;
		pendingSettlementOperationIds.push(operationId);
		if (pendingOperationSlotId == 0) {
			pendingOperationSlotId = operationId;
		}
		return true;
	}

	function _consumePendingSettlementOperation(uint256 operationId) private {
		uint256 operationCount = pendingSettlementOperationIds.length;
		for (uint256 index = 0; index < operationCount; index++) {
			if (pendingSettlementOperationIds[index] != operationId) continue;
			for (uint256 shiftIndex = index + 1; shiftIndex < operationCount; shiftIndex++) {
				pendingSettlementOperationIds[shiftIndex - 1] = pendingSettlementOperationIds[shiftIndex];
			}
			pendingSettlementOperationIds.pop();
			pendingOperationSlotId = pendingSettlementOperationIds.length == 0 ? 0 : pendingSettlementOperationIds[0];
			return;
		}
	}

	function _consumeActiveStagedOperation(uint256 operationId) private {
		if (!isActiveStagedOperation[operationId]) return;
		uint256 olderOperationId = olderActiveStagedOperationIds[operationId];
		uint256 newerOperationId = newerActiveStagedOperationIds[operationId];
		if (newerOperationId != 0) {
			olderActiveStagedOperationIds[newerOperationId] = olderOperationId;
		} else {
			latestActiveStagedOperationId = olderOperationId;
		}
		if (olderOperationId != 0) {
			newerActiveStagedOperationIds[olderOperationId] = newerOperationId;
		}
		delete olderActiveStagedOperationIds[operationId];
		delete newerActiveStagedOperationIds[operationId];
		delete isActiveStagedOperation[operationId];
		activeStagedOperationCount--;
	}
}
