// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import {
	SecurityPoolForkerForkData,
	OwnForkChildRepAllocation,
	EscalationMigrationEntitlement,
	EscalationForkSnapshot
} from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerStorage {
	mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint256 => OwnForkChildRepAllocation))
		internal ownForkChildRepAllocationByPoolAndOutcome;
	mapping(ISecurityPool => mapping(uint256 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	mapping(ISecurityPool => mapping(uint256 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(ISecurityPool => mapping(uint256 => uint256)) internal childPoolRepSplitByPoolAndOutcome;
	mapping(ISecurityPool => mapping(address => EscalationMigrationEntitlement))
		internal escalationMigrationEntitlementByPoolAndVault;
	mapping(ISecurityPool => mapping(address => mapping(uint256 => bool)))
		internal escalationEntitlementMaterializedByPoolVaultAndOutcome;
	mapping(ISecurityPool => EscalationForkSnapshot) internal escalationForkSnapshotByPool;
	mapping(ISecurityPool => mapping(uint256 => bool)) internal escalationBackingMaterializedByPoolAndOutcome;
	mapping(address => bool) internal trustedAuctionAddresses;
	mapping(ISecurityPool => mapping(uint8 => mapping(uint256 => bool)))
		internal directlyClaimedEscalationDepositByPoolOutcomeAndIndex;
	mapping(ISecurityPool => mapping(uint8 => uint256)) internal directlyClaimedEscalationPrincipalByPoolAndOutcome;
}
