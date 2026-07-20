// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract OwnForkEscalationClaimHarness {
	function previewOwnForkEscalationOwnershipToCredit(
		uint256 childRepAmount,
		uint256 childOwnershipDenominator,
		uint256 auctionableRepAtFork
	) external pure returns (uint256 ownershipToCredit) {
		require(auctionableRepAtFork > 0, 'Own-fork auctionable REP at fork must be non-zero');
		require(childRepAmount > 0, 'Own-fork child REP amount must be positive');
		require(childOwnershipDenominator > 0, 'Own-fork child ownership denominator must be positive');
		ownershipToCredit =
			(childRepAmount * childOwnershipDenominator + auctionableRepAtFork - 1) / auctionableRepAtFork;
	}

	function previewOwnForkEscalationOwnershipSequence(
		uint256[] calldata childRepAmounts,
		uint256 childOwnershipDenominator,
		uint256 auctionableRepAtFork
	) external pure returns (uint256[] memory ownershipCredits, uint256 totalOwnershipClaimed) {
		require(auctionableRepAtFork > 0, 'Own-fork auctionable REP at fork must be non-zero');
		require(childOwnershipDenominator > 0, 'Own-fork child ownership denominator must be positive');
		ownershipCredits = new uint256[](childRepAmounts.length);
		uint256 childRepClaimed = 0;
		uint256 ownershipClaimed = 0;
		for (uint256 index = 0; index < childRepAmounts.length; index++) {
			childRepClaimed += childRepAmounts[index];
			uint256 nextOwnershipClaimed =
				(childRepClaimed * childOwnershipDenominator + auctionableRepAtFork - 1) / auctionableRepAtFork;
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
		require(auctionableRepAtFork > 0, 'Own-fork auctionable REP at fork must be non-zero');
		collateralTransfers = new uint256[](childRepAmounts.length);
		uint256 childRepTransferred = 0;
		uint256 collateralTransferred = 0;
		for (uint256 index = 0; index < childRepAmounts.length; index++) {
			childRepTransferred += childRepAmounts[index];
			uint256 nextCollateralTransferred =
				(parentCollateralAtFork * childRepTransferred + auctionableRepAtFork - 1) / auctionableRepAtFork;
			collateralTransfers[index] = nextCollateralTransferred - collateralTransferred;
			collateralTransferred = nextCollateralTransferred;
		}
		totalCollateralTransferred = collateralTransferred;
	}
}
