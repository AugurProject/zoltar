// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';
import { SecurityPoolMigrationProxy } from './SecurityPoolMigrationProxy.sol';

struct SecurityPoolForkerForkData {
	uint256 repAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;
	uint256 claimedAuctionRepPurchased;
	uint256 claimedAuctionedSecurityBondAllowance;
	uint256 escalationElapsedAtFork;
	uint256 escalationStartBondAtFork;
	uint256 escalationNonDecisionThresholdAtFork;
	bool ownFork;
	bool unresolvedEscalationAtFork;
	uint8 outcomeIndex;
}

abstract contract SecurityPoolForkerStorage {
	mapping(ISecurityPool => SecurityPoolForkerForkData) internal forkDataByPool;
	mapping(ISecurityPool => mapping(uint8 => ISecurityPool)) internal childrenByPoolAndOutcome;
	mapping(ISecurityPool => SecurityPoolMigrationProxy) internal migrationProxyByPool;
	mapping(ISecurityPool => mapping(uint8 => uint256)) internal pendingChildRepByPoolAndOutcome;
	mapping(address => bool) internal trustedAuctionAddresses;
}
