// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SharedPoolPriceFeed } from './SharedPoolPriceFeed.sol';
import './OpenOraclePriceCoordinatorTypes.sol';

interface IOracleReportConfig {
	function sharedPriceFeed() external view returns (SharedPoolPriceFeed);
	function reputationToken() external view returns (ReputationToken);
	function openOracle() external view returns (OpenOracle);
	function weth() external view returns (IWeth9);
	function securityPool() external view returns (ISecurityPool);
	function gasConsumedOpenOracleReportPrice() external view returns (uint256);
	function getSettlementCallbackGasLimit() external view returns (uint32);
	function minimumToken1ReportAttoEth() external view returns (uint256);
	function gasUnitsForOneDispute() external view returns (uint256);
	function initialReportPriorityFeeAttoEthPerGas() external view returns (uint256);
	function targetPriceErrorForDispute() external view returns (uint256);
	function openOracleSecurityMultiplierBps() external view returns (uint256);
	function settlementTime() external view returns (uint48);
	function disputeDelay() external view returns (uint24);
	function protocolFee() external view returns (uint24);
	function feePercentage() external view returns (uint24);
	function multiplier() external view returns (uint16);
	function protocolFeeRecipient() external view returns (address);
	function escalationHaltMultiplierBps() external view returns (uint256);
	function maxSettlementBaseFeeMultiplierBps() external view returns (uint256);
}

/// @notice Stateless standalone-report execution and validation shared by operation coordinators.
/// @dev Creation uses delegatecall so report funding, reporter credits, and the callback remain with
/// the calling coordinator. The delegate never accesses coordinator storage slots directly.
contract OpenOracleReportDelegate {
	uint256 private constant OPEN_INTEREST_DIVIDER = 100;
	function minimumReportAttoEth(address configuration, uint256 collateralAttoEth) external view returns (uint256) {
		IOracleReportConfig config = IOracleReportConfig(configuration);
		uint256 priority = _minimumToken1ReportAttoEthForGasPrice(config, config.initialReportPriorityFeeAttoEthPerGas());
		uint256 baseFee = _minimumToken1ReportAttoEthForGasPrice(config, block.basefee);
		uint256 exposure = Math.ceilDiv(collateralAttoEth, 100);
		uint256 minimum = priority + (baseFee > exposure ? baseFee : exposure);
		return minimum > 0 ? minimum : 1;
	}

	/// @dev Delegate-called funding adapter preserves sponsor approvals to the question coordinator.
	function createSharedReport(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) external payable {
		IOracleReportConfig config = IOracleReportConfig(address(this));
		SharedPoolPriceFeed feed = config.sharedPriceFeed();
		uint256 minimum = feed.minimumToken1ReportAttoEth();
		uint256 wethAmount = requestedInitialAttoWeth > minimum ? requestedInitialAttoWeth : minimum;
		uint256 repAmount = Math.mulDiv(wethAmount, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		IWeth9 weth = config.weth();
		ReputationToken reputationToken = config.reputationToken();
		require(weth.transferFrom(sponsor, address(this), wethAmount), 'WETH transfer for initial report failed');
		require(reputationToken.transferFrom(sponsor, address(this), repAmount), 'REP transfer for initial report failed');
		require(weth.approve(address(feed), wethAmount), 'WETH approval for shared report failed');
		require(reputationToken.approve(address(feed), repAmount), 'REP approval for shared report failed');
		feed.requestPrice{value: bountyAttoEth}(sponsor, proposedRepPerEthPrice, wethAmount, bountyAttoEth);
	}

	function createReport(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) external payable returns (uint256 reportId, uint256 maxSettlementBaseFeeAttoEthPerGas) {
		IOracleReportConfig config = IOracleReportConfig(address(this));
		require(proposedRepPerEthPrice > 0, 'Initial oracle price zero');
		uint256 minimumWethReportAttoEth = config.minimumToken1ReportAttoEth();
		uint256 initialWethReportAttoEth =
			requestedInitialAttoWeth > minimumWethReportAttoEth ? requestedInitialAttoWeth : minimumWethReportAttoEth;
		uint256 initialRepReportAttoRep = Math.mulDiv(initialWethReportAttoEth, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		uint256 escalationHaltAttoEth = Math.mulDiv(initialWethReportAttoEth, config.escalationHaltMultiplierBps(), SecurityPoolUtils.BPS_DENOMINATOR);
		uint256 openInterestEscalationHaltAttoEth = Math.ceilDiv(config.securityPool().settlementCollateralAttoEth(), OPEN_INTEREST_DIVIDER);
		if (openInterestEscalationHaltAttoEth > escalationHaltAttoEth)
			escalationHaltAttoEth = openInterestEscalationHaltAttoEth;
		require(initialWethReportAttoEth <= type(uint128).max, 'WETH report exceeds uint128');
		require(initialRepReportAttoRep <= type(uint128).max, 'REP report exceeds uint128');
		require(escalationHaltAttoEth <= type(uint128).max, 'Oracle escalation halt amount exceeds uint128 maximum');
		require(bountyAttoEth <= type(uint96).max, 'Oracle settler reward exceeds uint96 maximum');
		uint32 callbackGasLimit = config.getSettlementCallbackGasLimit();
		uint256 requestGasUnits = 4 * (uint256(callbackGasLimit) + config.gasConsumedOpenOracleReportPrice());
		uint256 impliedRequestBaseFeeAttoEthPerGas = (bountyAttoEth - REQUEST_BOUNTY_OFFSET_ATTO_ETH) / requestGasUnits;
		maxSettlementBaseFeeAttoEthPerGas =
			(impliedRequestBaseFeeAttoEthPerGas * config.maxSettlementBaseFeeMultiplierBps()) /
			SecurityPoolUtils.BPS_DENOMINATOR;
		IWeth9 weth = config.weth();
		ReputationToken reputationToken = config.reputationToken();
		OpenOracle openOracle = config.openOracle();
		OpenOracle.OracleGame memory reportParams = OpenOracle.OracleGame({currentAmount1: uint128(initialWethReportAttoEth), currentAmount2: uint128(initialRepReportAttoRep), currentReporter: address(this), reportTimestamp: 0, settlementTimestamp: 0, token1: address(weth), lastReportOppoTime: 0, settlementTime: config.settlementTime(), escalationHalt: uint128(escalationHaltAttoEth), protocolFeeRecipient: config.protocolFeeRecipient(), settlerReward: uint96(bountyAttoEth), token2: address(reputationToken), numReports: 0, disputeDelay: config.disputeDelay(), feePercentage: config.feePercentage(), multiplier: config.multiplier(), callbackContract: address(this), callbackGasLimit: callbackGasLimit, protocolFee: config.protocolFee(), flags: OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_TIME_TYPE});
		require(weth.transferFrom(sponsor, address(this), initialWethReportAttoEth), 'WETH transfer for initial report failed');
		require(reputationToken.transferFrom(sponsor, address(this), initialRepReportAttoRep), 'REP transfer for initial report failed');
		require(weth.approve(address(openOracle), initialWethReportAttoEth), 'WETH approval for initial report failed');
		require(reputationToken.approve(address(openOracle), initialRepReportAttoRep), 'REP approval for initial report failed');
		reportId = openOracle.report{value: bountyAttoEth}(reportParams, false, false, OpenOracle.TimingBoundaries({blockNumber: 0, blockNumberBound: 0, blockTimestamp: 0, blockTimestampBound: 0}));
	}

	function validateSettledReport(address configuration, uint256 reportId, uint256 amount1, uint256 amount2, uint256 maxSettlementBaseFeeAttoEthPerGas) external view returns (string memory reason, uint256 priceTimestamp) {
		IOracleReportConfig config = IOracleReportConfig(configuration);
		if (block.basefee > maxSettlementBaseFeeAttoEthPerGas) return ('Base fee too high', 0);
		(, , , uint48 finalReportTimestamp, , , , , , , , , uint24 numReports, , , , , , , ) = config.openOracle().storedGame(reportId);
		if (numReports == type(uint24).max) return ('Counter saturated', 0);
		if (numReports == 0 || !_isFinalReportProfitable(config, reportId, numReports, amount1))
			return ('Report uneconomic', 0);
		priceTimestamp = uint256(finalReportTimestamp) + config.settlementTime();
		uint256 validForSeconds =
			block.chainid == SEPOLIA_CHAIN_ID ? SEPOLIA_PRICE_VALID_FOR_SECONDS : PRICE_VALID_FOR_SECONDS;
		if (priceTimestamp == 0 || priceTimestamp + validForSeconds <= block.timestamp) return ('Report stale', 0);
		if (amount1 == 0 || amount2 == 0) return ('Empty oracle settlement', 0);
		if (Math.mulDiv(amount2, SecurityPoolUtils.PRICE_PRECISION, amount1) == 0) return ('Oracle price is zero', 0);
	}

	function _isFinalReportProfitable(IOracleReportConfig config, uint256 reportId, uint24 numReports, uint256 finalAmount1) private view returns (bool) {
		(, , uint128 finalReportBaseFee, ) = config.openOracle().disputeHistory(reportId, numReports - 1);
		uint256 minimumProfitableReportAttoEth =
			_minimumToken1ReportAttoEthForGasPrice(config, config.initialReportPriorityFeeAttoEthPerGas()) +
				_minimumToken1ReportAttoEthForGasPrice(config, uint256(finalReportBaseFee));
		return finalAmount1 >= minimumProfitableReportAttoEth;
	}

	function _minimumToken1ReportAttoEthForGasPrice(IOracleReportConfig config, uint256 gasPriceAttoEthPerGas) private view returns (uint256) {
		if (gasPriceAttoEthPerGas == 0) return 0;
		uint256 disputeGasCost = Math.mulDiv(gasPriceAttoEthPerGas, config.gasUnitsForOneDispute(), 1);
		uint256 targetPriceErrorForDispute = config.targetPriceErrorForDispute();
		uint256 correctionProfitNumerator =
			targetPriceErrorForDispute - uint256(config.protocolFee()) - uint256(config.feePercentage());
		return
			Math.mulDiv(disputeGasCost, config.openOracleSecurityMultiplierBps() * (OPEN_ORACLE_PERCENTAGE_PRECISION + targetPriceErrorForDispute), SecurityPoolUtils.BPS_DENOMINATOR * correctionProfitNumerator, Math.Rounding.Ceil);
	}
}
