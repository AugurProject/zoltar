// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import './IERC20.sol';

/// @notice The subset of the externally deployed Augur REPv2 token required by Zoltar.
interface IExternalGenesisReputationToken is IERC20 {
	function getTotalTheoreticalSupply() external view returns (uint256);
}
