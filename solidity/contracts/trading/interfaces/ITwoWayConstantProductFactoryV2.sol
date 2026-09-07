// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from '../../statoblast/interfaces/ISecurityPool.sol';
import { ITwoWayConstantProductPairV2 } from './ITwoWayConstantProductPairV2.sol';

interface ITwoWayConstantProductFactoryV2 {
	function IMPLEMENTATION_VERSION() external view returns (uint256);
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function feeBps() external view returns (uint256);
	function predeploymentShareSink() external view returns (address);
	function createPair(ISecurityPool pool) external returns (ITwoWayConstantProductPairV2 pair);
	function getPair(ISecurityPool pool) external view returns (ITwoWayConstantProductPairV2 pair);
	function isPair(address candidate) external view returns (bool);
	function predictPair(ISecurityPool pool) external view returns (address predicted);
}
