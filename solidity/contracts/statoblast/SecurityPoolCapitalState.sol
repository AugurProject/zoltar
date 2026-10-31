// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ICapitalFeeStreams } from './interfaces/ICapitalAccounting.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';

/// @dev Exact shared storage for the custody ledger and its lifecycle delegate.
/// The delegate uses host getters for immutable configuration; only the ledger
/// holds assets or authorizes calls. Keep all mutable ledger state here.
abstract contract SecurityPoolCapitalState {
	uint256 internal constant BPS = 10_000;
	SecurityPoolCommitmentIndex public commitmentIndex;
	ICapitalFeeStreams public feeStreams;
	address public services;
	address public forkAuthority;
	uint256 public acceptedPrice;
	uint256 public conservativePrice;
	uint256 public liquidationPrice;
	uint256 public acceptedPriceEpoch;
	mapping(address => uint256) public fundingPriceFloor;
	mapping(address => uint256) public fundingPriceEpoch;
	uint48 public priceValidUntil;
	uint256 public demandAttoEth;
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
	}
	mapping(address => Owner) internal owners;
	mapping(address => bool) public exported;

	struct AuctionCohort {
		ISecurityPoolAuctionCapital adapter;
		uint96 positionId;
		uint256 remainingLots;
		uint256 repPerLot;
		uint256 commitmentPerLot;
	}
	struct AuctionPosition {
		address vault;
		uint96 positionId;
		uint256 principal;
		uint256 commitment;
		uint256 targetHealthFactorBps;
		uint48 liquidationStarted;
		bool materialized;
		uint256 earnedAttoEth;
		uint256 earnedAttoRep;
	}
	AuctionCohort public auctionCohort;
	mapping(uint256 => uint96) public auctionBidPositionIds;

	function _settleOwner(address owner) internal {
		require(owner != address(auctionCohort.adapter), 'Materialize an individual auction vault');
		Owner storage account = owners[owner];
		uint96 id = account.positionId;
		if (id == 0) return;
		(uint256 rep, uint256 ethFees, uint256 repFees) = commitmentIndex.claim(id);
		account.freeAttoRep += rep;
		totalFreeAttoRep += rep;
		retirementCashAttoRep -= rep;
		account.feesAttoRep += repFees;
		bool live = commitmentIndex.accountOf(id).commitment != 0;
		account.feesAttoEth += ethFees;
		if (!live) {
			account.positionId = 0;
		}
	}
	function _target(Owner storage owner) internal view returns (uint256) {
		return owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
	}
	function _sendEth(address recipient, uint256 amount) internal {
		if (amount == 0) return;
		(bool success, ) = recipient.call{value: amount}('');
		require(success, 'Capital ETH transfer failed');
	}
}
