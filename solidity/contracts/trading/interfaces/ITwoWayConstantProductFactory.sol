// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger, ISecurityPoolFactory } from '../../statoblast/interfaces/IQuestionLedger.sol';
import { ITwoWayConstantProductPair } from './ITwoWayConstantProductPair.sol';

interface ITwoWayConstantProductFactory {
	function securityPoolFactory() external view returns (ISecurityPoolFactory);
	function feeBps() external view returns (uint256);
	function predeploymentShareSink() external view returns (address);
	function createPair(IQuestionLedger pool) external returns (ITwoWayConstantProductPair pair);
	function getPair(IQuestionLedger pool) external view returns (ITwoWayConstantProductPair pair);
	function isPair(address candidate) external view returns (bool);
	function predictPair(IQuestionLedger pool) external view returns (address predicted);
}
