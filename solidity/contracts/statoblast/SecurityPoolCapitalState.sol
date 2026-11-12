// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
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
	struct FundingPrice {
		uint256 floor;
		uint256 epoch;
	}
	struct OwnerState {
		Owner account;
		FundingPrice fundingPrice;
		bool exported;
	}
	mapping(address => OwnerState) internal owners;

	function fundingPriceFloor(address owner) public view returns (uint256) {
		return owners[owner].fundingPrice.floor;
	}
	function fundingPriceEpoch(address owner) public view returns (uint256) {
		return owners[owner].fundingPrice.epoch;
	}
	function exported(address owner) public view returns (bool) {
		return owners[owner].exported;
	}

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
	function _target(Owner storage owner) internal view returns (uint256) {
		return owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
	}
	function _sendEth(address recipient, uint256 amount) internal {
		if (amount == 0) return;
		Collateral.send(ICollateralConfig(ICapitalPortfolio(address(this)).portfolio()).collateralToken(), recipient, amount);
	}
}

interface ICapitalPortfolio {
	function portfolio() external view returns (address);
}
