// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from '../../../solidity/contracts/statoblast/interfaces/ISecurityPool.sol';
import { ITradingShareToken } from './ITradingShareToken.sol';

interface ITwoWayConstantProductPair {
	enum TradingStatus {
		Open,
		QuestionEnded,
		PoolInactive,
		AwaitingForkContinuation,
		UniverseForked,
		QuestionResolved,
		Uninitialized
	}

	function securityPool() external view returns (ISecurityPool);
	function shareToken() external view returns (ITradingShareToken);
	function yesTokenId() external view returns (uint256);
	function noTokenId() external view returns (uint256);
	function invalidTokenId() external view returns (uint256);
	function feeBps() external view returns (uint256);
	function totalSupply() external view returns (uint256);
	function balanceOf(address account) external view returns (uint256);
	function approve(address spender, uint256 amount) external returns (bool);
	function transfer(address recipient, uint256 amount) external returns (bool);
	function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
	function getReserves() external view returns (uint256 yesReserve, uint256 noReserve);
	function getEffectiveReserves() external view returns (uint256 yesReserve, uint256 noReserve);
	function tradingStatus() external view returns (TradingStatus status);
	function quoteExactInput(
		bool yesForNo,
		uint256 amountIn
	) external view returns (uint256 amountOut, uint256 feeAmount);
	function quoteExactOutput(
		bool yesForNo,
		uint256 amountOut
	) external view returns (uint256 amountIn, uint256 feeAmount);
	function initialize(
		uint256 yesAmount,
		uint256 noAmount,
		uint256 minLiquidity,
		address recipient
	) external returns (uint256 liquidity);
	function addLiquidity(
		uint256 maxYes,
		uint256 maxNo,
		uint256 minLiquidity,
		address recipient
	) external returns (uint256 yesUsed, uint256 noUsed, uint256 liquidity);
	function removeLiquidity(
		uint256 liquidity,
		uint256 minYes,
		uint256 minNo,
		address recipient
	) external returns (uint256 yesOut, uint256 noOut);
	function swapExactInput(
		bool yesForNo,
		uint256 amountIn,
		uint256 minAmountOut,
		address recipient
	) external returns (uint256 amountOut, uint256 feeAmount);
	function swapExactOutput(
		bool yesForNo,
		uint256 amountOut,
		uint256 maxAmountIn,
		address recipient
	) external returns (uint256 amountIn, uint256 feeAmount);
}
