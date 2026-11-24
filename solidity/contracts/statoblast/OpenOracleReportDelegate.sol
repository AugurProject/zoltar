// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SharedPoolPriceFeed } from './SharedPoolPriceFeed.sol';

interface IOracleReportConfig {
	function sharedPriceFeed() external view returns (SharedPoolPriceFeed);
	function reputationToken() external view returns (ReputationToken);
}

/// @notice Stateless standalone-report execution and validation shared by operation coordinators.
/// @dev Delegatecall preserves sponsor approvals to the calling coordinator for report funding.
/// Reporter credits and the settlement callback belong to each report escrow. The delegate never accesses coordinator storage slots directly.
contract OpenOracleReportDelegate {
	using SafeERC20Ops for IERC20;

	/// @dev Delegate-called funding adapter preserves sponsor approvals to the question coordinator.
	function createSharedReport(address sponsor, uint256 bountyAttoEth, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth) external payable {
		IOracleReportConfig config = IOracleReportConfig(address(this));
		SharedPoolPriceFeed feed = config.sharedPriceFeed();
		uint256 minimum = feed.minimumToken1ReportAttoEthForPrice(proposedRepPerEthPrice);
		require(requestedInitialAttoWeth >= minimum, 'Report funding below minimum');
		uint256 collateralAmount = requestedInitialAttoWeth;
		uint256 repAmount = Math.mulDiv(collateralAmount, proposedRepPerEthPrice, SecurityPoolUtils.PRICE_PRECISION, Math.Rounding.Ceil);
		IERC20 collateral = feed.collateralToken();
		ReputationToken reputationToken = config.reputationToken();
		Collateral.pull(collateral, sponsor, address(this), collateralAmount);
		require(reputationToken.transferFrom(sponsor, address(this), repAmount), 'REP transfer for initial report failed');
		collateral.safeApprove(address(feed), collateralAmount);
		require(reputationToken.approve(address(feed), repAmount), 'REP approval for shared report failed');
		feed.requestPrice{value: bountyAttoEth}(sponsor, proposedRepPerEthPrice, collateralAmount, bountyAttoEth);
	}
}
