// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import {
	SecurityPoolForkerForkData,
	OwnForkChildRepAllocation,
	PendingEscalationMigrationBatch
} from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerStorage {
	mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint256 => OwnForkChildRepAllocation))
		internal ownForkChildRepAllocationByPoolAndOutcome;
	mapping(ISecurityPool => mapping(uint256 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	mapping(ISecurityPool => mapping(uint256 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(ISecurityPool => mapping(uint256 => uint256)) internal childPoolRepSplitByPoolAndOutcome;
	mapping(ISecurityPool => uint256[]) internal childOutcomeIndexesByPool;
	mapping(ISecurityPool => mapping(uint256 => bool)) internal childOutcomeRegisteredByPool;
	mapping(ISecurityPool => bool) internal escalationMigrationStartedByPool;
	mapping(ISecurityPool => bool) internal registeredContinuationDeploymentByPool;
	mapping(ISecurityPool => mapping(address => PendingEscalationMigrationBatch))
		internal pendingEscalationMigrationBatchByPoolAndVault;
	mapping(address => bool) internal trustedAuctionAddresses;
}
