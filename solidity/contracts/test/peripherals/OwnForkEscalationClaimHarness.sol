// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract OwnForkEscalationClaimHarness {
	struct RepBuckets {
		uint256 unallocatedEscrowChildRep;
		uint256 unallocatedEscrowSourceRep;
	}

	mapping(address => RepBuckets) private repBucketsByParent;

	function setOwnForkRepBuckets(
		address parent,
		uint256 escalationChildRepAtFork,
		uint256 escalationSourceRep
	) external {
		repBucketsByParent[parent] = RepBuckets({
			unallocatedEscrowChildRep: escalationChildRepAtFork,
			unallocatedEscrowSourceRep: escalationSourceRep
		});
	}

	function previewOwnForkEscalationClaim(address parent, uint256 sourceRepAmount) external returns (uint256 childRepAmount) {
		RepBuckets storage repBuckets = repBucketsByParent[parent];
		uint256 unallocatedEscrowSourceRep = repBuckets.unallocatedEscrowSourceRep;
		uint256 unallocatedEscrowChildRep = repBuckets.unallocatedEscrowChildRep;
		require(unallocatedEscrowSourceRep >= sourceRepAmount, 'own fork escalation exhausted');
		if (sourceRepAmount == unallocatedEscrowSourceRep) {
			childRepAmount = unallocatedEscrowChildRep;
		} else {
			childRepAmount = (sourceRepAmount * unallocatedEscrowChildRep + unallocatedEscrowSourceRep - 1) / unallocatedEscrowSourceRep;
		}
		repBuckets.unallocatedEscrowSourceRep = unallocatedEscrowSourceRep - sourceRepAmount;
		repBuckets.unallocatedEscrowChildRep = unallocatedEscrowChildRep - childRepAmount;
	}

	function previewOwnForkEscalationOwnershipToCredit(
		uint256 childRepAmount,
		uint256 childOwnershipDenominator,
		uint256 auctionableRepAtFork
	) external pure returns (uint256 ownershipToCredit) {
		require(auctionableRepAtFork > 0, 'missing own fork rep');
		require(childRepAmount > 0, 'invalid child rep');
		require(childOwnershipDenominator > 0, 'invalid child denominator');
		ownershipToCredit = (childRepAmount * childOwnershipDenominator + auctionableRepAtFork - 1) / auctionableRepAtFork;
	}

	function previewOwnForkEscalationOwnershipSequence(
		uint256[] calldata childRepAmounts,
		uint256 childOwnershipDenominator,
		uint256 auctionableRepAtFork
	) external pure returns (uint256[] memory ownershipCredits, uint256 totalOwnershipClaimed) {
		require(auctionableRepAtFork > 0, 'missing own fork rep');
		require(childOwnershipDenominator > 0, 'invalid child denominator');
		ownershipCredits = new uint256[](childRepAmounts.length);
		uint256 childRepClaimed = 0;
		uint256 ownershipClaimed = 0;
		for (uint256 index = 0; index < childRepAmounts.length; index++) {
			childRepClaimed += childRepAmounts[index];
			uint256 nextOwnershipClaimed = (childRepClaimed * childOwnershipDenominator + auctionableRepAtFork - 1) / auctionableRepAtFork;
			uint256 ownershipToCredit = nextOwnershipClaimed - ownershipClaimed;
			ownershipCredits[index] = ownershipToCredit;
			ownershipClaimed = nextOwnershipClaimed;
		}
		totalOwnershipClaimed = ownershipClaimed;
	}

	function previewOwnForkEscalationCollateralSequence(
		uint256[] calldata childRepAmounts,
		uint256 parentCollateralAtFork,
		uint256 auctionableRepAtFork
	) external pure returns (uint256[] memory collateralTransfers, uint256 totalCollateralTransferred) {
		require(auctionableRepAtFork > 0, 'missing own fork rep');
		collateralTransfers = new uint256[](childRepAmounts.length);
		uint256 childRepTransferred = 0;
		uint256 collateralTransferred = 0;
		for (uint256 index = 0; index < childRepAmounts.length; index++) {
			childRepTransferred += childRepAmounts[index];
			uint256 nextCollateralTransferred = (parentCollateralAtFork * childRepTransferred + auctionableRepAtFork - 1) / auctionableRepAtFork;
			collateralTransfers[index] = nextCollateralTransferred - collateralTransferred;
			collateralTransferred = nextCollateralTransferred;
		}
		totalCollateralTransferred = collateralTransferred;
	}

	function previewOwnForkUnresolvedEscalationAllocation(
		address[] calldata vaults,
		uint256[] calldata sourceAmounts,
		uint256 childRepAtFork
	) external pure returns (uint256[] memory childAmounts) {
		require(vaults.length == sourceAmounts.length, 'length mismatch');
		uint256 vaultCount = vaults.length;
		uint256 totalSourceRep = 0;
		for (uint256 index = 0; index < vaultCount; index++) {
			totalSourceRep += sourceAmounts[index];
		}
		childAmounts = new uint256[](vaultCount);
		for (uint256 index = 0; index < vaultCount; index++) {
			childAmounts[index] = sourceAmounts[index] * childRepAtFork / totalSourceRep;
		}
	}

	function previewOwnForkUnresolvedEscalationNoop(uint256[] calldata exportedAmounts, uint256 childRepAmount) external pure returns (uint256[] memory returnedAmounts) {
		returnedAmounts = new uint256[](exportedAmounts.length);
		for (uint256 index = 0; index < exportedAmounts.length; index++) {
			returnedAmounts[index] = exportedAmounts[index];
		}
		if (childRepAmount == 0) return returnedAmounts;
	}
}
