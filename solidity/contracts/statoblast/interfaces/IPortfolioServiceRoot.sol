// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolPortfolioSettlement } from '../SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolCapitalLedger } from '../SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioPurchase } from '../SecurityPoolPortfolioPurchase.sol';
import { ISecurityPool } from './ISecurityPool.sol';

interface IPortfolioServiceRoot {
	function forkController() external view returns (address);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function quoteHelper() external view returns (SecurityPoolPortfolioPurchase);
	function prepareServicePurchase(uint248 universeId, uint256 questionId) external returns (ISecurityPool);
	function executeServiceMint(ISecurityPool pool, address recipient, uint256 minimumShares) external payable returns (uint256);
	function deliverServiceMint(ISecurityPool pool, address recipient, uint256 shares) external;
	function registeredPools(address pool) external view returns (bool);
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
	function logicalTime(uint248 universeId) external view returns (uint48);
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
}
