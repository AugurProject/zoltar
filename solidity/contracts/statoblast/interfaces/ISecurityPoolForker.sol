// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
interface ISecurityPoolForker {
	function initiateSecurityPoolFork(ISecurityPool securityPool) external;
	function preparePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool);
	function materializePortfolioQuestion(ISecurityPool source, uint248 targetUniverse) external returns (ISecurityPool);
	function createChildUniverse(ISecurityPool securityPool, uint256 outcomeIndex) external;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
