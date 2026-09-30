// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolFactory } from './ISecurityPool.sol';
import { SecurityPoolEventEmitter } from '../SecurityPoolEventEmitter.sol';

/// @dev Configuration a SecurityPool constructor reads from the deployment worker that creates it.
interface ISecurityPoolDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
	function operationsDelegate() external view returns (address);
}
