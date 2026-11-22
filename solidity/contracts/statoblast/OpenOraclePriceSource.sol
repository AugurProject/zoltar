// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { OraclePriceMath } from './OraclePriceMath.sol';
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
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable targetPriceErrorForDispute;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public immutable minLiquidationPriceDistanceBps;
	address internal immutable coordinatorFactory;
	OpenOracleReportDelegate public immutable reportDelegate;

	event SecurityPoolSet(ISecurityPool indexed securityPool);
	SharedPoolPriceFeed public sharedPriceFeed;
	event SharedPriceFeedSet(address indexed priceFeed);

	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, OpenOracleReportDelegate _reportDelegate) {
		coordinatorFactory = msg.sender;
		require(address(_reportDelegate).code.length != 0, 'Report delegate missing');
		reportDelegate = _reportDelegate;
		reputationToken = _reputationToken;
		openOracle = _openOracle;
		weth = _weth;
		require(_initialReportPriorityFeeAttoEthPerGas > 0, 'Initial priority fee zero');
		require(_targetPriceErrorForDispute < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Target price error must be below one hundred percent');
		require(_initialReportPriorityFeeAttoEthPerGas <= OraclePriceMath.maximumPriorityFee(_targetPriceErrorForDispute, _protocolFee, _feePercentage, _escalationHaltMultiplierBps), 'Initial report priority fee exceeds OpenOracle limits');
		initialReportPriorityFeeAttoEthPerGas = _initialReportPriorityFeeAttoEthPerGas;
		targetPriceErrorForDispute = _targetPriceErrorForDispute;
		// OpenOracle rejects every report created with these values, so a coordinator
		// holding them could never price its pools.
		require(_settlementTime > _disputeDelay, 'Settlement time must exceed dispute delay');
		require(_multiplier >= 100, 'Oracle dispute multiplier must be at least one hundred percent');
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		require(_maxSettlementBaseFeeMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Max settlement base fee multiplier must be at least one hundred percent');
		require(_minLiquidationPriceDistanceBps <= SecurityPoolUtils.BPS_DENOMINATOR, 'Minimum liquidation price distance cannot exceed one hundred percent');
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	function collateralToken() external view returns (IERC20) {
		return sharedPriceFeed.collateralToken();
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
