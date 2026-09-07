// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ITwoWayConstantProductPair } from './ITwoWayConstantProductPair.sol';

interface ITwoWayConstantProductPairV2 is ITwoWayConstantProductPair {
	function IMPLEMENTATION_VERSION() external view returns (uint256);
	function DOMAIN_SEPARATOR() external view returns (bytes32);
	function nonces(address owner) external view returns (uint256);
	function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;
	function removeLiquidity(uint256 liquidity, uint256 minYes, uint256 minNo, address recipient, uint256 deadline) external returns (uint256 yesOut, uint256 noOut);
}
