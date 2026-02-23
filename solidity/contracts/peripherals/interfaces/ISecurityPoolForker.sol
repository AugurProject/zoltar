// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ISecurityPool } from './ISecurityPool.sol';
import { YesNoMarkets } from '../YesNoMarkets.sol';

interface ISecurityPoolForker {
	function forkSecurityPool(ISecurityPool securityPool) external;
	function createChildUniverse(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function migrateVault(ISecurityPool securityPool, uint8 outcomeIndex) external;
	function startTruthAuction(ISecurityPool securityPool) external;
	function finalizeTruthAuction(ISecurityPool securityPool) external;
	function forkZoltarWithOwnEscalationGame(ISecurityPool securityPool) external;
	function claimAuctionProceeds(ISecurityPool securityPool, address vault) external;
	function getMarketOutcome(ISecurityPool securityPool) external view returns (YesNoMarkets.Outcome outcome);
}
