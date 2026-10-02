// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool, LiquidationRequest, LiquidationSnapshot } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { LiquidationApprovalRegistry } from './LiquidationApprovalRegistry.sol';
import './OpenOraclePriceCoordinatorTypes.sol';
import { VaultOperations } from './VaultOperations.sol';

contract OpenOraclePriceCoordinator {
	uint256 public constant MAX_PENDING_SETTLEMENT_OPERATIONS = 4;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
	string private constant STAGED_OPERATION_EXECUTION_OK = '';
	string private constant STAGED_OPERATION_ERROR_EXPIRED = 'Staged operation expired';
	string private constant STAGED_OPERATION_ERROR_STALE_LIQUIDATION = 'Stale liquidation';
	string private constant STAGED_OPERATION_ERROR_ZERO_WITHDRAW = 'Withdraw amount has no effect';
	string private constant STAGED_OPERATION_ERROR_PANIC = 'Panic';
	string private constant STAGED_OPERATION_ERROR_UNKNOWN = 'Unknown error';
	VaultOperations public immutable vaultOperations;
	uint256 public pendingReportId;
	address public pendingReportSponsor;
	uint256 public pendingOperationSlotId;
	uint256 public lastSettlementTimestamp;
	uint256 public lastPrice; // (REP * SecurityPoolUtils.PRICE_PRECISION) / ETH;
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
	event PriceReportRejected(uint256 indexed reportId, string reason, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PendingReportRecovered(uint256 indexed reportId, uint256 settlementTimestamp, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	event LiquidationRouteStaged(uint256 indexed operationId, address indexed operator, address indexed receiverVault, address targetVault, bytes32 approvalId, uint256 requestedDebtAttoEth, uint256 reservedDebtAttoEth);
	event StagedOperationQueued(uint256 indexed operationId, OperationType operation, address indexed operator, address indexed targetVault, uint256 operationValue, uint256 queuedAt, uint256 validForSeconds, uint256 snapshotTargetBackingUnits, uint256 snapshotTargetUnderwritingLimitAttoEth, uint256 snapshotTargetOpenInterestAttoEth, uint256 snapshotTargetDisputeStakedAttoRep, uint256 snapshotTotalPoolHeldAttoRep, uint256 snapshotTotalRepBackingUnits, bool isPendingSlot);
	event ExecutedStagedOperation(uint256 indexed operationId, OperationType operation, bool success, string errorMessage);
	/// @notice Authoritative operation-governing and report state after a coordinator mutation.
	/// REP/ETH prices use 1e18 precision. The base-fee field uses attoETH.
	event CoordinatorStateCheckpoint(CoordinatorCheckpointReason reason, uint256 indexed reportId, uint256 indexed operationId, uint256 pendingReportId, address pendingReportSponsor, uint256 pendingOperationSlotId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp, uint256 stagedOperationCounter, uint256 activeStagedOperationCount, uint256 pendingSettlementOperationCount);

	// This is not a FIFO queue. We keep append-only operation records plus a bounded
	// pending settlement list that auto-executes once a fresh oracle price arrives.
	// Active-operation paging is newest-first so UI previews remain stable after
	// execution removes older entries from the set.
	uint256 public stagedOperationCounter;
	mapping(uint256 => StagedOperation) public stagedOperations;
	mapping(address => uint256) private latestBackingTargetOperationIds;
	uint256 private activeStagedOperationCount;
	uint256 private latestActiveStagedOperationId;
	mapping(uint256 => uint256) private olderActiveStagedOperationIds;
	mapping(uint256 => uint256) private newerActiveStagedOperationIds;
	mapping(uint256 => bool) private isActiveStagedOperation;
	uint256[] private pendingSettlementOperationIds;

	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _gasConsumedOpenOracleReportPrice, uint32 _gasConsumedSettlement, uint256 _gasUnitsForOneDispute, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint256 _openOracleSecurityMultiplierBps, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, bool _timeType, bool _trackDisputes, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps) {
		coordinatorFactory = msg.sender;
		vaultOperations = new VaultOperations();
		reputationToken = _reputationToken;
		openOracle = _openOracle;
		weth = _weth;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		require(_gasUnitsForOneDispute > 0, 'Dispute gas units zero');
		require(_gasConsumedSettlement > 0 || _gasConsumedOpenOracleReportPrice > 0, 'Request gas units zero');
		require(_initialReportPriorityFeeAttoEthPerGas > 0, 'Initial priority fee zero');
		require(_targetPriceErrorForDispute <= OPEN_ORACLE_PERCENTAGE_PRECISION, 'Target price error cannot exceed one hundred percent');
		require(_openOracleSecurityMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Open Oracle Security multiplier must be at least one hundred percent');
		require(uint256(_protocolFee) + uint256(_feePercentage) < _targetPriceErrorForDispute, 'Oracle fees must be below the target price error');
		require(_escalationHaltMultiplierBps > 0, 'Escalation multiplier zero');
		require(_openOracleSecurityMultiplierBps <= type(uint256).max / (OPEN_ORACLE_PERCENTAGE_PRECISION + _targetPriceErrorForDispute), 'Open Oracle Security multiplier is too large');
		uint256 correctionProfitNumerator =
			_targetPriceErrorForDispute - uint256(_protocolFee) - uint256(_feePercentage);
		uint256 reportNumeratorMultiplier =
			_openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + _targetPriceErrorForDispute);
		uint256 reportDenominator = SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator;
		uint256 maximumPriorityFeeReportAttoEth = Math.mulDiv(type(uint128).max, SecurityPoolUtils.BPS_DENOMINATOR, _escalationHaltMultiplierBps);
		if (maximumPriorityFeeReportAttoEth > type(uint128).max) maximumPriorityFeeReportAttoEth = type(uint128).max;
		maximumPriorityFeeReportAttoEth /= 2;
		uint256 maximumPriorityDisputeGasCost = Math.mulDiv(maximumPriorityFeeReportAttoEth, reportDenominator, reportNumeratorMultiplier);
		uint256 maximumInitialReportPriorityFeeAttoEthPerGas = maximumPriorityDisputeGasCost / _gasUnitsForOneDispute;
		require(_initialReportPriorityFeeAttoEthPerGas <= maximumInitialReportPriorityFeeAttoEthPerGas, 'Initial report priority fee exceeds OpenOracle limits');
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
		require(_trackDisputes && _timeType, 'Oracle must track disputes on a timestamp clock');
		trackDisputes = _trackDisputes;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		require(_maxSettlementBaseFeeMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Max settlement base fee multiplier must be at least one hundred percent');
		require(_minLiquidationPriceDistanceBps <= SecurityPoolUtils.BPS_DENOMINATOR, 'Minimum liquidation price distance cannot exceed one hundred percent');
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	/// @notice Coordinator-factory-only: sets the liquidation approval registry once.
	function setLiquidationApprovalRegistry(LiquidationApprovalRegistry registry) external {
		require(msg.sender == coordinatorFactory && address(liquidationApprovalRegistry) == address(0) && address(registry) != address(0), 'Registry setup invalid');
		liquidationApprovalRegistry = registry;
	}

	/// @notice Sets the security pool this coordinator serves; callable once.
	/// @dev One-time wiring. SecurityPoolFactory deploys this coordinator (through the coordinator
	/// factory's deployment worker, with a caller-scoped salt) and sets the pool in the same
	/// transaction, so no other caller can reach this before the pool is set.
	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'Security pool already set');
		securityPool = _securityPool;
		emit SecurityPoolSet(securityPool);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.SecurityPoolSetup, 0, 0);
	}

	/// @notice Pool-only: seeds `lastPrice` without changing the settlement timestamp.
	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'Only pool');
		lastPrice = _lastPrice;
		emit RepEthPriceSet(lastPrice);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceSeeded, 0, 0);
	}

	/// @notice Returns the minimum bounty for a price request at the current base fee.
	function getRequestPriceCostAttoEth() public view returns (uint256) {
		return block.basefee * _requestGasUnits() + REQUEST_BOUNTY_OFFSET_ATTO_ETH;
	}

	function _requestGasUnits() private view returns (uint256) {
		return 4 * (getSettlementCallbackGasLimit() + gasConsumedOpenOracleReportPrice);
	}

	/// @notice Returns the extra cost of queuing an operation, which is zero.
	function getQueuedOperationCostAttoEth() public pure returns (uint256) {
		return 0;
	}

	/// @notice Returns the settlement callback gas limit, sized for the maximum pending settlement operations.
	function getSettlementCallbackGasLimit() public view returns (uint32) {
		uint256 callbackGasLimit = (uint256(gasConsumedSettlement) + 50_000) * MAX_PENDING_SETTLEMENT_OPERATIONS;
		require(callbackGasLimit <= type(uint32).max, 'Callback gas exceeds uint32');
		return uint32(callbackGasLimit);
	}

	/// @notice Returns the minimum initial WETH report: the priority-fee dispute bound plus the larger of the base-fee bound and 1% of settlement collateral.
	function minimumToken1ReportAttoEth() public view returns (uint256) {
		uint256 priorityFeeReportAttoEth = _minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas);
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
			Math.mulDiv(disputeGasCost, openOracleSecurityMultiplierBps * (OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute), SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator, Math.Rounding.Ceil);
	}

	/// @notice Opens an OpenOracle REP/ETH report funded by the caller's WETH and REP when the price is stale, refunding excess ETH.
	/// @dev The caller commits an explicit bounty so the retained ETH never depends on the inclusion block's basefee.
	function requestPrice(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) public payable {
		_requireRequestBounty(bountyAttoEth);
		require(!isPriceValid(), 'Oracle price already fresh');
		_requestPrice(msg.sender, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);

		uint256 excess = msg.value - bountyAttoEth;
		if (excess > 0) {
			(bool sent, ) = payable(msg.sender).call{value: excess}('');
			require(sent, 'Oracle coordinator failed to refund excess ETH bounty');
		}
	}

	function _requireRequestBounty(uint256 bountyAttoEth) private view {
		uint256 costAttoEth = getRequestPriceCostAttoEth();
		require(bountyAttoEth >= costAttoEth, 'Oracle bounty too small');
		require(msg.value >= bountyAttoEth, 'Not enough ETH for oracle bounty');
	}

	// The cap inverts getRequestPriceCostAttoEth for the committed bounty instead of reading block.basefee,
	// so a fee-free simulation writes the same storage as the mined transaction and estimates the same gas.
	function _settlementBaseFeeCapForBounty(uint256 bountyAttoEth) private view returns (uint256) {
		uint256 impliedRequestBaseFeeAttoEthPerGas =
			(bountyAttoEth - REQUEST_BOUNTY_OFFSET_ATTO_ETH) / _requestGasUnits();
		return
			(impliedRequestBaseFeeAttoEthPerGas * maxSettlementBaseFeeMultiplierBps) /
			SecurityPoolUtils.BPS_DENOMINATOR;
	}

	function _requestPrice(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) private {
		require(pendingReportId == 0, 'Oracle request already pending');
		require(proposedRepPerEthPrice > 0, 'Initial oracle price zero');
		uint256 minimumWethReportAttoEth = minimumToken1ReportAttoEth();
		uint256 initialWethReportAttoEth =
			requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth;
		uint256 initialRepReportAttoRep = Math.mulDiv(initialWethReportAttoEth, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		uint256 escalationHaltAttoEth = Math.mulDiv(initialWethReportAttoEth, escalationHaltMultiplierBps, SecurityPoolUtils.BPS_DENOMINATOR);
		uint256 openInterestEscalationHaltAttoEth = Math.ceilDiv(securityPool.settlementCollateralAttoEth(), OPEN_INTEREST_DIVIDER);
		if (openInterestEscalationHaltAttoEth > escalationHaltAttoEth)
			escalationHaltAttoEth = openInterestEscalationHaltAttoEth;
		uint256 settlerRewardAttoEth = bountyAttoEth;
		require(initialWethReportAttoEth <= type(uint128).max, 'WETH report exceeds uint128');
		require(initialRepReportAttoRep <= type(uint128).max, 'REP report exceeds uint128');
		require(escalationHaltAttoEth <= type(uint128).max, 'Oracle escalation halt amount exceeds uint128 maximum');
		require(settlerRewardAttoEth <= type(uint96).max, 'Oracle settler reward exceeds uint96 maximum');
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = _settlementBaseFeeCapForBounty(bountyAttoEth);

		uint8 flags = OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_TIME_TYPE;
		OpenOracle.OracleGame memory reportParams = OpenOracle.OracleGame({currentAmount1: uint128(initialWethReportAttoEth), currentAmount2: uint128(initialRepReportAttoRep), currentReporter: address(this), reportTimestamp: 0, settlementTimestamp: 0, token1: address(weth), lastReportOppoTime: 0, settlementTime: settlementTime, escalationHalt: uint128(escalationHaltAttoEth), protocolFeeRecipient: protocolFeeRecipient, settlerReward: uint96(settlerRewardAttoEth), token2: address(reputationToken), numReports: 0, disputeDelay: disputeDelay, feePercentage: feePercentage, multiplier: multiplier, callbackContract: address(this), callbackGasLimit: getSettlementCallbackGasLimit(), protocolFee: protocolFee, flags: flags});

		pendingReportSponsor = sponsor;
		require(weth.transferFrom(sponsor, address(this), initialWethReportAttoEth), 'WETH transfer for initial report failed');
		require(reputationToken.transferFrom(sponsor, address(this), initialRepReportAttoRep), 'REP transfer for initial report failed');
		require(weth.approve(address(openOracle), initialWethReportAttoEth), 'WETH approval for initial report failed');
		require(reputationToken.approve(address(openOracle), initialRepReportAttoRep), 'REP approval for initial report failed');
		pendingReportId = openOracle.report{value: bountyAttoEth}(reportParams, false, false, OpenOracle.TimingBoundaries({blockNumber: 0, blockNumberBound: 0, blockTimestamp: 0, blockTimestampBound: 0}));
		emit PriceRequested(pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRequested, pendingReportId, 0);
	}

	/// @notice Clears a settled report the callback did not clear, returning reporter balances to the sponsor and failing pending operations.
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
		emit PendingReportRecovered(reportId, settlementTimestamp, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PendingReportRecovered, reportId, 0);
	}

	/// @notice OpenOracle-only settlement callback: validates the report, records the price, and executes pending operations.
	function openOracleCallback(uint256 reportId, uint256 amount1, uint256 amount2, uint256, address, address) external {
		require(msg.sender == address(openOracle), 'Only OpenOracle');
		require(reportId == pendingReportId, 'Oracle report mismatch');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor);
		pendingReportId = 0;
		pendingReportSponsor = address(0);
		uint256 maxSettlementBaseFeeAttoEthPerGas = pendingReportMaxSettlementBaseFeeAttoEthPerGas;
		pendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		(string memory rejectionReason, uint256 priceTimestamp) = _validateSettledReport(reportId, amount1, amount2, maxSettlementBaseFeeAttoEthPerGas);
		if (bytes(rejectionReason).length != 0) {
			_rejectReportAndPendingOperations(reportId, rejectionReason);
			return;
		}
		// Freshness runs from settlement eligibility: the final report is frozen then, however late settle() is called.
		lastSettlementTimestamp = priceTimestamp;
		lastPrice = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
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

	function _validateSettledReport(uint256 reportId, uint256 amount1, uint256 amount2, uint256 maxSettlementBaseFeeAttoEthPerGas) private view returns (string memory reason, uint256 priceTimestamp) {
		if (block.basefee > maxSettlementBaseFeeAttoEthPerGas) return ('Base fee too high', 0);
		(, , , uint48 finalReportTimestamp, , , , , , , , , uint24 numReports, , , , , , , ) = openOracle.storedGame(reportId);
		if (numReports == type(uint24).max) return ('Counter saturated', 0);
		if (numReports == 0 || !_isFinalReportProfitable(reportId, numReports, amount1))
			return ('Report uneconomic', 0);
		priceTimestamp = uint256(finalReportTimestamp) + settlementTime;
		if (!_isFreshPriceTimestamp(priceTimestamp)) return ('Report stale', 0);
		if (amount1 == 0 || amount2 == 0) return ('Empty oracle settlement', 0);
		if (Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1) == 0) return ('Oracle price is zero', 0);
	}

	function _isFinalReportProfitable(uint256 reportId, uint24 numReports, uint256 finalAmount1) private view returns (bool) {
		(, , uint128 finalReportBaseFee, ) = openOracle.disputeHistory(reportId, numReports - 1);
		uint256 minimumProfitableReportAttoEth =
			_minimumToken1ReportAttoEthForGasPrice(initialReportPriorityFeeAttoEthPerGas) +
				_minimumToken1ReportAttoEthForGasPrice(uint256(finalReportBaseFee));
		return finalAmount1 >= minimumProfitableReportAttoEth;
	}

	function _withdrawOpenOracleReporterBalances(address sponsor) private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}

	function _emitPriceReportRejected(uint256 reportId, string memory reason) private {
		emit PriceReportRejected(reportId, reason, pendingReportId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRejected, reportId, 0);
	}

	/// @notice Returns true when a nonzero price exists and its settlement timestamp is still fresh.
	function isPriceValid() public view returns (bool) {
		return lastPrice > 0 && _isFreshPriceTimestamp(lastSettlementTimestamp);
	}

	function _isFreshPriceTimestamp(uint256 priceTimestamp) private view returns (bool) {
		uint256 validForSeconds =
			block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS;
		return priceTimestamp != 0 && priceTimestamp + validForSeconds > block.timestamp;
	}

	/// @notice Executor-only registration preserves the wallet as owner and oracle sponsor.
	function stageVaultOperations(address owner, bool changeCommitment, uint256 actionCount, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 operationId) {
		require(msg.sender == address(vaultOperations), 'Only vault operations executor');
		require(validForSeconds > 0 && validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'Invalid execution window');
		require(!securityPool.isEscalationResolved(), 'Escalation resolved');
		if (pendingReportId != 0) require(owner == pendingReportSponsor, 'Only pending report sponsor can submit');
		if (changeCommitment)
			require(stagedOperations[latestBackingTargetOperationIds[owner]].operator == address(0), 'Commitment operation already pending');
		HistoricalQueueSnapshot memory snapshot;
		(operationId, snapshot) = _recordStagedOperation(OperationType.VaultOperations, owner, owner, bytes32(0), actionCount, validForSeconds);
		stagedOperations[operationId].operator = owner;
		if (changeCommitment) latestBackingTargetOperationIds[owner] = operationId;
		uint256 retained;
		if (isPriceValid()) {
			_emitStagedOperationQueued(operationId, snapshot, false);
			vaultOperations.execute(operationId);
			_consumeAndEmitExecutedStagedOperation(operationId, OperationType.VaultOperations, true, '');
		} else {
			require(getPendingSettlementWork() + actionCount <= MAX_PENDING_SETTLEMENT_OPERATIONS, 'Oracle settlement capacity exceeded');
			retained = _executeOrQueueStagedOperation(operationId, snapshot, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		}
		if (msg.value > retained) {
			(bool sent, ) = payable(owner).call{value: msg.value - retained}('');
			require(sent, 'Vault operation refund failed');
		}
	}

	/// @notice Remaining callbacks are bounded by action count, including actions inside bundles.
	function getPendingSettlementWork() public view returns (uint256 work) {
		for (uint256 index = 0; index < pendingSettlementOperationIds.length; index++) {
			StagedOperation storage operation = stagedOperations[pendingSettlementOperationIds[index]];
			work += operation.operation == OperationType.VaultOperations ? operation.operationValue : 1;
		}
	}

	/// @notice Stages an operation with the caller as operator and receiver, executing it under a valid price or queuing it for the next price.
	function requestPriceIfNeededAndStageOperation(OperationType operation, address targetVault, uint256 operationValue, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) public payable {
		_requestPriceIfNeededAndStageOperation(operation, targetVault, msg.sender, bytes32(0), operationValue, validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
	}

	/// @notice Stages a liquidation of `targetVault` into `receiverVault`, executing it under a valid price or queuing it for the next price.
	/// @dev A receiver other than the caller must have approved the caller through `approvalId` in the liquidation approval registry.
	function requestPriceIfNeededAndStageLiquidation(address targetVault, address receiverVault, uint256 requestedDebtAttoEth, bytes32 approvalId, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable {
		_requestPriceIfNeededAndStageOperation(OperationType.Liquidation, targetVault, receiverVault, approvalId, requestedDebtAttoEth, validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
	}

	function _requestPriceIfNeededAndStageOperation(OperationType operation, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) private {
		require(operation != OperationType.VaultOperations, 'Use vault operations submission');
		_validateStageRequest(operation, targetVault, receiverVault, approvalId, operationValue, validForSeconds);
		(uint256 operationId, HistoricalQueueSnapshot memory snapshot) = _recordStagedOperation(operation, targetVault, receiverVault, approvalId, operationValue, validForSeconds);
		uint256 retained = _executeOrQueueStagedOperation(operationId, snapshot, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		uint256 refund = msg.value - retained;
		if (refund > 0) {
			(bool sent, ) = payable(msg.sender).call{value: refund}('');
			require(sent, 'Oracle coordinator failed to return unused ETH');
		}
	}

	function _validateStageRequest(OperationType operation, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds) private view {
		require(operationValue > 0 || operation == OperationType.SetVaultUnderwritingLimit, 'Staged operation amount must be non-zero');
		require(validForSeconds > 0, 'Staged operation timeout must be positive');
		require(validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'Staged operation timeout exceeds the maximum allowed');
		if (operation != OperationType.Liquidation) {
			require(targetVault == msg.sender, 'Self operation target mismatch');
			require(receiverVault == msg.sender && approvalId == bytes32(0), 'Self route mismatch');
		} else {
			require(receiverVault != targetVault, 'Receiver is target');
		}
		require(!securityPool.isEscalationResolved(), 'Escalation resolved');
		if (pendingReportId != 0) {
			require(msg.sender == pendingReportSponsor, 'Only the pending report sponsor can queue more operations until settlement');
		}
		if (operation == OperationType.WithdrawRep) {
			uint256 withdrawRepAmountAttoRep = vaultOperations.previewWithdrawRep(securityPool, msg.sender, operationValue);
			require(withdrawRepAmountAttoRep > 0, STAGED_OPERATION_ERROR_ZERO_WITHDRAW);
		}
	}

	function _recordStagedOperation(OperationType operation, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds) private returns (uint256 operationId, HistoricalQueueSnapshot memory snapshot) {
		stagedOperationCounter++;
		operationId = stagedOperationCounter;
		if (operation == OperationType.SetVaultUnderwritingLimit) {
			uint256 previousId = latestBackingTargetOperationIds[targetVault];
			require(stagedOperations[previousId].operator == address(0) || stagedOperations[previousId].operation != OperationType.VaultOperations, 'Vault bundle already pending');
			if (stagedOperations[previousId].operator != address(0))
				_consumeAndEmitExecutedStagedOperation(previousId, operation, false, 'Backing target superseded');
			latestBackingTargetOperationIds[targetVault] = operationId;
		}
		// Liquidations snapshot the complete collateral bundle, including committed REP.
		// Backing or capacity mutations invalidate the quote, protecting rescue deposits.
		// Other operations retain this observation only for history and event context.
		snapshot = _captureHistoricalQueueSnapshot(operation, targetVault);
		uint256 reservedLiquidationDebtAttoEth;
		if (operation == OperationType.Liquidation && receiverVault != msg.sender) {
			reservedLiquidationDebtAttoEth = liquidationApprovalRegistry.reserve(operationId, approvalId, receiverVault, targetVault, msg.sender, operationValue, snapshot.targetUnderwritingLimitAttoEth, block.timestamp + uint256(settlementTime) + validForSeconds);
		} else if (operation == OperationType.Liquidation) {
			require(approvalId == bytes32(0), 'Self approval must be zero');
		}
		stagedOperations[operationId] = StagedOperation({operation: operation, operator: msg.sender, receiverVault: receiverVault, targetVault: targetVault, operationValue: operationValue, queuedAt: block.timestamp, validForSeconds: validForSeconds, snapshotTargetBackingUnits: snapshot.targetBackingUnits, snapshotTargetUnderwritingLimitAttoEth: snapshot.targetUnderwritingLimitAttoEth, liquidationApprovalId: approvalId, reservedLiquidationDebtAttoEth: reservedLiquidationDebtAttoEth});
		_trackActiveStagedOperation(operationId);
		if (operation == OperationType.Liquidation) {
			emit LiquidationRouteStaged(operationId, msg.sender, receiverVault, targetVault, approvalId, operationValue, reservedLiquidationDebtAttoEth);
		}
	}

	/// @dev Executes immediately under a valid price; otherwise joins the pending settlement set and,
	/// when it opens that set, requests a price. Returns the bounty retained from `msg.value`.
	function _executeOrQueueStagedOperation(uint256 operationId, HistoricalQueueSnapshot memory snapshot, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) private returns (uint256 retained) {
		if (isPriceValid()) {
			_emitStagedOperationQueued(operationId, snapshot, false);
			executeStagedOperation(operationId);
			// no cost when price is valid
			return 0;
		}
		bool shouldRequestPrice = pendingReportId == 0 && pendingSettlementOperationIds.length == 0;
		bool isPendingSettlementOperationId = _trackPendingSettlementOperation(operationId);
		_emitStagedOperationQueued(operationId, snapshot, isPendingSettlementOperationId);
		if (shouldRequestPrice && isPendingSettlementOperationId) {
			_requireRequestBounty(bountyAttoEth);
			retained = bountyAttoEth;
			_requestPrice(stagedOperations[operationId].operator, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);
		}
	}

	function _captureHistoricalQueueSnapshot(OperationType operation, address targetVault) private view returns (HistoricalQueueSnapshot memory snapshot) {
		(snapshot.targetBackingUnits, snapshot.targetUnderwritingLimitAttoEth, , ) = securityPool.securityVaults(targetVault);
		snapshot.targetOpenInterestAttoEth = securityPool.getVaultOpenInterestAttoEth(targetVault);
		snapshot.totalPoolHeldAttoRep = securityPool.getTotalPoolHeldAttoRep();
		snapshot.totalRepBackingUnits = securityPool.totalRepBackingUnits();
		snapshot.targetDisputeStakedAttoRep =
			operation == OperationType.Liquidation && address(securityPool.escalationGame()) != address(0x0)
				? securityPool.escalationGame().disputeStakedRepByVaultAttoRep(targetVault)
				: 0;
	}

	/// @notice Executes a staged operation under a valid price, or consumes it as failed when expired or stale; callable by anyone.
	function executeStagedOperation(uint256 operationId) public {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_EXPIRED);
			return;
		}
		require(isPriceValid(), 'Valid oracle price required');
		if (stagedOperation.operation == OperationType.Liquidation) {
			(uint256 currentTargetBackingUnits, uint256 currentTargetUnderwritingLimitAttoEth, , ) = securityPool.securityVaults(stagedOperation.targetVault);
			if (
				currentTargetBackingUnits != stagedOperation.snapshotTargetBackingUnits ||
				currentTargetUnderwritingLimitAttoEth != stagedOperation.snapshotTargetUnderwritingLimitAttoEth
			) {
				_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_STALE_LIQUIDATION);
				return;
			}
		}
		if (
			stagedOperation.operation == OperationType.WithdrawRep &&
			vaultOperations.previewWithdrawRep(securityPool, stagedOperation.operator, stagedOperation.operationValue) ==
				0
		) {
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_ZERO_WITHDRAW);
			return;
		}
		_executeSingleStagedOperation(operationId, stagedOperation);
	}

	/// @notice Consumes an expired staged operation as failed; callable by anyone.
	function expireStagedOperation(uint256 operationId) external {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		require(block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds, 'Staged operation active');
		_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_EXPIRED);
	}

	function _emitExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string memory errorMessage) private {
		emit ExecutedStagedOperation(operationId, operation, success, errorMessage);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationExecuted, 0, operationId);
	}

	function _consumeAndEmitExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string memory errorMessage) private {
		_consumeStagedOperation(operationId);
		_emitExecutedStagedOperation(operationId, operation, success, errorMessage);
	}

	function _executeSingleStagedOperation(uint256 operationId, StagedOperation memory operation) private {
		try vaultOperations.executeSingle(operationId, operation) returns (uint256 debtMovedAttoEth) {
			if (operation.liquidationApprovalId != bytes32(0))
				require(debtMovedAttoEth <= operation.reservedLiquidationDebtAttoEth, 'Debt exceeds reservation');
			if (operation.operation == OperationType.Liquidation)
				liquidationApprovalRegistry.consume(operationId, debtMovedAttoEth);
			else liquidationApprovalRegistry.release(operationId);
			_deleteStagedOperation(operationId);
			_emitExecutedStagedOperation(operationId, operation.operation, true, STAGED_OPERATION_EXECUTION_OK);
		} catch Error(string memory reason) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, reason);
		} catch Panic(uint256) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, STAGED_OPERATION_ERROR_PANIC);
		} catch (bytes memory) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, STAGED_OPERATION_ERROR_UNKNOWN);
		}
	}

	function _emitStagedOperationQueued(uint256 operationId, HistoricalQueueSnapshot memory snapshot, bool isPendingSlot) private {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		emit StagedOperationQueued(operationId, stagedOperation.operation, stagedOperation.operator, stagedOperation.targetVault, stagedOperation.operationValue, stagedOperation.queuedAt, stagedOperation.validForSeconds, snapshot.targetBackingUnits, snapshot.targetUnderwritingLimitAttoEth, snapshot.targetOpenInterestAttoEth, snapshot.targetDisputeStakedAttoRep, snapshot.totalPoolHeldAttoRep, snapshot.totalRepBackingUnits, isPendingSlot);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationQueued, pendingReportId, operationId);
	}

	function _emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason reason, uint256 reportId, uint256 operationId) private {
		emit CoordinatorStateCheckpoint(reason, reportId, operationId, pendingReportId, pendingReportSponsor, pendingOperationSlotId, pendingReportMaxSettlementBaseFeeAttoEthPerGas, lastPrice, lastSettlementTimestamp, stagedOperationCounter, activeStagedOperationCount, pendingSettlementOperationIds.length);
	}

	function _consumeStagedOperation(uint256 operationId) private {
		liquidationApprovalRegistry.release(operationId);
		_deleteStagedOperation(operationId);
	}

	function _deleteStagedOperation(uint256 operationId) private {
		if (stagedOperations[operationId].operation == OperationType.VaultOperations)
			vaultOperations.release(operationId);
		_consumePendingSettlementOperation(operationId);
		_consumeActiveStagedOperation(operationId);
		stagedOperations[operationId].operator = address(0);
	}

	/// @notice Returns the first pending settlement operation.
	function getPendingOperationSlot() public view returns (StagedOperation memory) {
		return stagedOperations[pendingOperationSlotId];
	}

	/// @notice Returns the number of active staged operations.
	function getActiveStagedOperationCount() public view returns (uint256) {
		return activeStagedOperationCount;
	}

	/// @notice Returns the number of operations waiting for the next price settlement.
	function getPendingSettlementOperationCount() public view returns (uint256) {
		return pendingSettlementOperationIds.length;
	}

	/// @notice Returns the operation ids waiting for the next price settlement.
	function getPendingSettlementOperationIds() public view returns (uint256[] memory) {
		return pendingSettlementOperationIds;
	}

	/// @notice Returns up to `count` active staged operations, newest first, after skipping `startIndex`.
	function getActiveStagedOperations(uint256 startIndex, uint256 count) public view returns (uint256[] memory operationIds, StagedOperation[] memory operations) {
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
		uint256 work =
			stagedOperations[operationId].operation == OperationType.VaultOperations
				? stagedOperations[operationId].operationValue
				: 1;
		if (getPendingSettlementWork() + work > MAX_PENDING_SETTLEMENT_OPERATIONS) return false;
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
