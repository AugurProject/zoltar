// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolSettlement } from '../SecurityPoolSettlement.sol';
import { SecurityPoolCapitalLedger } from '../SecurityPoolCapitalLedger.sol';
import { SecurityPoolPurchase } from '../SecurityPoolPurchase.sol';
import { IQuestionLedger } from './IQuestionLedger.sol';

interface ISecurityPoolServiceRoot {
	function forkController() external view returns (address);
	function settlement() external view returns (SecurityPoolSettlement);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function quoteHelper() external view returns (SecurityPoolPurchase);
	function prepareServicePurchase(uint248 universeId, uint256 questionId) external returns (IQuestionLedger);
	function registeredLedgers(address pool) external view returns (bool);
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
	function securityPoolTime(uint248 universeId) external view returns (uint48);
	function securityPoolTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
}
