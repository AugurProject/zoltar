// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC1155 } from './IERC1155.sol';

/// @notice Optional per-token supply extension to the standard ERC-1155 interface.
interface IERC1155Supply is IERC1155 {
	function totalSupply(uint256 id) external view returns (uint256);
}
