// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalState, ICapitalRepairAuctions } from './SecurityPoolCapitalState.sol';
import { ISecurityPoolRepairAuctionCapital } from './interfaces/ISecurityPoolRepairAuctionCapital.sol';
import { IERC20 } from '../IERC20.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';

interface ICapitalRepairAuctionHost {
	function repToken() external view returns (IERC20);
	function securityMultiplierBps() external view returns (uint256);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function ownerAccount(address owner) external view returns (SecurityPoolCapitalState.Owner memory);
	function commitmentIndex() external view returns (SecurityPoolCommitmentIndex);
	function repairAuctionCohort()
		external
		view
		returns (
			ISecurityPoolRepairAuctionCapital adapter,
			uint96 positionId,
			uint256 remainingLots,
			uint256 repPerLot,
			uint256 commitmentPerLot
		);
	function repairAuctionBidClaimed(uint256 bidId) external view returns (bool);
	function forkAuthority() external view returns (address);
	function importing() external view returns (bool);
	function frozen() external view returns (bool);
	function exported(address owner) external view returns (bool);
	function isPriceValid() external view returns (bool);
	function ownerConservativePrice(address owner) external view returns (uint256);
	function demandAttoEth() external view returns (uint256);
	function conservativePrice() external view returns (uint256);
	function zoltar() external view returns (Zoltar);
	function universeId() external view returns (uint248);
}

/// @notice A funded auction cohort represents individually owned, equal-ratio
/// lots. Each bid is claimed on its own: its winning lots join the bidder's
/// account and the bidder's unclaimed-bid count falls. No path loops over a
/// bidder's bids, so a bidder may place any number of them.
contract SecurityPoolCapitalRepairAuctionDelegate is SecurityPoolCapitalState {
	address public immutable implementation = address(this);
	event RepairAuctionCohortInstalled(address indexed adapter, uint96 indexed positionId, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot);
	event RepairAuctionBidMaterialized(uint256 indexed bidId, address indexed bidder, uint96 indexed positionId, uint256 principal, uint256 commitment);

	modifier onlyDelegateCall() {
		require(address(this) != implementation, 'Only capital delegatecall');
		_;
	}

	function install(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot) external onlyDelegateCall {
		require(importing && address(repairAuctionCohort.adapter) == address(0), 'Auction cohort installation unavailable');
		ICapitalRepairAuctionHost host = ICapitalRepairAuctionHost(address(this));
		require(adapter.code.length != 0 && lots != 0 && repPerLot != 0 && commitmentPerLot >= host.minimumCommitmentAttoEth(), 'Invalid auction cohort');
		// The ordinary index floors REP before dividing by K. This congruence
		// makes that first division exact per lot, including a one-lot winner.
		uint256 multiplier = host.securityMultiplierBps();
		require(mulmod(repPerLot, BPS, multiplier) == 0, 'Auction collateral ratio rounds per vault');
		uint256 principal = lots * repPerLot;
		uint256 commitment = lots * commitmentPerLot;
		(uint256 existing, ) = commitmentIndex.totals();
		require(host.repToken().balanceOf(address(this)) >= existing + principal + totalFreeAttoRep + retirementCashAttoRep, 'Auction principal unfunded');
		uint256 threshold = _maximumHealthyPrice(repPerLot, commitmentPerLot, multiplier);
		uint96 id = commitmentIndex.importPosition(adapter, principal, commitment, threshold, 0, 0, 0);
		repairAuctionCohort = RepairAuctionCohort({adapter: ISecurityPoolRepairAuctionCapital(adapter), positionId: id, remainingLots: lots, repPerLot: repPerLot, commitmentPerLot: commitmentPerLot});
		emit RepairAuctionCohortInstalled(adapter, id, lots, repPerLot, commitmentPerLot);
	}

	/// @notice Claim one bid. Its winning lots, if any, join the bidder's account:
	/// a new position when it has none, otherwise a merge into its live position.
	/// A bid that won nothing only stops counting as unclaimed. Repeating a claim
	/// changes nothing. Returns the bidder, whose account holds the claimed lots.
	function materializeBid(uint256 bidId) external onlyDelegateCall returns (address bidder) {
		require(!importing && bidId != 0, 'Auction capital unavailable');
		ISecurityPoolRepairAuctionCapital auction = _repairAuction(ICapitalRepairAuctionHost(address(this)));
		// An unfinalized auction reports only bids already excluded by better ones.
		ISecurityPoolRepairAuctionCapital.BidPosition memory bid = auction.bidPosition(bidId);
		bidder = bid.bidder;
		require(bidder != address(0), 'Auction bid missing');
		if (repairAuctionBidClaimed[bidId]) return bidder;
		repairAuctionBidClaimed[bidId] = true;
		OwnerState storage state = owners[bidder];
		state.unclaimedRepairAuctionBids -= 1;
		if (bid.filledLots == 0) return bidder;
		RepairAuctionCohort storage cohort = repairAuctionCohort;
		require(address(cohort.adapter) == address(auction) && bid.filledLots <= cohort.remainingLots, 'Invalid auction position');
		// Claim released REP and fees first, so the receiving position is live.
		_settleOwner(bidder);
		require(!state.exported, 'Auction bidder already exported');
		(uint256 released, uint256 addedEth, uint256 addedRep, ) = commitmentIndex.claim(cohort.positionId);
		require(released == 0, 'Auction cohort cannot retire');
		(uint256 ethFees, uint256 repFees) = auction.claimAndRemoveFees(bidId, addedEth, addedRep);
		uint256 principal = bid.filledLots * cohort.repPerLot;
		uint256 commitment = bid.filledLots * cohort.commitmentPerLot;
		cohort.remainingLots -= bid.filledLots;
		Owner storage account = state.account;
		uint96 id = account.positionId;
		uint256 maxPrice;
		if (id != 0) {
			SecurityPoolCommitmentIndex.Account memory current = commitmentIndex.accountOf(id);
			maxPrice = _maximumHealthyPrice(current.rep + principal, current.commitment + commitment, ICapitalRepairAuctionHost(address(this)).securityMultiplierBps());
		}
		id = commitmentIndex.moveRepairAuctionShare(cohort.positionId, bidder, id, principal, commitment, maxPrice);
		account.positionId = id;
		account.feesAttoEth += ethFees;
		account.feesAttoRep += repFees;
		emit RepairAuctionBidMaterialized(bidId, bidder, id, principal, commitment);
	}

	/// @dev View calls read the selected host explicitly; they do not delegatecall
	/// or inspect this helper's empty state. Heavy previews stay outside the host's
	/// runtime while its ordinary public getters keep the same interpretation.
	function previewCollateral(ICapitalRepairAuctionHost host, address holder) external view returns (uint256 principal, uint256 commitment, uint256 withdrawable) {
		Owner memory owner = host.ownerAccount(holder);
		SecurityPoolCommitmentIndex index = host.commitmentIndex();
		SecurityPoolCommitmentIndex.Account memory position = index.accountOf(owner.positionId);
		withdrawable = owner.freeAttoRep + position.releasedRep;
		principal = withdrawable + position.rep;
		commitment = position.commitment;
		if (commitment == 0) return (principal, 0, principal);
		if (
			host.importing() ||
			host.frozen() ||
			host.exported(holder) ||
			host.zoltar().getForkTime(host.universeId()) != 0 ||
			!host.isPriceValid() ||
			index.eligibleCommitment(host.conservativePrice()) < host.demandAttoEth()
		) return (principal, commitment, withdrawable);
		uint256 target = owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
		uint256 withdrawalCommitment = commitment;
		if (
			position.batch != 0 &&
			position.commitment != 0 &&
			index.previewRetirement(owner.positionId, host.conservativePrice(), host.demandAttoEth()).status ==
				SecurityPoolCommitmentIndex.RetirementStatus.Ready
		) withdrawalCommitment -= position.commitment - position.remainingCommitment;
		uint256 required = index.requiredRep(withdrawalCommitment, host.ownerConservativePrice(holder), host.securityMultiplierBps(), target);
		if (position.rep > required) withdrawable += position.rep - required;
	}
	/// @notice Each bid's winning lots. Once claimed, they are part of the bidder's
	/// account, whose own position (`ownerAccount(bidder).positionId`) and
	/// earnings it reports instead.
	function previewRepairAuctionPositions(ICapitalRepairAuctionHost host, uint256[] calldata bidIds) external view returns (RepairAuctionPosition[] memory results) {
		ISecurityPoolRepairAuctionCapital auction = _repairAuction(host);
		(
			ISecurityPoolRepairAuctionCapital adapter,
			uint96 cohortId,
			,
			uint256 repPerLot,
			uint256 commitmentPerLot
		) = host.repairAuctionCohort();
		SecurityPoolCommitmentIndex index = host.commitmentIndex();
		results = new RepairAuctionPosition[](bidIds.length);
		for (uint256 slot = 0; slot < bidIds.length; slot++) {
			RepairAuctionPosition memory result = results[slot];
			ISecurityPoolRepairAuctionCapital.BidPosition memory bid = auction.bidPosition(bidIds[slot]);
			result.bidder = bid.bidder;
			result.claimed = host.repairAuctionBidClaimed(bidIds[slot]);
			// Without an installed cohort no bid won any lot.
			if (address(adapter) != address(auction) || bid.filledLots == 0) continue;
			result.principal = bid.filledLots * repPerLot;
			result.commitment = bid.filledLots * commitmentPerLot;
			if (result.claimed) continue;
			SecurityPoolCommitmentIndex.Account memory aggregate = index.accountOf(cohortId);
			result.liquidationStarted = index.liquidationStarted(cohortId);
			(result.earnedAttoEth, result.earnedAttoRep) = auction.previewBidFees(bidIds[slot], aggregate.ethFees, aggregate.repFees);
		}
	}
	function _repairAuction(ICapitalRepairAuctionHost host) private view returns (ISecurityPoolRepairAuctionCapital auction) {
		auction = ISecurityPoolRepairAuctionCapital(ICapitalRepairAuctions(host.forkAuthority()).repairAuctions(host.universeId()));
		require(address(auction) != address(0), 'Auction capital unavailable');
	}
}
