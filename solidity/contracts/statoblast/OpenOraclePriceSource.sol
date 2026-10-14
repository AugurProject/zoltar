// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SharedPoolPriceFeed } from './SharedPoolPriceFeed.sol';
import { OpenOracleReportDelegate } from './OpenOracleReportDelegate.sol';
import { DelegateCall } from './DelegateCall.sol';
import './OpenOraclePriceCoordinatorTypes.sol';

/// @notice Report lifecycle and price-source routing, independent of a question's operation queue.
abstract contract OpenOraclePriceSource {
	uint256 public constant MAX_PENDING_SETTLEMENT_OPERATIONS = 4;
	uint256 public constant SETTLEMENT_GAS_OVERHEAD = 50_000;
	uint256 public constant OPEN_INTEREST_DIVIDER = 100;
	uint256 private standalonePendingReportId;
	address private standalonePendingReportSponsor;
	uint256 private standaloneLastSettlementTimestamp;
	uint256 private standaloneLastPrice; // (REP * SecurityPoolUtils.PRICE_PRECISION) / ETH;
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
	uint256 private standalonePendingReportMaxSettlementBaseFeeAttoEthPerGas;
	address internal immutable coordinatorFactory;
	OpenOracleReportDelegate public immutable reportDelegate;

	event SecurityPoolSet(ISecurityPool indexed securityPool);
	event RepEthPriceSet(uint256 price);
	event PriceRequested(uint256 indexed reportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas);
	event PriceReportRejected(uint256 indexed reportId, string reason, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	event PriceReported(uint256 indexed reportId, uint256 price, uint256 lastSettlementTimestamp);
	event PendingReportRecovered(uint256 indexed reportId, uint256 settlementTimestamp, uint256 pendingReportId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp);
	SharedPoolPriceFeed public sharedPriceFeed;
	event SharedPriceFeedSet(address indexed priceFeed);

	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _gasConsumedOpenOracleReportPrice, uint32 _gasConsumedSettlement, uint256 _gasUnitsForOneDispute, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint256 _openOracleSecurityMultiplierBps, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, bool _timeType, bool _trackDisputes, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, OpenOracleReportDelegate _reportDelegate) {
		coordinatorFactory = msg.sender;
		require(address(_reportDelegate).code.length != 0, 'Report delegate missing');
		reportDelegate = _reportDelegate;
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

	function priceFeed() public view returns (address) {
		return address(sharedPriceFeed) == address(0) ? address(this) : address(sharedPriceFeed);
	}

	function setSharedPriceFeed(SharedPoolPriceFeed feed) external {
		require(msg.sender == coordinatorFactory && address(securityPool) == address(0) && address(sharedPriceFeed) == address(0) && address(feed) != address(0), 'Shared feed setup invalid');
		require(address(feed.reputationToken()) == address(reputationToken) && address(feed.openOracle()) == address(openOracle) && address(feed.weth()) == address(weth), 'Shared feed assets mismatch');
		sharedPriceFeed = feed;
		emit SharedPriceFeedSet(address(feed));
	}

	function syncExposure() external {
		if (address(sharedPriceFeed) != address(0)) sharedPriceFeed.syncExposure(address(this));
	}

	function pendingReportId() public view returns (uint256) {
		return address(sharedPriceFeed) == address(0) ? standalonePendingReportId : sharedPriceFeed.pendingReportId();
	}

	function pendingReportSponsor() public view returns (address) {
		return
			address(sharedPriceFeed) == address(0)
				? standalonePendingReportSponsor
				: sharedPriceFeed.pendingReportSponsor();
	}

	function lastSettlementTimestamp() public view returns (uint256) {
		return
			address(sharedPriceFeed) == address(0)
				? standaloneLastSettlementTimestamp
				: sharedPriceFeed.lastSettlementTimestamp();
	}

	function lastPrice() public view returns (uint256) {
		return address(sharedPriceFeed) == address(0) ? standaloneLastPrice : sharedPriceFeed.lastPrice();
	}

	function pendingReportMaxSettlementBaseFeeAttoEthPerGas() public view returns (uint256) {
		return
			address(sharedPriceFeed) == address(0)
				? standalonePendingReportMaxSettlementBaseFeeAttoEthPerGas
				: sharedPriceFeed.pendingReportMaxSettlementBaseFeeAttoEthPerGas();
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'Security pool already set');
		require(msg.sender == coordinatorFactory, 'Only coordinator factory');
		securityPool = _securityPool;
		emit SecurityPoolSet(securityPool);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.SecurityPoolSetup, 0, 0);
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'Only pool');
		if (address(sharedPriceFeed) != address(0)) return;
		standaloneLastPrice = _lastPrice;
		emit RepEthPriceSet(lastPrice());
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceSeeded, 0, 0);
	}

	function getRequestPriceCostAttoEth() public view returns (uint256) {
		if (address(sharedPriceFeed) != address(0)) return sharedPriceFeed.getRequestPriceCostAttoEth();
		return block.basefee * _requestGasUnits() + REQUEST_BOUNTY_OFFSET_ATTO_ETH;
	}

	function _requestGasUnits() private view returns (uint256) {
		return 4 * (getSettlementCallbackGasLimit() + gasConsumedOpenOracleReportPrice);
	}

	function getQueuedOperationCostAttoEth() public pure returns (uint256) {
		return 0;
	}

	function getSettlementCallbackGasLimit() public view returns (uint32) {
		if (address(sharedPriceFeed) != address(0)) return sharedPriceFeed.getSettlementCallbackGasLimit();
		uint256 limit = (uint256(gasConsumedSettlement) + SETTLEMENT_GAS_OVERHEAD) * MAX_PENDING_SETTLEMENT_OPERATIONS;
		require(limit <= type(uint32).max, 'Callback gas exceeds uint32');
		return uint32(limit);
	}

	function minimumToken1ReportAttoEth() public view returns (uint256) {
		if (address(sharedPriceFeed) != address(0)) return sharedPriceFeed.minimumToken1ReportAttoEth();
		return
			reportDelegate.minimumReportAttoEth(address(this), address(securityPool) == address(0) ? 0 : securityPool.settlementCollateralAttoEth());
	}

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

	function _requireRequestBounty(uint256 bountyAttoEth) internal view {
		uint256 costAttoEth = getRequestPriceCostAttoEth();
		require(bountyAttoEth >= costAttoEth, 'Oracle bounty too small');
		require(msg.value >= bountyAttoEth, 'Not enough ETH for oracle bounty');
	}

	function _requestPrice(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) internal {
		require(pendingReportId() == 0, 'Oracle request already pending');
		if (address(sharedPriceFeed) != address(0)) {
			DelegateCall.invoke(address(reportDelegate), abi.encodeCall(OpenOracleReportDelegate.createSharedReport, (sponsor, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth)));
			return;
		}
		standalonePendingReportSponsor = sponsor;
		bytes memory result = DelegateCall.invoke(address(reportDelegate), abi.encodeCall(OpenOracleReportDelegate.createReport, (sponsor, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth)));
		(standalonePendingReportId, standalonePendingReportMaxSettlementBaseFeeAttoEthPerGas) = abi.decode(result, (uint256, uint256));
		emit PriceRequested(pendingReportId(), pendingReportMaxSettlementBaseFeeAttoEthPerGas());
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRequested, pendingReportId(), 0);
	}

	function recoverSettledPendingReport() public {
		if (address(sharedPriceFeed) != address(0)) {
			sharedPriceFeed.recoverSettledPendingReport();
			return;
		}
		uint256 reportId = pendingReportId();
		require(reportId != 0, 'No report to recover');
		(, , , , uint48 settlementTimestamp) = IStoredOpenOracleGame(address(openOracle)).storedGame(reportId);
		require(settlementTimestamp != 0, 'Report not settled');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor());
		standalonePendingReportId = 0;
		standalonePendingReportSponsor = address(0);
		standalonePendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		_failPendingSettlementOperations('Report recovered');
		emit PendingReportRecovered(reportId, settlementTimestamp, pendingReportId(), pendingReportMaxSettlementBaseFeeAttoEthPerGas(), lastPrice(), lastSettlementTimestamp());
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PendingReportRecovered, reportId, 0);
	}

	function openOracleCallback(uint256 reportId, uint256 amount1, uint256 amount2, uint256, address, address) external {
		require(msg.sender == address(openOracle), 'Only OpenOracle');
		require(address(sharedPriceFeed) == address(0), 'Shared feed handles settlement');
		require(reportId == pendingReportId(), 'Oracle report mismatch');
		_withdrawOpenOracleReporterBalances(pendingReportSponsor());
		standalonePendingReportId = 0;
		standalonePendingReportSponsor = address(0);
		uint256 maxSettlementBaseFeeAttoEthPerGas = pendingReportMaxSettlementBaseFeeAttoEthPerGas();
		standalonePendingReportMaxSettlementBaseFeeAttoEthPerGas = 0;
		(string memory rejectionReason, uint256 priceTimestamp) = reportDelegate.validateSettledReport(address(this), reportId, amount1, amount2, maxSettlementBaseFeeAttoEthPerGas);
		if (bytes(rejectionReason).length != 0) {
			_rejectReportAndPendingOperations(reportId, rejectionReason);
			return;
		}
		// Freshness runs from settlement eligibility: the final report is frozen then, however late settle() is called.
		standaloneLastSettlementTimestamp = priceTimestamp;
		standaloneLastPrice = Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1);
		securityPool.updateRetentionRate();
		emit PriceReported(reportId, lastPrice(), lastSettlementTimestamp());
		_acceptPendingSettlementOperations();
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceReported, reportId, 0);
	}

	function _rejectReportAndPendingOperations(uint256 reportId, string memory reason) private {
		_emitPriceReportRejected(reportId, reason);
		_failPendingSettlementOperations(reason);
	}

	function _withdrawOpenOracleReporterBalances(address sponsor) private {
		openOracle.withdrawTo(address(weth), type(uint256).max, sponsor);
		openOracle.withdrawTo(address(reputationToken), type(uint256).max, sponsor);
	}

	function _emitPriceReportRejected(uint256 reportId, string memory reason) private {
		emit PriceReportRejected(reportId, reason, pendingReportId(), pendingReportMaxSettlementBaseFeeAttoEthPerGas(), lastPrice(), lastSettlementTimestamp());
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.PriceRejected, reportId, 0);
	}

	function isPriceValid() public view returns (bool) {
		if (address(sharedPriceFeed) != address(0)) return sharedPriceFeed.isPriceValid();
		return lastPrice() > 0 && _isFreshPriceTimestamp(lastSettlementTimestamp());
	}

	function _isFreshPriceTimestamp(uint256 priceTimestamp) private view returns (bool) {
		uint256 validForSeconds =
			block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS;
		return priceTimestamp != 0 && priceTimestamp + validForSeconds > block.timestamp;
	}

	function _acceptPendingSettlementOperations() internal virtual;
	function _failPendingSettlementOperations(string memory reason) internal virtual;
	function _emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason reason, uint256 reportId, uint256 operationId) internal virtual;
}
