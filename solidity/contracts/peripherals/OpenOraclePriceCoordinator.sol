// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { OpenOraclePriceCandidateVerifier } from './OpenOraclePriceCandidateVerifier.sol';

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
uint256 constant PRICE_PRECISION = 1e18;
uint256 constant MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes;
uint256 constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
uint8 constant OPEN_ORACLE_FLAG_TIME_TYPE = 1 << 0;
uint8 constant OPEN_ORACLE_FLAG_TRACK_DISPUTES = 1 << 1;
uint8 constant OPEN_ORACLE_FLAG_STORE_ALL = 1 << 2;

interface IStoredOpenOracleGame {
	function finalizedGame(
		uint256 reportId
	)
		external
		view
		returns (
			uint128 currentAmount1,
			uint128 currentAmount2,
			address currentReporter,
			uint48 reportTimestamp,
			uint48 settlementTimestamp,
			address token1,
			uint48 lastReportOppoTime,
			uint48 settlementTime
		);
}

enum OperationType {
	Liquidation,
	WithdrawRep,
	SetSecurityBondsAllowance
}

enum CoordinatorCheckpointReason {
	SecurityPoolSetup,
	PriceSeeded,
	PriceRequested,
	PriceReported,
	PriceRejected,
	PendingReportRecovered,
	OperationQueued,
	OperationExecuted,
	CandidateStaged
}

struct SettledPriceCandidate {
	uint256 reportId;
	uint128 amount1;
	uint128 amount2;
	uint48 reportTimestamp;
	uint48 settlementTimestamp;
	uint48 lastReportBlock;
	uint48 settlementTime;
}

struct StagedOperation {
	OperationType operation;
	address initiatorVault;
	address targetVault;
	uint256 amount;
	uint256 queuedAt;
	uint256 validForSeconds;
	uint256 snapshotTargetOwnership;
	uint256 snapshotTargetAllowance;
	uint256 snapshotTotalRep;
	uint256 snapshotDenominator;
}

contract OpenOraclePriceCoordinator {
	uint256 public constant MAX_PENDING_SETTLEMENT_OPERATIONS = 1;
	string private constant STAGED_OPERATION_EXECUTION_OK = '';
	string private constant STAGED_OPERATION_ERROR_EXPIRED = 'staged operation expired';
	string private constant STAGED_OPERATION_ERROR_STALE_LIQUIDATION = 'stale liquidation';
	string private constant STAGED_OPERATION_ERROR_ZERO_WITHDRAW = 'withdraw amount has no effect';
	string private constant STAGED_OPERATION_ERROR_MIN_LIQUIDATION_DISTANCE = 'liquidation too close to threshold';
	string private constant STAGED_OPERATION_ERROR_REPORT_SECURITY = 'operation exposure exceeds report security';
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
	OpenOraclePriceCandidateVerifier public immutable candidateVerifier;
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable gasUnitsForOneDispute;
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
	uint256 public immutable minLiquidationPriceDistanceBps;
	uint256 public immutable minimumTotalGasPriceWei;
	uint256 public immutable minimumPriorityFeeWei;
	uint256 public immutable absoluteInclusionPremiumWei;
	uint256 public immutable absoluteMinimumWethReport;
	uint256 public immutable economicOpportunityBlockCount;
	uint256 public immutable candidateProofWindowBlocks;
	uint256 public immutable gasUnitsForPriceFinalization;
	SettledPriceCandidate public settledPriceCandidate;
	uint256 public candidateFinalizerReward;
	uint256 public availableWethExposure;
	uint256 public availableRepExposure;
	uint256 public lastAcceptedReportId;

	event SecurityPoolSet(ISecurityPool indexed securityPool);
	event RepEthPriceSet(uint256 price);
	event PriceRequested(uint256 indexed reportId);
	event PriceReportRejected(
		uint256 indexed reportId,
		string reason,
		uint256 pendingReportId,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp
	);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PriceCandidateStaged(
		uint256 indexed reportId,
		uint256 amount1,
		uint256 amount2,
		uint256 reportTimestamp,
		uint256 settlementTimestamp,
		uint256 lastReportBlock,
		uint256 settlementTime,
		uint256 finalizerReward
	);
	event PriceCandidateFinalized(
		uint256 indexed reportId,
		bool accepted,
		uint256 availableCorrectionProfitWeth,
		uint256 requiredCorrectionProfitWeth,
		string rejectionReason
	);
	event PriceConsumed(uint256 indexed reportId, uint256 wethCapacity, uint256 repCapacity);
	event PendingReportRecovered(
		uint256 indexed reportId,
		uint256 settlementTimestamp,
		uint256 pendingReportId,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp
	);
	event PendingOperationRecoveryConsumed(uint256 indexed operationId, OperationType operation);
	event StagedOperationQueued(
		uint256 indexed operationId,
		OperationType operation,
		address indexed initiatorVault,
		address indexed targetVault,
		uint256 amount,
		uint256 queuedAt,
		uint256 validForSeconds,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator,
		bool isPendingSlot
	);
	event ExecutedStagedOperation(
		uint256 indexed operationId,
		OperationType operation,
		bool success,
		string errorMessage
	);
	/// @notice Authoritative operation-governing and report state after a coordinator mutation.
	/// REP/ETH prices use 1e18 precision.
	event CoordinatorStateCheckpoint(
		CoordinatorCheckpointReason reason,
		uint256 indexed reportId,
		uint256 indexed operationId,
		uint256 pendingReportId,
		uint256 candidateReportId,
		address pendingReportSponsor,
		uint256 pendingOperationSlotId,
		uint256 lastPrice,
		uint256 lastSettlementTimestamp,
		uint256 lastAcceptedReportId,
		uint256 availableWethExposure,
		uint256 availableRepExposure,
		uint256 stagedOperationCounter,
		uint256 activeStagedOperationCount,
		uint256 pendingSettlementOperationCount
	);

	// This is not a FIFO queue. We keep append-only operation records plus a bounded
	// pending settlement list whose operation can execute after candidate finalization.
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
		OpenOraclePriceCandidateVerifier _candidateVerifier,
		uint256 _gasConsumedOpenOracleReportPrice,
		uint32 _gasConsumedSettlement,
		uint256 _gasUnitsForOneDispute,
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
		uint256 _minLiquidationPriceDistanceBps,
		uint256 _minimumTotalGasPriceWei,
		uint256 _minimumPriorityFeeWei,
		uint256 _absoluteInclusionPremiumWei,
		uint256 _absoluteMinimumWethReport,
		uint256 _economicOpportunityBlockCount,
		uint256 _candidateProofWindowBlocks,
		uint256 _gasUnitsForPriceFinalization
	) {
		reputationToken = _reputationToken;
		openOracle = _openOracle;
		weth = _weth;
		candidateVerifier = _candidateVerifier;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		gasUnitsForOneDispute = _gasUnitsForOneDispute;
		targetPriceErrorForDispute = _targetPriceErrorForDispute;
		openOracleSecurityMultiplierBps = _openOracleSecurityMultiplierBps;
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		timeType = _timeType;
		trackDisputes = _trackDisputes;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
		minimumTotalGasPriceWei = _minimumTotalGasPriceWei;
		minimumPriorityFeeWei = _minimumPriorityFeeWei;
		absoluteInclusionPremiumWei = _absoluteInclusionPremiumWei;
		absoluteMinimumWethReport = _absoluteMinimumWethReport;
		economicOpportunityBlockCount = _economicOpportunityBlockCount;
		candidateProofWindowBlocks = _candidateProofWindowBlocks;
		gasUnitsForPriceFinalization = _gasUnitsForPriceFinalization;
	}

	function candidateReportId() public view returns (uint256) {
		return settledPriceCandidate.reportId;
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'Security pool already set');
		securityPool = _securityPool;
		emit SecurityPoolSet(securityPool);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.SecurityPoolSetup, 0, 0);
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'Security pool only');
		lastPrice = _lastPrice;
		emit RepEthPriceSet(lastPrice);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceSeeded, 0, 0);
	}

	function getRequestPriceEthCost() public view returns (uint256) {
		return _getOpenOracleSettlerReward(block.basefee) + _getPriceFinalizerReward(block.basefee);
	}

	function getQueuedOperationEthCost() public pure returns (uint256) {
		return 0;
	}

	function getSettlementCallbackGasLimit() public view returns (uint32) {
		uint256 callbackGasLimit = uint256(gasConsumedSettlement) * MAX_PENDING_SETTLEMENT_OPERATIONS;
		require(callbackGasLimit <= type(uint32).max, 'Callback gas limit too high');
		return uint32(callbackGasLimit);
	}

	function minimumToken1Report() public view returns (uint256) {
		uint256 disputeGasCost = _modeledInclusionCost(block.basefee, gasUnitsForOneDispute);
		uint256 correctionProfitNumerator = targetPriceErrorForDispute - uint256(protocolFee) - uint256(feePercentage);
		uint256 calculatedMinimum = Math.mulDiv(
			disputeGasCost,
			openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute),
			SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator,
			Math.Rounding.Ceil
		);
		return calculatedMinimum > absoluteMinimumWethReport ? calculatedMinimum : absoluteMinimumWethReport;
	}

	function _modeledGasPrice(uint256 baseFee) private view returns (uint256) {
		uint256 baseFeePlusPriority = baseFee + minimumPriorityFeeWei;
		return baseFeePlusPriority > minimumTotalGasPriceWei ? baseFeePlusPriority : minimumTotalGasPriceWei;
	}

	function _modeledInclusionCost(uint256 baseFee, uint256 gasUnits) private view returns (uint256) {
		return Math.mulDiv(_modeledGasPrice(baseFee), gasUnits, 1) + absoluteInclusionPremiumWei;
	}

	function _getOpenOracleSettlerReward(uint256 baseFee) private view returns (uint256) {
		return
			Math.mulDiv(
				_modeledGasPrice(baseFee),
				4 * (uint256(getSettlementCallbackGasLimit()) + gasConsumedOpenOracleReportPrice),
				1
			) +
			absoluteInclusionPremiumWei +
			101;
	}

	function _getPriceFinalizerReward(uint256 baseFee) private view returns (uint256) {
		return _modeledInclusionCost(baseFee, gasUnitsForPriceFinalization);
	}

	function requestPrice(uint256 proposedRepPerEthPrice, uint256 requestedInitialWeth) public payable {
		uint256 ethCost = getRequestPriceEthCost();
		require(msg.value >= ethCost, 'ETH bounty below request cost');
		require(!isPriceUsable(), 'Fresh oracle price exists');
		require(candidateReportId() == 0, 'Price candidate awaiting validation');
		_requestPrice(msg.sender, ethCost, proposedRepPerEthPrice, requestedInitialWeth);

		uint256 excess = msg.value - ethCost;
		if (excess > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: excess }('');
			require(sent, 'Excess ETH refund failed');
		}
	}

	function _requestPrice(
		address sponsor,
		uint256 ethCost,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialWeth
	) private {
		require(pendingReportId == 0, 'Price request already pending');
		require(candidateReportId() == 0, 'Price candidate awaiting validation');
		require(proposedRepPerEthPrice > 0, 'Proposed REP/ETH price is zero');
		uint256 minimumWethReport = minimumToken1Report();
		uint256 initialWethReport = requestedInitialWeth > minimumWethReport ? requestedInitialWeth : minimumWethReport;
		uint256 amount2 = Math.mulDiv(initialWethReport, proposedRepPerEthPrice, PRICE_PRECISION, Math.Rounding.Ceil);
		uint256 escalationHalt = Math.mulDiv(
			initialWethReport,
			escalationHaltMultiplierBps,
			SecurityPoolUtils.BPS_DENOMINATOR
		);
		uint256 finalizerReward = _getPriceFinalizerReward(block.basefee);
		uint256 settlerReward = ethCost - finalizerReward;
		require(initialWethReport <= type(uint128).max, 'Initial WETH exceeds uint128');
		require(amount2 <= type(uint128).max, 'Initial REP exceeds uint128');
		require(escalationHalt <= type(uint128).max, 'Escalation halt exceeds uint128');
		require(settlerReward <= type(uint96).max, 'Settler reward exceeds uint96');
		uint8 flags = OPEN_ORACLE_FLAG_STORE_ALL;
		if (timeType) flags |= OPEN_ORACLE_FLAG_TIME_TYPE;
		if (trackDisputes) flags |= OPEN_ORACLE_FLAG_TRACK_DISPUTES;
		OpenOracle.OracleGame memory reportParams = OpenOracle.OracleGame({
			currentAmount1: uint128(initialWethReport),
			currentAmount2: uint128(amount2),
			currentReporter: address(this),
			reportTimestamp: 0,
			settlementTimestamp: 0,
			token1: address(weth),
			lastReportOppoTime: 0,
			settlementTime: settlementTime,
			escalationHalt: uint128(escalationHalt),
			protocolFeeRecipient: protocolFeeRecipient,
			settlerReward: uint96(settlerReward),
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
		candidateFinalizerReward = finalizerReward;
		require(weth.transferFrom(sponsor, address(this), initialWethReport), 'Initial WETH transfer failed');
		require(reputationToken.transferFrom(sponsor, address(this), amount2), 'Initial REP transfer failed');
		require(weth.approve(address(openOracle), initialWethReport), 'Initial WETH approval failed');
		require(reputationToken.approve(address(openOracle), amount2), 'Initial REP approval failed');
		pendingReportId = openOracle.report{ value: settlerReward }(
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
		emit PriceRequested(pendingReportId);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRequested, pendingReportId, 0);
	}

	function recoverSettledPendingReport() public {
		uint256 reportId = pendingReportId;
		require(reportId != 0, 'No pending report to recover');
		(
			uint128 amount1,
			uint128 amount2,
			,
			uint48 reportTimestamp,
			uint48 settlementTimestamp,
			,
			uint48 lastReportBlock,
			uint48 gameSettlementTime
		) = IStoredOpenOracleGame(address(openOracle)).finalizedGame(reportId);
		require(settlementTimestamp != 0, 'Pending report not settled');
		_stageSettledCandidate(
			reportId,
			amount1,
			amount2,
			reportTimestamp,
			settlementTimestamp,
			lastReportBlock,
			gameSettlementTime
		);
		emit PendingReportRecovered(reportId, settlementTimestamp, pendingReportId, lastPrice, lastSettlementTimestamp);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PendingReportRecovered, reportId, 0);
	}

	function openOracleCallback(
		uint256 reportId,
		uint256 amount1,
		uint256 amount2,
		uint256 settlementTimestamp,
		address,
		address
	) external {
		require(msg.sender == address(openOracle), 'OpenOracle callback only');
		require(reportId == pendingReportId, 'Callback report ID mismatch');
		(
			uint128 storedAmount1,
			uint128 storedAmount2,
			,
			uint48 reportTimestamp,
			uint48 storedSettlementTimestamp,
			,
			uint48 lastReportBlock,
			uint48 gameSettlementTime
		) = IStoredOpenOracleGame(address(openOracle)).finalizedGame(reportId);
		require(amount1 == storedAmount1 && amount2 == storedAmount2, 'Callback amounts mismatch');
		require(settlementTimestamp == storedSettlementTimestamp, 'Callback settlement time mismatch');
		_stageSettledCandidate(
			reportId,
			storedAmount1,
			storedAmount2,
			reportTimestamp,
			storedSettlementTimestamp,
			lastReportBlock,
			gameSettlementTime
		);
	}

	function _stageSettledCandidate(
		uint256 reportId,
		uint128 amount1,
		uint128 amount2,
		uint48 reportTimestamp,
		uint48 settlementTimestamp,
		uint48 lastReportBlock,
		uint48 gameSettlementTime
	) private {
		require(candidateReportId() == 0, 'Price candidate already pending');
		require(reportId == pendingReportId, 'Candidate report ID mismatch');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		settledPriceCandidate = SettledPriceCandidate({
			reportId: reportId,
			amount1: amount1,
			amount2: amount2,
			reportTimestamp: reportTimestamp,
			settlementTimestamp: settlementTimestamp,
			lastReportBlock: lastReportBlock,
			settlementTime: gameSettlementTime
		});
		emit PriceCandidateStaged(
			reportId,
			amount1,
			amount2,
			reportTimestamp,
			settlementTimestamp,
			lastReportBlock,
			gameSettlementTime,
			candidateFinalizerReward
		);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.CandidateStaged, reportId, 0);
	}

	function finalizeSettledPrice(bytes[] calldata opportunityHeaders, bytes calldata firstClosedHeader) external {
		SettledPriceCandidate memory candidate = settledPriceCandidate;
		require(candidate.reportId != 0, 'No price candidate to finalize');
		(
			uint256 availableWeth,
			uint256 availableRep,
			uint256 maximumRequiredProfit,
			bool sufficientEconomics
		) = candidateVerifier.verify(
				OpenOraclePriceCandidateVerifier.Candidate({
					amount1: candidate.amount1,
					amount2: candidate.amount2,
					reportTimestamp: candidate.reportTimestamp,
					settlementTimestamp: candidate.settlementTimestamp,
					lastReportBlock: candidate.lastReportBlock,
					settlementTime: candidate.settlementTime
				}),
				OpenOraclePriceCandidateVerifier.Configuration({
					disputeDelay: disputeDelay,
					opportunityBlockCount: economicOpportunityBlockCount,
					gasUnitsForOneDispute: gasUnitsForOneDispute,
					targetPriceError: targetPriceErrorForDispute,
					protocolFee: protocolFee,
					reporterFee: feePercentage,
					percentagePrecision: OPEN_ORACLE_PERCENTAGE_PRECISION,
					securityMultiplierBps: openOracleSecurityMultiplierBps,
					minimumTotalGasPriceWei: minimumTotalGasPriceWei,
					minimumPriorityFeeWei: minimumPriorityFeeWei,
					absoluteInclusionPremiumWei: absoluteInclusionPremiumWei
				}),
				opportunityHeaders,
				firstClosedHeader
			);
		uint256 candidatePrice =
			candidate.amount1 == 0 ? 0 : Math.mulDiv(candidate.amount2, PRICE_PRECISION, candidate.amount1);
		string memory rejectionReason;
		if (candidate.amount1 == 0 || candidate.amount2 == 0 || candidatePrice == 0) {
			rejectionReason = 'Invalid candidate price';
		} else if (uint256(candidate.settlementTimestamp) + PRICE_VALID_FOR_SECONDS <= block.timestamp) {
			rejectionReason = 'Candidate price expired';
		} else if (!sufficientEconomics) {
			rejectionReason = 'Insufficient dispute economics';
		}
		bool accepted = bytes(rejectionReason).length == 0;
		uint256 reportId = candidate.reportId;
		delete settledPriceCandidate;
		uint256 finalizerReward = candidateFinalizerReward;
		candidateFinalizerReward = 0;
		if (accepted) {
			lastAcceptedReportId = reportId;
			lastSettlementTimestamp = candidate.settlementTimestamp;
			lastPrice = candidatePrice;
			availableWethExposure = availableWeth;
			availableRepExposure = availableRep;
			emit PriceReported(reportId, lastPrice, lastSettlementTimestamp);
		} else {
			_emitPriceReportRejected(reportId, rejectionReason);
		}
		emit PriceCandidateFinalized(reportId, accepted, availableWeth, maximumRequiredProfit, rejectionReason);
		_payFinalizer(msg.sender, finalizerReward);
		if (accepted) _emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceReported, reportId, 0);
	}

	function rejectExpiredPriceCandidate() external {
		SettledPriceCandidate memory candidate = settledPriceCandidate;
		require(candidate.reportId != 0, 'No price candidate to reject');
		require(
			block.number > uint256(candidate.lastReportBlock) + candidateProofWindowBlocks ||
				block.timestamp >= uint256(candidate.settlementTimestamp) + PRICE_VALID_FOR_SECONDS,
			'Candidate proof window open'
		);
		delete settledPriceCandidate;
		uint256 finalizerReward = candidateFinalizerReward;
		candidateFinalizerReward = 0;
		_emitPriceReportRejected(candidate.reportId, 'Candidate proof window expired');
		_payFinalizer(msg.sender, finalizerReward);
	}

	function _payFinalizer(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = payable(recipient).call{ value: amount }('');
		require(sent, 'Finalizer payment failed');
	}

	function _withdrawOpenOracleReporterBalances(address sponsor) private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}

	function _emitPriceReportRejected(uint256 reportId, string memory reason) private {
		emit PriceReportRejected(reportId, reason, pendingReportId, lastPrice, lastSettlementTimestamp);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRejected, reportId, 0);
	}

	function isPriceValid() public view returns (bool) {
		return
			lastPrice > 0 &&
			lastSettlementTimestamp != 0 &&
			lastSettlementTimestamp + PRICE_VALID_FOR_SECONDS > block.timestamp;
	}

	function isPriceUsable() public view returns (bool) {
		return isPriceValid() && (availableWethExposure > 0 || availableRepExposure > 0);
	}

	function requestPriceIfNeededAndStageOperation(
		OperationType operation,
		address targetVault,
		uint256 amount,
		uint256 validForSeconds,
		uint256 proposedRepPerEthPrice,
		uint256 requestedInitialWeth
	) public payable {
		if (operation != OperationType.SetSecurityBondsAllowance) {
			require(amount > 0, 'Staged amount is zero');
		}
		require(validForSeconds > 0, 'Staged timeout is zero');
		require(validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'Staged timeout too long');
		if (operation != OperationType.Liquidation) {
			require(targetVault == msg.sender, 'Self operation target mismatch');
		} else {
			require(targetVault != msg.sender, 'Caller bad');
		}
		require(!securityPool.isEscalationResolved(), 'Question already resolved');
		if (pendingReportId != 0) {
			require(msg.sender == pendingReportSponsor, 'Pending report sponsor only');
		}
		if (operation == OperationType.WithdrawRep) {
			(, uint256 withdrawRepAmount) = _previewWithdrawRep(msg.sender, amount);
			require(withdrawRepAmount > 0, 'Withdraw amount has no effect');
		}
		stagedOperationCounter++;
		uint256 operationId = stagedOperationCounter;
		// Capture the target vault state at queue time. Liquidation may still execute if
		// the target deposits more REP after staging, but allowance changes or ownership
		// decreases make a liquidation snapshot stale. Non-liquidation operations keep
		// the snapshot for history, exposure calculation, and execution-event context.
		// Liquidation should value the vault's full collateral claim. That means using the
		// pool's total REP balance here rather than only the currently withdrawable balance.
		(uint256 snapshotTargetOwnership, uint256 snapshotTargetAllowance, , ) = securityPool.securityVaults(
			targetVault
		);
		uint256 snapshotTotalRep = securityPool.getTotalRepBalance();
		uint256 snapshotDenominator = securityPool.poolOwnershipDenominator();
		stagedOperations[operationId] = StagedOperation({
			operation: operation,
			initiatorVault: msg.sender,
			targetVault: targetVault,
			amount: amount,
			queuedAt: block.timestamp,
			validForSeconds: validForSeconds,
			snapshotTargetOwnership: snapshotTargetOwnership,
			snapshotTargetAllowance: snapshotTargetAllowance,
			snapshotTotalRep: snapshotTotalRep,
			snapshotDenominator: snapshotDenominator
		});
		_trackActiveStagedOperation(operationId);

		uint256 retained = 0; // amount to retain from msg.value (cost incurred)

		if (isPriceUsable()) {
			_emitStagedOperationQueued(operationId, false);
			executeStagedOperation(operationId);
			// no cost when price is valid
		} else {
			bool shouldRequestPrice =
				pendingReportId == 0 && candidateReportId() == 0 && pendingSettlementOperationIds.length == 0;
			bool isPendingSettlementOperationId = _trackPendingSettlementOperation(operationId);
			_emitStagedOperationQueued(operationId, isPendingSettlementOperationId);
			if (shouldRequestPrice && isPendingSettlementOperationId) {
				uint256 ethCost = getRequestPriceEthCost();
				require(msg.value >= ethCost, 'ETH bounty below request cost');
				retained += ethCost;
				_requestPrice(msg.sender, ethCost, proposedRepPerEthPrice, requestedInitialWeth);
			}
		}

		// Refund the excess of msg.value that was not retained
		uint256 refund = msg.value - retained;
		if (refund > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: refund }('');
			require(sent, 'Unused ETH refund failed');
		}
	}

	function executeStagedOperation(uint256 operationId) public {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.initiatorVault != address(0), 'Staged operation unavailable');
		require(isPriceUsable(), 'Fresh oracle price required');
		if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
			_consumeAndEmitExecutedStagedOperation(
				operationId,
				stagedOperation.operation,
				false,
				STAGED_OPERATION_ERROR_EXPIRED
			);
			return;
		}
		if (stagedOperation.operation == OperationType.Liquidation) {
			(uint256 currentTargetOwnership, uint256 currentTargetAllowance, , ) = securityPool.securityVaults(
				stagedOperation.targetVault
			);
			if (
				currentTargetOwnership < stagedOperation.snapshotTargetOwnership ||
				currentTargetAllowance != stagedOperation.snapshotTargetAllowance
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
			if (!_isLiquidationBeyondMinPriceDistance(stagedOperation)) {
				_consumeAndEmitExecutedStagedOperation(
					operationId,
					stagedOperation.operation,
					false,
					STAGED_OPERATION_ERROR_MIN_LIQUIDATION_DISTANCE
				);
				return;
			}
		}
		if (!_isOperationWithinReportSecurity(stagedOperation)) {
			_consumeAndEmitExecutedStagedOperation(
				operationId,
				stagedOperation.operation,
				false,
				STAGED_OPERATION_ERROR_REPORT_SECURITY
			);
			return;
		}
		if (stagedOperation.operation == OperationType.Liquidation) {
			_executeLiquidationStagedOperation(operationId, stagedOperation);
		} else if (stagedOperation.operation == OperationType.WithdrawRep) {
			_executeWithdrawRepStagedOperation(operationId, stagedOperation);
		} else {
			_executeSetSecurityBondAllowanceStagedOperation(operationId, stagedOperation);
		}
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
		_consumeAcceptedPrice();
		_emitExecutedStagedOperation(operationId, operation, true, STAGED_OPERATION_EXECUTION_OK);
	}

	function _isOperationWithinReportSecurity(StagedOperation memory stagedOperation) private view returns (bool) {
		uint256 wethExposure;
		uint256 repExposure;
		if (stagedOperation.operation == OperationType.SetSecurityBondsAllowance) {
			if (stagedOperation.amount > stagedOperation.snapshotTargetAllowance) {
				wethExposure = stagedOperation.amount - stagedOperation.snapshotTargetAllowance;
			}
		} else if (stagedOperation.operation == OperationType.WithdrawRep) {
			(, repExposure) = _previewWithdrawRep(stagedOperation.initiatorVault, stagedOperation.amount);
		} else {
			wethExposure = stagedOperation.amount;
		}
		return wethExposure <= availableWethExposure && repExposure <= availableRepExposure;
	}

	function _consumeAcceptedPrice() private {
		emit PriceConsumed(lastAcceptedReportId, availableWethExposure, availableRepExposure);
		availableWethExposure = 0;
		availableRepExposure = 0;
	}

	function _emitExecutedStagedOperationFailure(
		uint256 operationId,
		OperationType operation,
		string memory reason
	) private {
		_emitExecutedStagedOperation(operationId, operation, false, reason);
	}

	function _executeLiquidationStagedOperation(uint256 operationId, StagedOperation memory stagedOperation) private {
		_consumeStagedOperation(operationId);
		try
			securityPool.performLiquidation(
				stagedOperation.initiatorVault,
				stagedOperation.targetVault,
				stagedOperation.amount,
				stagedOperation.snapshotTargetOwnership,
				stagedOperation.snapshotTargetAllowance,
				stagedOperation.snapshotTotalRep,
				stagedOperation.snapshotDenominator
			)
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

	function _executeWithdrawRepStagedOperation(uint256 operationId, StagedOperation memory stagedOperation) private {
		_consumeStagedOperation(operationId);
		try securityPool.performWithdrawRep(stagedOperation.initiatorVault, stagedOperation.amount) {
			_completeExecutedStagedOperation(operationId, stagedOperation.operation);
		} catch Error(string memory reason) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, reason);
		} catch Panic(uint256) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_PANIC);
		} catch (bytes memory) {
			_emitExecutedStagedOperationFailure(operationId, stagedOperation.operation, STAGED_OPERATION_ERROR_UNKNOWN);
		}
	}

	function _executeSetSecurityBondAllowanceStagedOperation(
		uint256 operationId,
		StagedOperation memory stagedOperation
	) private {
		_consumeStagedOperation(operationId);
		try securityPool.performSetSecurityBondsAllowance(stagedOperation.initiatorVault, stagedOperation.amount) {
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
			stagedOperation.initiatorVault,
			stagedOperation.targetVault,
			stagedOperation.amount,
			stagedOperation.queuedAt,
			stagedOperation.validForSeconds,
			stagedOperation.snapshotTargetOwnership,
			stagedOperation.snapshotTargetAllowance,
			stagedOperation.snapshotTotalRep,
			stagedOperation.snapshotDenominator,
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
			candidateReportId(),
			pendingReportSponsor,
			pendingOperationSlotId,
			lastPrice,
			lastSettlementTimestamp,
			lastAcceptedReportId,
			availableWethExposure,
			availableRepExposure,
			stagedOperationCounter,
			activeStagedOperationCount,
			pendingSettlementOperationIds.length
		);
	}

	function _previewWithdrawRep(
		address vault,
		uint256 repAmount
	) private view returns (uint256 withdrawOwnership, uint256 withdrawRepAmount) {
		if (repAmount == 0) return (0, 0);
		(uint256 vaultOwnership, , , ) = securityPool.securityVaults(vault);
		uint256 ownershipToWithdraw = securityPool.repToPoolOwnership(repAmount);
		uint256 minimumRemainingOwnership = securityPool.repToPoolOwnership(SecurityPoolUtils.MIN_REP_DEPOSIT);
		withdrawOwnership =
			ownershipToWithdraw + minimumRemainingOwnership > vaultOwnership ? vaultOwnership : ownershipToWithdraw;
		withdrawRepAmount = securityPool.poolOwnershipToRep(withdrawOwnership);
	}

	function _hasWithdrawEffect(StagedOperation memory stagedOperation) private view returns (bool) {
		(, uint256 withdrawRepAmount) = _previewWithdrawRep(stagedOperation.initiatorVault, stagedOperation.amount);
		return withdrawRepAmount > 0;
	}

	function _getSnapshotVaultRep(StagedOperation memory stagedOperation) private pure returns (uint256) {
		if (stagedOperation.snapshotDenominator == 0) {
			return stagedOperation.snapshotTargetOwnership / PRICE_PRECISION;
		}
		return
			(stagedOperation.snapshotTargetOwnership * stagedOperation.snapshotTotalRep) /
			stagedOperation.snapshotDenominator;
	}

	function _isLiquidationBeyondMinPriceDistance(StagedOperation memory stagedOperation) private view returns (bool) {
		if (minLiquidationPriceDistanceBps == 0) return true;
		uint256 snapshotTargetAllowance = stagedOperation.snapshotTargetAllowance;
		if (snapshotTargetAllowance == 0) return false;
		uint256 currentPrice = lastPrice;
		if (currentPrice == 0) return false;
		uint256 vaultRep = _getSnapshotVaultRep(stagedOperation);
		uint256 securityMultiplier = securityPool.securityMultiplier();
		uint256 thresholdPrice = (vaultRep * PRICE_PRECISION) / (snapshotTargetAllowance * securityMultiplier);
		if (currentPrice <= thresholdPrice) return false;
		return
			((currentPrice - thresholdPrice) * SecurityPoolUtils.BPS_DENOMINATOR) / currentPrice >=
			minLiquidationPriceDistanceBps;
	}

	function _consumeStagedOperation(uint256 operationId) private {
		_consumePendingSettlementOperation(operationId);
		_consumeActiveStagedOperation(operationId);
		stagedOperations[operationId].initiatorVault = address(0);
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
