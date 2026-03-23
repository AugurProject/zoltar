// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ISecurityPool } from './ISecurityPool.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { IDualCapBatchAuction } from './IDualCapBatchAuction.sol';

interface ISecurityPoolForker {
	function initiateSecurityPoolFork(ISecurityPool securityPool) external;
	function migrateRepToZoltar(ISecurityPool securityPool, uint256[] memory outcomeIndices) external;
	function createChildUniverse(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IDualCapBatchAuction.TickIndex[] memory tickIndices) external;
	function getQuestionOutcome(ISecurityPool securityPool) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
