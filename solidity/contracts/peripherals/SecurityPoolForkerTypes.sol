// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { UniformPriceDualCapBatchAuction } from './UniformPriceDualCapBatchAuction.sol';

struct SecurityPoolForkerForkData {
	uint256 auctionableAttoRepAtFork;
	UniformPriceDualCapBatchAuction truthAuction;
	uint256 truthAuctionStarted;
	uint256 migratedAttoRep;
	uint256 auctionedCapacityOwnershipAttoRep;
	uint256 claimedAuctionRepPurchasedAttoRep;
	uint256 claimedAuctionedCapacityOwnershipAttoRep;
	uint256 escalationElapsedAtFork;
	uint256 escalationStartBondAtForkAttoRep;
	uint256 escalationNonDecisionThresholdAtForkAttoRep;
	uint256 escalationSourceRepAtForkAttoRep;
	uint256 escalationChildRepAtForkAttoRep;
	bool ownFork;
	uint256 vaultRepAtForkAttoRep;
	bool unresolvedEscalationAtFork;
	uint256 outcomeIndex;
	bool forkQuestionMatchesPoolQuestion;
	uint8 fixedQuestionOutcomePlusOne;
	uint256 settlementCollateralAtForkAttoEth;
	uint256 migratedRepAllocatedForSettlementCollateralAttoRep;
	uint256 settlementCollateralTransferredAttoEth;
	uint256 migratedCapacityOwnershipAttoRep;
	uint256 auctionRepBackingUnitsPerAttoRep;
	uint256 claimedAuctionRepBackingUnits;
	bytes32 escalationSnapshotId;
	uint256 forkSettlementCollateralReceivedAttoEth;
	uint256 forkActivationTime;
	uint256 migratedRepBackingUnits;
}

struct OwnForkChildRepAllocation {
	uint256 vaultChildRepUsedAttoRep;
	uint256 escrowChildRepUsedAttoRep;
}

struct EscalationMigrationEntitlement {
	uint256[3] sourcePrincipalByOutcomeAttoRep;
	uint256[3] currentRepByOutcomeAttoRep;
	uint256 totalCurrentAttoRep;
	bool initialized;
}

struct EscalationForkSnapshot {
	bytes32[64][3] carryPeaks;
	uint256[3] carryLeafCounts;
	uint256[3] carryTotalsAttoRep;
	uint256[3] resolutionBalancesAttoRep;
	bytes32[3] nullifierRoots;
	bool initialized;
}
