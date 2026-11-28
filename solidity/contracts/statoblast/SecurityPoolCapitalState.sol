// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { ICapitalFeeStreams } from './interfaces/ICapitalAccounting.sol';
import { SecurityPoolCommitmentIndex, maximumHealthyPriceOf } from './SecurityPoolCommitmentIndex.sol';
import { ISecurityPoolRepairAuctionCapital } from './interfaces/ISecurityPoolRepairAuctionCapital.sol';

/// @dev The fork coordinator's registry of each universe's repair auction.
interface ICapitalRepairAuctions {
	function repairAuctions(uint248 universeId) external view returns (address);
}

/// @dev Exact shared storage for the custody ledger and its lifecycle delegate.
/// The delegate uses host getters for immutable configuration; only the ledger
/// holds assets or authorizes calls. Keep all mutable ledger state here.
abstract contract SecurityPoolCapitalState {
	uint256 internal constant BPS = 10_000;
	struct TakeoverBounds {
		uint256 maximumOwnerPrincipal;
		uint256 maximumOwnerCommitment;
		uint256 expectedTargetHealthFactorBps;
		uint256 expectedAcceptedPriceEpoch;
		uint96 expectedSourceBatch;
	}

	// The ledger and its lifecycle delegate share these events: the delegate
	// emits them in the ledger's context, and the ledger's ABI carries them.
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amountAttoRep);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event CommitmentCured(uint96 indexed positionId, uint256 removedCommitment);
	event CommitmentTakenOver(uint96 indexed sourceId, uint96 indexed receiverId, uint256 commitment, uint256 takeoverRewardAttoRep);
	SecurityPoolCommitmentIndex public commitmentIndex;
	ICapitalFeeStreams public feeStreams;
	address public services;
	address public forkAuthority;
	uint256 public acceptedPrice;
	uint256 public conservativePrice;
	uint256 public liquidationPrice;
	uint256 public acceptedPriceEpoch;
	uint48 public priceValidUntil;
	uint256 public demandAttoEth;
	uint256 public pendingServiceCash;
	uint256 public pendingBurnCash;
	uint256 public totalFreeAttoRep;
	uint256 public retirementCashAttoRep;
	uint256 public frozenBackingAttoRep;
	uint256 public frozenCommitmentAttoEth;
	bool public frozen;
	bool public importing;
	bool public migrationPrepared;
	bool internal entered;
	bool internal checkpointing;

	struct Owner {
		uint256 freeAttoRep;
		uint256 feesAttoEth;
		uint256 feesAttoRep;
		uint256 targetHealthFactorBps;
		uint96 positionId;
	}
	struct ChoicePosition {
		uint256 rep;
		uint256 commitment;
		uint96 batch;
		uint256 remainingCommitment;
		uint64 retirementOrder;
	}
	struct FundingPrice {
		uint256 floor;
		uint256 epoch;
	}
	/// @dev `unclaimedRepairAuctionBids` counts the owner's repair auction bids
	/// not yet claimed; an owner cannot export a fork choice while any remain.
	/// It shares `exported`'s slot.
	struct OwnerState {
		Owner account;
		FundingPrice fundingPrice;
		bool exported;
		uint64 unclaimedRepairAuctionBids;
	}
	mapping(address => OwnerState) internal owners;

	function exported(address owner) public view returns (bool) {
		return owners[owner].exported;
	}

	struct RepairAuctionCohort {
		ISecurityPoolRepairAuctionCapital adapter;
		uint96 positionId;
		uint256 remainingLots;
		uint256 repPerLot;
		uint256 commitmentPerLot;
	}
	/// @dev Liquidation and earnings describe an unclaimed winning bid's share of
	/// the cohort. A claimed bid's lots belong to its bidder's account.
	struct RepairAuctionPosition {
		address bidder;
		uint256 principal;
		uint256 commitment;
		uint48 liquidationStarted;
		bool claimed;
		uint256 earnedAttoEth;
		uint256 earnedAttoRep;
	}
	RepairAuctionCohort public repairAuctionCohort;
	mapping(uint256 => bool) public repairAuctionBidClaimed;

	function _settleOwner(address owner) internal {
		require(owner != address(repairAuctionCohort.adapter), 'Materialize an individual repair auction bidder');
		Owner storage account = owners[owner].account;
		uint96 id = account.positionId;
		if (id == 0) return;
		(uint256 rep, uint256 ethFees, uint256 repFees, uint256 commitment) = commitmentIndex.claim(id);
		account.freeAttoRep += rep;
		totalFreeAttoRep += rep;
		retirementCashAttoRep -= rep;
		account.feesAttoRep += repFees;
		account.feesAttoEth += ethFees;
		if (commitment == 0) account.positionId = 0;
	}
	address internal reportOwner;

	/// @dev Only the ledger's authenticated self-call inherits the report sponsor.
	/// Reentrant external calls keep their actual caller identity.
	function _capitalOwner() internal view returns (address) {
		return msg.sender == address(this) && reportOwner != address(0) ? reportOwner : msg.sender;
	}
	function _maximumHealthyPrice(uint256 rep, uint256 commitment, uint256 multiplier) internal pure returns (uint256) {
		return maximumHealthyPriceOf(rep, commitment, multiplier);
	}
	function _target(Owner storage owner) internal view returns (uint256) {
		return owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
	}
	function _sendCollateral(address recipient, uint256 amount) internal {
		if (amount == 0) return;
		if (pendingServiceCash != 0) {
			pendingServiceCash = 0;
			ICapitalServiceCash(services).withdrawCapitalCash();
		}
		Collateral.send(ICollateralConfig(ICapitalSecurityPool(address(this)).securityPool()).collateralToken(), recipient, amount);
	}
}

interface ICapitalSecurityPool {
	function securityPool() external view returns (address);
}

interface ICapitalServiceCash {
	function withdrawCapitalCash() external;
}
