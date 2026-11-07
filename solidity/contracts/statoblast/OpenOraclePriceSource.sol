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

/// @notice Report lifecycle and price-source routing, using the portfolio universe shared feed.
abstract contract OpenOraclePriceSource {
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
		return address(sharedPriceFeed);
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
		return sharedPriceFeed.pendingReportId();
	}

	function pendingReportSponsor() public view returns (address) {
		return sharedPriceFeed.pendingReportSponsor();
	}

	function lastSettlementTimestamp() public view returns (uint256) {
		return sharedPriceFeed.lastSettlementTimestamp();
	}

	function lastPrice() public view returns (uint256) {
		return sharedPriceFeed.lastPrice();
	}

	function pendingReportMaxSettlementBaseFeeAttoEthPerGas() public view returns (uint256) {
		return sharedPriceFeed.pendingReportMaxSettlementBaseFeeAttoEthPerGas();
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'Security pool already set');
		require(msg.sender == coordinatorFactory, 'Only coordinator factory');
		securityPool = _securityPool;
		emit SecurityPoolSet(securityPool);
	}

	function getRequestPriceCostAttoEth() public view returns (uint256) {
		return sharedPriceFeed.getRequestPriceCostAttoEth();
	}

	function getSettlementCallbackGasLimit() public view returns (uint32) {
		return sharedPriceFeed.getSettlementCallbackGasLimit();
	}

	function minimumToken1ReportAttoEth() public view returns (uint256) {
		return sharedPriceFeed.minimumToken1ReportAttoEth();
	}

	function requestPrice(uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) public payable {
		_requireRequestBounty(bountyAttoEth);
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
		DelegateCall.invoke(address(reportDelegate), abi.encodeCall(OpenOracleReportDelegate.createSharedReport, (sponsor, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth)));
	}

	function recoverSettledPendingReport() public {
		sharedPriceFeed.recoverSettledPendingReport();
	}

	function isPriceValid() public view returns (bool) {
		return sharedPriceFeed.isPriceValid();
	}

	/// @notice Canonical expiry for the portfolio universe shared price.
	function priceValidUntil() public view returns (uint256) {
		return sharedPriceFeed.priceValidUntil();
	}
}
