// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCapitalState } from './SecurityPoolCapitalState.sol';
import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';
import { IERC20 } from '../IERC20.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';

interface ICapitalAuctionHost {
	function repToken() external view returns (IERC20);
	function securityMultiplierBps() external view returns (uint256);
	function maximumHealthyPrice(uint256 rep, uint256 commitment) external view returns (uint256);
	function storedOwnerAccount(address owner) external view returns (SecurityPoolCapitalState.Owner memory);
	function commitmentIndex() external view returns (SecurityPoolCommitmentIndex);
	function auctionCohort()
		external
		view
		returns (
			ISecurityPoolAuctionCapital adapter,
			uint96 positionId,
			uint256 remainingLots,
			uint256 repPerLot,
			uint256 commitmentPerLot
		);
	function auctionBidPositionIds(uint256 bidId) external view returns (uint96);
	function importing() external view returns (bool);
	function frozen() external view returns (bool);
	function exported(address owner) external view returns (bool);
	function isPriceValid() external view returns (bool);
	function ownerConservativePrice(address owner) external view returns (uint256);
	function zoltar() external view returns (Zoltar);
	function universeId() external view returns (uint248);
}

/// @notice A funded auction cohort represents individually owned, equal-ratio
/// positions. Only one bid is detached before any owner mutation or keeper loss.
contract SecurityPoolCapitalAuctionDelegate is SecurityPoolCapitalState {
	address public immutable ledger;
	event AuctionCohortInstalled(address indexed adapter, uint96 indexed positionId, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot);
	event AuctionBidMaterialized(uint256 indexed bidId, address indexed vault, uint96 indexed positionId, uint256 principal, uint256 commitment);

	constructor(address host) {
		ledger = host;
	}
	modifier onlyLedger() {
		require(address(this) == ledger, 'Only capital ledger context');
		_;
	}

	function install(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot, uint256 minimumCommitment) external onlyLedger {
		require(importing && address(auctionCohort.adapter) == address(0), 'Auction cohort installation unavailable');
		require(adapter.code.length != 0 && lots != 0 && repPerLot != 0 && commitmentPerLot == minimumCommitment, 'Invalid auction cohort');
		ICapitalAuctionHost host = ICapitalAuctionHost(address(this));
		// The ordinary index floors REP before dividing by K. This congruence
		// makes that first division exact per lot, including a one-lot winner.
		require(mulmod(repPerLot, BPS, host.securityMultiplierBps()) == 0, 'Auction collateral ratio rounds per vault');
		uint256 principal = lots * repPerLot;
		uint256 commitment = lots * commitmentPerLot;
		(uint256 existing, ) = commitmentIndex.totals();
		require(host.repToken().balanceOf(address(this)) >= existing + principal + totalFreeAttoRep + retirementCashAttoRep, 'Auction principal unfunded');
		uint256 threshold = host.maximumHealthyPrice(repPerLot, commitmentPerLot);
		uint96 id = commitmentIndex.importPosition(adapter, principal, commitment, threshold, 0, 0);
		auctionCohort = AuctionCohort(ISecurityPoolAuctionCapital(adapter), id, lots, repPerLot, commitmentPerLot);
		emit AuctionCohortInstalled(adapter, id, lots, repPerLot, commitmentPerLot);
	}

	function materialize(uint256 bidId) external onlyLedger returns (address vault, uint96 id) {
		AuctionCohort storage cohort = auctionCohort;
		require(!importing && address(cohort.adapter) != address(0) && bidId != 0, 'Auction capital unavailable');
		ISecurityPoolAuctionCapital.BidPosition memory bid = cohort.adapter.bidPosition(bidId);
		vault = bid.vault;
		require(vault != address(0) && vault != address(cohort.adapter), 'Auction vault missing');
		id = auctionBidPositionIds[bidId];
		if (id != 0 || bid.filledLots == 0) return (vault, id);
		require(bid.filledLots <= cohort.remainingLots && bid.targetHealthFactorBps >= BPS, 'Invalid auction position');
		Owner storage owner = owners[vault];
		require(owner.positionId == 0 && owner.freeAttoRep == 0 && !exported[vault], 'Auction vault already has principal');
		(uint256 released, uint256 ethFees, uint256 repFees) = commitmentIndex.claim(cohort.positionId);
		require(released == 0, 'Auction cohort cannot retire');
		(ethFees, repFees) = cohort.adapter.claimAndRemoveFees(bidId, ethFees, repFees);
		uint256 principal = bid.filledLots * cohort.repPerLot;
		uint256 commitment = bid.filledLots * cohort.commitmentPerLot;
		id = commitmentIndex.splitAuctionPosition(cohort.positionId, vault, principal, commitment);
		auctionBidPositionIds[bidId] = id;
		cohort.remainingLots -= bid.filledLots;
		owner.positionId = id;
		owner.targetHealthFactorBps = bid.targetHealthFactorBps;
		owner.feesAttoEth += ethFees;
		owner.feesAttoRep += repFees;
		emit AuctionBidMaterialized(bidId, vault, id, principal, commitment);
	}

	/// @dev View calls read the immutable host explicitly; they do not delegatecall
	/// or inspect this helper's empty state. Heavy previews stay outside the host's
	/// runtime while its ordinary public getters keep the same interpretation.
	function previewOwner(address holder) external view returns (Owner memory owner) {
		ICapitalAuctionHost host = ICapitalAuctionHost(ledger);
		owner = host.storedOwnerAccount(holder);
		(, , uint256 target) = _virtualCapital(host, holder);
		if (target != 0) owner.targetHealthFactorBps = target;
	}
	function previewCollateral(address holder) external view returns (uint256 principal, uint256 commitment, uint256 withdrawable) {
		ICapitalAuctionHost host = ICapitalAuctionHost(ledger);
		Owner memory owner = host.storedOwnerAccount(holder);
		SecurityPoolCommitmentIndex index = host.commitmentIndex();
		SecurityPoolCommitmentIndex.Account memory position = index.accountOf(owner.positionId);
		(uint256 virtualRep, uint256 virtualK, uint256 target) = _virtualCapital(host, holder);
		withdrawable = owner.freeAttoRep + position.releasedRep;
		uint256 pledged = position.rep + virtualRep;
		principal = withdrawable + pledged;
		commitment = position.commitment + virtualK;
		if (commitment == 0) return (principal, 0, principal);
		if (
			host.importing() ||
			host.frozen() ||
			host.exported(holder) ||
			host.zoltar().getForkTime(host.universeId()) != 0 ||
			!host.isPriceValid()
		) return (principal, commitment, withdrawable);
		if (target == 0) target = owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
		uint256 required = index.requiredRep(commitment, host.ownerConservativePrice(holder), host.securityMultiplierBps(), target);
		if (pledged > required) withdrawable += pledged - required;
	}
	function previewAuctionPosition(uint256 bidId) external view returns (AuctionPosition memory result) {
		ICapitalAuctionHost host = ICapitalAuctionHost(ledger);
		(ISecurityPoolAuctionCapital adapter, uint96 cohortId, , uint256 repPerLot, uint256 commitmentPerLot) = host.auctionCohort();
		require(address(adapter) != address(0), 'Auction capital unavailable');
		ISecurityPoolAuctionCapital.BidPosition memory bid = adapter.bidPosition(bidId);
		result.vault = bid.vault;
		result.materialized = host.auctionBidPositionIds(bidId) != 0;
		Owner memory owner = host.storedOwnerAccount(bid.vault);
		SecurityPoolCommitmentIndex index = host.commitmentIndex();
		if (!result.materialized) {
			result.principal = bid.filledLots * repPerLot;
			result.commitment = bid.filledLots * commitmentPerLot;
			result.targetHealthFactorBps = bid.targetHealthFactorBps;
			if (bid.filledLots != 0) {
				SecurityPoolCommitmentIndex.Account memory aggregate = index.accountOf(cohortId);
				result.liquidationStarted = index.liquidationStarted(cohortId);
				(result.earnedAttoEth, result.earnedAttoRep) = adapter.previewBidFees(bidId, aggregate.ethFees, aggregate.repFees);
			}
		} else {
			result.positionId = owner.positionId;
			SecurityPoolCommitmentIndex.Account memory position = index.accountOf(owner.positionId);
			result.principal = owner.freeAttoRep + position.rep + position.releasedRep;
			result.commitment = position.commitment;
			result.targetHealthFactorBps = owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
			result.liquidationStarted = index.liquidationStarted(owner.positionId);
			result.earnedAttoEth = position.ethFees;
			result.earnedAttoRep = position.repFees;
		}
		result.earnedAttoEth += owner.feesAttoEth;
		result.earnedAttoRep += owner.feesAttoRep;
	}
	function _virtualCapital(ICapitalAuctionHost host, address holder) private view returns (uint256 principal, uint256 commitment, uint256 target) {
		(ISecurityPoolAuctionCapital adapter, , , uint256 repPerLot, uint256 commitmentPerLot) = host.auctionCohort();
		if (address(adapter) == address(0)) return (0, 0, 0);
		uint256 bidId = adapter.bidIdForVault(holder);
		if (bidId == 0 || host.auctionBidPositionIds(bidId) != 0) return (0, 0, 0);
		ISecurityPoolAuctionCapital.BidPosition memory bid = adapter.bidPosition(bidId);
		if (bid.filledLots == 0) return (0, 0, 0);
		return (bid.filledLots * repPerLot, bid.filledLots * commitmentPerLot, bid.targetHealthFactorBps);
	}
}
