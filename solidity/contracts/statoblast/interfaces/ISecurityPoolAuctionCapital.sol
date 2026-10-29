// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice The portfolio auction controller authenticates one immutable bid
/// owner and its exact winning lots. Fee amounts are accounting only: their
/// assets stay in capital custody. Execution reserves are individually funded.
interface ISecurityPoolAuctionCapital {
	struct BidPosition {
		address vault;
		uint256 targetHealthFactorBps;
		uint256 filledLots;
	}

	function bidPosition(uint256 bidId) external view returns (BidPosition memory);
	function bidIdForVault(address vault) external view returns (uint256);
	function bidExecutionReserve(uint256 bidId) external view returns (uint256);
	function previewBidFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external view returns (uint256 ownedAttoEth, uint256 ownedAttoRep);
	function claimAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external returns (uint256 ownedAttoEth, uint256 ownedAttoRep);
	function releaseBidExecutionReserve(uint256 bidId) external;
}

interface ISecurityPoolAuctionReserveReceiver {
	function receiveAuctionExecutionReserve(uint256 bidId) external payable;
}
