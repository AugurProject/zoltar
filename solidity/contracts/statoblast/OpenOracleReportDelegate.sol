// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
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
	using SafeERC20Ops for IERC20;

	/// @dev Delegate-called funding adapter preserves sponsor approvals to the question coordinator.
	function createSharedReport(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) external payable {
		IOracleReportConfig config = IOracleReportConfig(address(this));
		SharedPoolPriceFeed feed = config.sharedPriceFeed();
		uint256 minimum = feed.minimumToken1ReportAttoEthForPrice(proposedRepPerEthPrice);
		uint256 wethAmount = requestedInitialAttoWeth > minimum ? requestedInitialAttoWeth : minimum;
		uint256 repAmount = Math.mulDiv(wethAmount, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		IERC20 weth = feed.collateralToken();
		ReputationToken reputationToken = config.reputationToken();
		Collateral.pull(weth, sponsor, address(this), wethAmount);
		require(reputationToken.transferFrom(sponsor, address(this), repAmount), 'REP transfer for initial report failed');
		weth.safeApprove(address(feed), 0);
		weth.safeApprove(address(feed), wethAmount);
		require(reputationToken.approve(address(feed), repAmount), 'REP approval for shared report failed');
		feed.requestPrice{value: bountyAttoEth}(sponsor, proposedRepPerEthPrice, wethAmount, bountyAttoEth);
	}
}
