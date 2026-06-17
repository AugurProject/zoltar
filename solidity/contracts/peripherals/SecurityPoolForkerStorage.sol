// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';
import { SecurityPoolForkerForkData, OwnForkChildRepAllocation } from './SecurityPoolForkerTypes.sol';

abstract contract SecurityPoolForkerStorage {
	mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint8 => OwnForkChildRepAllocation))
		internal ownForkChildRepAllocationByPoolAndOutcome;
	mapping(ISecurityPool => mapping(uint8 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	mapping(ISecurityPool => mapping(uint8 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(address => bool) internal trustedAuctionAddresses;
}
