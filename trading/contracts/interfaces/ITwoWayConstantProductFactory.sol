// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ISecurityPool,
	ISecurityPoolFactory
} from '../../../solidity/contracts/peripherals/interfaces/ISecurityPool.sol';
import { ITwoWayConstantProductPair } from './ITwoWayConstantProductPair.sol';

interface ITwoWayConstantProductFactory {
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function feeBps() external view returns (uint256);
	function createPair(ISecurityPool pool) external returns (ITwoWayConstantProductPair pair);
	function getPair(ISecurityPool pool) external view returns (ITwoWayConstantProductPair pair);
	function isPair(address candidate) external view returns (bool);
	function predictPair(ISecurityPool pool) external view returns (address predicted);
}
