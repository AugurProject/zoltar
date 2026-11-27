// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice The security pool auction controller authenticates one immutable bid
/// owner and its exact winning lots. Winning lots belong to the bidder's own
/// capital account. Fee amounts are accounting only: their assets stay in
/// capital custody.
interface ISecurityPoolRepairAuctionCapital {
	struct BidPosition {
		address bidder;
		uint256 filledLots;
	}

	function bidPosition(uint256 bidId) external view returns (BidPosition memory);
	function bidderBidCount(address bidder) external view returns (uint256);
	function bidderBidId(address bidder, uint256 index) external view returns (uint256);
	function previewBidFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external view returns (uint256 ownedAttoEth, uint256 ownedAttoRep);
	function claimAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external returns (uint256 ownedAttoEth, uint256 ownedAttoRep);
}
