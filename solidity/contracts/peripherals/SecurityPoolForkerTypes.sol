// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';

struct SecurityPoolForkerForkData {
	uint256 auctionableRepAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedRep;
	uint256 auctionedSecurityBondAllowance;
	uint256 claimedAuctionRepPurchased;
	uint256 claimedAuctionedSecurityBondAllowance;
	uint256 escalationElapsedAtFork;
	uint256 escalationStartBondAtFork;
	uint256 escalationNonDecisionThresholdAtFork;
	uint256 escalationSourceRepAtFork;
	uint256 escalationChildRepAtFork;
	bool ownFork;
	uint256 vaultRepAtFork;
	bool unresolvedEscalationAtFork;
	uint256 outcomeIndex;
	bool forkQuestionMatchesPoolQuestion;
	uint256 collateralAtFork;
	uint256 migratedRepCollateralized;
	uint256 collateralTransferred;
	uint256 migratedSecurityBondAllowance;
	uint256 auctionPoolOwnershipPerRep;
	uint256 claimedAuctionPoolOwnership;
}

struct OwnForkChildRepAllocation {
	uint256 vaultChildRepUsed;
	uint256 escrowChildRepUsed;
}

struct EscalationMigrationEntitlement {
	uint256[3] sourcePrincipalByOutcome;
	uint256[3] currentRepByOutcome;
	uint256 totalCurrentRep;
	bool initialized;
}

struct EscalationForkSnapshot {
	bytes32[64][3] carryPeaks;
	uint256[3] carryLeafCounts;
	uint256[3] carryTotals;
	uint256[3] resolutionBalances;
	bytes32[3] nullifierRoots;
	bool initialized;
}
