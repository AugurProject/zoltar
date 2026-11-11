// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../../IERC20.sol';

interface ICollateralConfig {
	function collateralToken() external view returns (IERC20);
	function minimumReportCollateral() external view returns (uint256);
}
