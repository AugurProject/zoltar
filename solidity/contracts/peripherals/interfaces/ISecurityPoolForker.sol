// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ISecurityPool } from './ISecurityPool.sol';
import { Outcomes } from '../Outcomes.sol';
import { IDualCapBatchAuction } from './IDualCapBatchAuction.sol';

interface ISecurityPoolForker {
	function forkSecurityPool(ISecurityPool securityPool) external;
	function createChildUniverse(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(ISecurityPool securityPool, address vault, IDualCapBatchAuction.TickIndex[] memory tickIndices) external;
	function getMarketOutcome(ISecurityPool securityPool) external view returns (Outcomes.Outcome outcome);
}
