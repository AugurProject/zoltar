// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

contract OwnForkEscalationClaimHarness {
	function previewOwnForkEscalationBackingUnitsToCredit(
		uint256 childRepAmountAttoRep,
		uint256 childBackingUnitsDenominator,
		uint256 auctionableRepAtForkAttoRep
	) external pure returns (uint256 backingUnitsToCredit) {
		require(auctionableRepAtForkAttoRep > 0, 'Own-fork auctionable REP at fork must be non-zero');
		require(childRepAmountAttoRep > 0, 'Own-fork child REP amount must be positive');
		require(childBackingUnitsDenominator > 0, 'Own-fork child backingUnits denominator must be positive');
		backingUnitsToCredit =
			(childRepAmountAttoRep * childBackingUnitsDenominator + auctionableRepAtForkAttoRep - 1) /
			auctionableRepAtForkAttoRep;
	}

	function previewOwnForkEscalationBackingUnitsSequence(
		uint256[] calldata childRepAmountsAttoRep,
		uint256 childBackingUnitsDenominator,
		uint256 auctionableRepAtForkAttoRep
	) external pure returns (uint256[] memory backingUnitsCredits, uint256 totalBackingUnitsClaimed) {
		require(auctionableRepAtForkAttoRep > 0, 'Own-fork auctionable REP at fork must be non-zero');
		require(childBackingUnitsDenominator > 0, 'Own-fork child backingUnits denominator must be positive');
		backingUnitsCredits = new uint256[](childRepAmountsAttoRep.length);
		uint256 childRepClaimedAttoRep = 0;
		uint256 backingUnitsClaimed = 0;
		for (uint256 index = 0; index < childRepAmountsAttoRep.length; index++) {
			childRepClaimedAttoRep += childRepAmountsAttoRep[index];
			uint256 nextBackingUnitsClaimed =
				(childRepClaimedAttoRep * childBackingUnitsDenominator + auctionableRepAtForkAttoRep - 1) /
					auctionableRepAtForkAttoRep;
			uint256 backingUnitsToCredit = nextBackingUnitsClaimed - backingUnitsClaimed;
			backingUnitsCredits[index] = backingUnitsToCredit;
			backingUnitsClaimed = nextBackingUnitsClaimed;
		}
		totalBackingUnitsClaimed = backingUnitsClaimed;
	}

	function previewOwnForkEscalationSettlementCollateralSequence(
		uint256[] calldata childRepAmountsAttoRep,
		uint256 parentSettlementCollateralAtForkAttoEth,
		uint256 auctionableRepAtForkAttoRep
	)
		external
		pure
		returns (
			uint256[] memory settlementCollateralTransfersAttoEth,
			uint256 totalSettlementCollateralTransferredAttoEth
		)
	{
		require(auctionableRepAtForkAttoRep > 0, 'Own-fork auctionable REP at fork must be non-zero');
		settlementCollateralTransfersAttoEth = new uint256[](childRepAmountsAttoRep.length);
		uint256 childRepTransferredAttoRep = 0;
		uint256 settlementCollateralTransferredAttoEth = 0;
		for (uint256 index = 0; index < childRepAmountsAttoRep.length; index++) {
			childRepTransferredAttoRep += childRepAmountsAttoRep[index];
			uint256 nextSettlementCollateralTransferredAttoEth =
				(parentSettlementCollateralAtForkAttoEth * childRepTransferredAttoRep +
					auctionableRepAtForkAttoRep -
					1) / auctionableRepAtForkAttoRep;
			settlementCollateralTransfersAttoEth[index] =
				nextSettlementCollateralTransferredAttoEth - settlementCollateralTransferredAttoEth;
			settlementCollateralTransferredAttoEth = nextSettlementCollateralTransferredAttoEth;
		}
		totalSettlementCollateralTransferredAttoEth = settlementCollateralTransferredAttoEth;
	}
}
