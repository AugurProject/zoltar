// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ICapitalFeeStreams,
	ICapitalPriceExposure,
	ICapitalLedgerAccounting
} from './interfaces/ICapitalAccounting.sol';
import { SecurityPoolCapitalState } from './SecurityPoolCapitalState.sol';
import { SecurityPoolCapitalLifecycleDelegate } from './SecurityPoolCapitalLifecycleDelegate.sol';
import { SecurityPoolCapitalAuctionDelegate } from './SecurityPoolCapitalAuctionDelegate.sol';
import { DelegateCall } from './DelegateCall.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { Constants } from '../Constants.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Exact REP custody and individually authorized underwriting.
/// @dev One live position contains all an owner's deposited principal and
/// commitment. Retirement never leaves a sibling position with stale health.
/// Index paths, not the number of owners or questions, bound work.
contract SecurityPoolCapitalLedger is SecurityPoolCapitalState {
	using SafeERC20Ops for IERC20;
	address public immutable portfolio;
	SecurityPoolCapitalLifecycleDelegate public immutable lifecycleDelegate;
	SecurityPoolCapitalAuctionDelegate public immutable auctionDelegate;
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	IERC20 public immutable repToken;
	uint256 public immutable securityMultiplierBps;
	uint256 private immutable minimumCommitmentAttoEth;

	struct CureBounds {
		uint256 expectedTotalCommitment;
		uint256 expectedDemand;
		uint256 expectedAcceptedPriceEpoch;
		uint256 minimumRemoved;
		uint256 minimumReward; // REP credited to the keeper, in attoREP.
	}

	struct TakeoverBounds {
		uint256 maximumOwnerPrincipal;
		uint256 maximumOwnerCommitment;
		uint256 expectedTargetHealthFactorBps;
		uint256 expectedAcceptedPriceEpoch;
		uint96 expectedSourceBatch;
	}

	event PrincipalDeposited(address indexed payer, address indexed owner, uint256 amountAttoRep);
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amountAttoRep);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event RetirementServed(uint256 rep, uint256 commitment);
	event CommitmentCured(uint96 indexed positionId, uint256 removedCommitment, uint256 keeperRewardAttoRep);
	event CommitmentTakenOver(uint96 indexed sourceId, uint96 indexed receiverId, uint256 commitment, uint256 awardAttoRep);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);
	event TerminalFeesBurned(uint256 ethAmount, uint256 repAmount);

	constructor(address authority, Zoltar _zoltar, uint248 _universeId, uint256 multiplier, uint256 minimumCommitment, uint48 vestingDuration) {
		require(authority != address(0), 'Capital authority missing');
		require(minimumCommitment > 0 && vestingDuration > 0, 'Capital economic minimum missing');
		portfolio = authority;
		lifecycleDelegate = new SecurityPoolCapitalLifecycleDelegate(address(this));
		auctionDelegate = new SecurityPoolCapitalAuctionDelegate(address(this));
		zoltar = _zoltar;
		universeId = _universeId;
		repToken = IERC20(address(_zoltar.getRepToken(_universeId)));
		securityMultiplierBps = Math.max(multiplier, 10_500);
		minimumCommitmentAttoEth = minimumCommitment;
		repToken.safeApprove(address(_zoltar), type(uint256).max);
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}
	modifier onlyAccounting() {
		require(msg.sender == portfolio || msg.sender == services, 'Only capital accounting');
		_;
	}
	modifier onlyDemandAccounting() {
		require(msg.sender == portfolio || msg.sender == services || msg.sender == forkAuthority, 'Only demand accounting');
		_;
	}
	modifier onlyForkAuthority() {
		require(msg.sender == portfolio || msg.sender == forkAuthority, 'Only fork authority');
		_;
	}
	modifier nonReentrant() {
		require(!entered, 'Capital operation active');
		entered = true;
		_;
		entered = false;
	}

	function initialize(SecurityPoolCommitmentIndex index, ICapitalFeeStreams streams, address coordinator, address serviceAuthority) external onlyPortfolio {
		require(address(commitmentIndex) == address(0), 'Capital already initialized');
		require(index.portfolio() == address(this), 'Wrong commitment authority');
		commitmentIndex = index;
		feeStreams = streams;
		services = serviceAuthority;
		forkAuthority = coordinator;
	}

	function storedOwnerAccount(address owner) external view returns (Owner memory) {
		return owners[owner];
	}
	function ownerAccount(address owner) external view returns (Owner memory) {
		return auctionDelegate.previewOwner(owner);
	}
	/// @notice Deposited principal includes virtual winning bids and excludes
	/// earnings, even before either the position or its earnings are claimed.
	function ownerCollateral(address owner) external view returns (uint256 principal, uint256 commitment, uint256 withdrawable) {
		return auctionDelegate.previewCollateral(owner);
	}
	function auctionPosition(uint256 bidId) external view returns (AuctionPosition memory) {
		return auctionDelegate.previewAuctionPosition(bidId);
	}
	function installAuctionCohort(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot) external onlyForkAuthority nonReentrant {
		DelegateCall.invoke(address(auctionDelegate), abi.encodeCall(auctionDelegate.install, (adapter, lots, repPerLot, commitmentPerLot, minimumCommitmentAttoEth)));
	}
	function materializeAuctionBid(uint256 bidId) external nonReentrant returns (address vault, uint96 id) {
		_checkpoint();
		return _materializeAuctionBid(bidId);
	}
	function _materializeAuctionBid(uint256 bidId) private returns (address vault, uint96 id) {
		return
			abi.decode(DelegateCall.invoke(address(auctionDelegate), abi.encodeCall(auctionDelegate.materialize, (bidId))), (address, uint96));
	}
	function isPriceValid() public view returns (bool) {
		return acceptedPrice > 0 && block.timestamp < priceValidUntil;
	}
	function effectiveTime() public view returns (uint48) {
		uint256 timestamp = block.timestamp;
		uint256 forkTimestamp = zoltar.getForkTime(universeId);
		if (forkTimestamp != 0) timestamp = Math.min(timestamp, forkTimestamp);
		require(timestamp <= type(uint48).max, 'Capital clock exhausted');
		return uint48(timestamp);
	}
	function totals() external view returns (uint256 rep, uint256 commitment, uint256 healthy) {
		(rep, commitment) = commitmentIndex.totals();
		healthy = isPriceValid() ? commitmentIndex.eligibleCommitment(conservativePrice) : 0;
	}
	function requiredRep(uint256 commitment, uint256 health) public view returns (uint256) {
		return _requiredRep(commitment, health, conservativePrice);
	}
	/// @notice A funded growth proof keeps its collateral floor until a newer
	/// canonical report covers the enlarged portfolio. No owner scan is needed.
	function ownerConservativePrice(address owner) public view returns (uint256) {
		return
			fundingPriceEpoch[owner] == acceptedPriceEpoch
				? Math.max(conservativePrice, fundingPriceFloor[owner])
				: conservativePrice;
	}
	function _requiredRep(uint256 commitment, uint256 health, uint256 price) private view returns (uint256) {
		return commitmentIndex.requiredRep(commitment, price, securityMultiplierBps, health);
	}
	function maximumHealthyPrice(uint256 rep, uint256 commitment) public view returns (uint256) {
		return commitmentIndex.maximumHealthyPrice(rep, commitment, securityMultiplierBps);
	}
	function _requireOpen() private view {
		require(!importing && zoltar.getForkTime(universeId) == 0 && !frozen, 'Capital universe inactive');
	}
	function _requireFresh() private view {
		require(isPriceValid(), 'Capital price stale');
	}

	/// @dev Every deposit immediately backs the owner's entire live commitment.
	function depositFor(address owner, uint256 amount) external nonReentrant {
		_depositFor(owner, amount);
	}
	function depositAndSetHealthTarget(uint256 amount, uint256 targetHealthFactorBps) external nonReentrant {
		_depositFor(msg.sender, amount);
		_setHealthTarget(targetHealthFactorBps);
	}
	function _depositFor(address owner, uint256 amount) private {
		_requireOpen();
		require(owner == msg.sender && owner != forkAuthority && amount > 0, 'Invalid capital deposit');
		_checkpoint();
		_settleOwner(owner);
		Owner storage account = owners[owner];
		if (account.positionId == 0) {
			account.freeAttoRep += amount;
			totalFreeAttoRep += amount;
		} else {
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(account.positionId);
			_replace(account.positionId, position.rep + amount, position.commitment);
		}
		repToken.safeTransferFrom(msg.sender, address(this), amount);
		_serveRetirement(0);
		emit PrincipalDeposited(msg.sender, owner, amount);
	}

	function withdrawPrincipal(uint256 amount, address recipient) external nonReentrant {
		_checkpoint();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.withdrawPrincipal, (amount, recipient)));
	}

	function setHealthTarget(uint256 targetHealthFactorBps) external nonReentrant {
		_setHealthTarget(targetHealthFactorBps);
	}
	function _setHealthTarget(uint256 targetHealthFactorBps) private {
		_requireOpen();
		require(targetHealthFactorBps >= BPS, 'Health below protocol floor');
		_checkpoint();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		if (owner.positionId != 0 && targetHealthFactorBps > _target(owner)) {
			_requireFresh();
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			_requireTarget(position.rep, position.commitment, targetHealthFactorBps);
		}
		owner.targetHealthFactorBps = targetHealthFactorBps;
	}
	function _requireTarget(uint256 rep, uint256 commitment, uint256 health) private view {
		require(rep >= _requiredRep(commitment, health, ownerConservativePrice(msg.sender)), 'Chosen health target unmet');
	}

	/// @notice All deposited principal backs the owner's single commitment.
	function authorize(uint256 commitment) external nonReentrant returns (uint96 id) {
		return _authorize(commitment, 0, false);
	}
	function authorizeWithReport(uint256 reportId, uint256 commitment) external nonReentrant returns (uint96 id) {
		return _authorize(commitment, reportId, true);
	}
	function _authorize(uint256 commitment, uint256 reportId, bool useReport) private returns (uint96 id) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		return
			abi.decode(DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.authorize, (commitment, reportId, useReport, minimumCommitmentAttoEth))), (uint96));
	}

	function requestRetirement(uint96 id, uint256 remainingCommitment) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_settleOwner(msg.sender);
		_owned(id, msg.sender);
		commitmentIndex.requestRetirement(id, remainingCommitment, minimumCommitmentAttoEth);
		_serveRetirement(0);
	}

	function cancelRetirement(uint96 id) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_settleOwner(msg.sender);
		_requireFresh();
		SecurityPoolCommitmentIndex.Account memory position = _owned(id, msg.sender);
		_requireTarget(position.rep, position.commitment, _target(owners[msg.sender]));
		commitmentIndex.cancelRetirement(id);
	}

	function serveRetirement(uint96 id) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_serveRetirement(id);
	}
	function _serveRetirement(uint96 id) private {
		require(id == 0 || id != auctionCohort.positionId, 'Materialize an individual auction vault');
		if (!isPriceValid() || frozen || zoltar.getForkTime(universeId) != 0) return;
		SecurityPoolCommitmentIndex.Retirement memory result = commitmentIndex.retire(conservativePrice, demandAttoEth, id);
		retirementCashAttoRep += result.rep;
		if (result.boundaryPositionId != 0) {
			SecurityPoolCommitmentIndex.Account memory boundary = commitmentIndex.accountOf(result.boundaryPositionId);
			_replace(result.boundaryPositionId, boundary.rep, boundary.commitment);
		}
		if (result.commitment != 0) emit RetirementServed(result.rep, result.commitment);
	}

	/// @dev All question liabilities enter through this aggregate, after old-time fees.
	function setDemand(uint256 demand) external onlyDemandAccounting {
		_requireOpen();
		_checkpoint();
		if (demand > demandAttoEth) {
			_requireFresh();
			_serveRetirement(0);
			require(demand <= commitmentIndex.eligibleCommitment(conservativePrice), 'Healthy commitment insufficient');
		}
		demandAttoEth = demand;
		_serveRetirement(0);
	}

	/// @dev The book may remove matured liabilities during the pre-mutation fee
	/// checkpoint. Do not change index weights until all old-time income is paid.
	function synchronizeDemand(uint256 demand) external onlyDemandAccounting {
		require(demand <= demandAttoEth, 'Sync cannot add demand');
		demandAttoEth = demand;
	}

	/// @dev The callback checkpoints the ledger's cached old price before reading
	/// the feed's new epoch and bounds; all acceptance changes are atomic.
	function acceptPrice(uint256 price, uint48 validUntil) external onlyPortfolio {
		require(zoltar.getForkTime(universeId) == 0, 'Fork price already frozen');
		require(price > 0 && validUntil > block.timestamp, 'Invalid capital price');
		_checkpointAccounting();
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(portfolio).priceFeed(universeId));
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.acceptPrice, (feed, price, validUntil)));
	}

	function checkpoint() external nonReentrant {
		_checkpoint();
	}
	function _checkpoint() private {
		_checkpointAccounting();
	}
	function _checkpointAccounting() private {
		if (importing) return;
		if (checkpointing) return;
		checkpointing = true;
		uint48 effective = effectiveTime();
		uint48 through = uint48(Math.min(effective, priceValidUntil));
		// The canonical book pauses cash-funded fees at stale-price boundaries.
		ICapitalLedgerAccounting(portfolio).checkpointCapitalFees(universeId, through);
		uint256 forkTimestamp = zoltar.getForkTime(universeId);
		// Prepaid rewards keep their original vesting dates after a fork. Their
		// old commitments and eligibility are immutable, and parent earnings stay
		// separately claimable even after the owner has selected a child.
		uint48 nowTime = uint48(block.timestamp);
		if (forkTimestamp != 0 && forkTimestamp < priceValidUntil) through = nowTime;
		_checkpointStream(feeStreams, through);
		checkpointing = false;
	}
	function _checkpointStream(ICapitalFeeStreams streams, uint48 through) private {
		(uint256 ethAmount, uint256 repAmount) = streams.checkpoint(through);
		_creditEarnings(ethAmount, repAmount);
		(ethAmount, repAmount) = streams.takeDeferred();
		_serviceIncome(ethAmount, repAmount);
	}

	function _creditEarnings(uint256 ethAmount, uint256 repAmount) private {
		if (ethAmount == 0 && repAmount == 0) return;
		(uint256 unassignedEth, uint256 unassignedRep) = commitmentIndex.creditProportionalFees(acceptedPrice == 0 ? 0 : conservativePrice, ethAmount, repAmount);
		_serviceIncome(unassignedEth, unassignedRep);
	}
	/// @dev Income belonging to unhealthy or stale intervals can never become a
	/// new provider's jackpot. ETH funds maintenance; forfeited REP is burned.
	function _serviceIncome(uint256 ethAmount, uint256 repAmount) private {
		if (repAmount != 0) zoltar.burnRep(universeId, repAmount);
		if (zoltar.getForkTime(universeId) != 0) {
			_sendEth(Constants.BURN_ADDRESS, ethAmount);
			if (ethAmount != 0 || repAmount != 0) emit TerminalFeesBurned(ethAmount, repAmount);
		} else if (ethAmount != 0)
			ICapitalLedgerAccounting(portfolio).creditServiceFees{value: ethAmount}(universeId);
	}

	/// @dev An already time-earned amount; only the canonical checkpoint may call.
	function creditTimedFees() external payable onlyAccounting {
		_creditEarnings(msg.value, 0);
	}

	function fundVestedFees(uint256 repAmount) external payable onlyAccounting {
		require(!importing, 'Capital imports are not complete');
		_checkpoint();
		if (repAmount != 0) repToken.safeTransferFrom(msg.sender, address(this), repAmount);
		feeStreams.addStream(msg.value, repAmount);
	}

	function claimEarnings() external nonReentrant {
		_checkpoint();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.claimEarnings, ()));
	}

	/// @notice Remove only enough unused nominal K to cure this particular vault.
	function cure(uint96 id) external nonReentrant returns (uint256 removed) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		(removed, ) = _cure(id, msg.sender);
	}
	function cureWithBounds(uint96 id, CureBounds calldata bounds) external nonReentrant returns (uint256 removed) {
		_prepareBoundedCure(bounds);
		return _finishBoundedCure(id, bounds);
	}
	function cureAuctionBid(uint256 bidId, CureBounds calldata bounds) external nonReentrant returns (uint256 removed) {
		require(auctionBidPositionIds[bidId] == 0, 'Auction bid already materialized');
		_prepareBoundedCure(bounds);
		(, uint96 id) = _materializeAuctionBid(bidId);
		return _finishBoundedCure(id, bounds);
	}
	/// @dev Reject changed signed capacity before any checkpoint or auction-tree
	/// work. Retirement during this call must also leave the promised progress.
	function _prepareBoundedCure(CureBounds calldata bounds) private {
		_requireOpen();
		_requireFresh();
		require(bounds.minimumRemoved != 0, 'Cure progress minimum missing');
		require(acceptedPriceEpoch == bounds.expectedAcceptedPriceEpoch, 'Cure price epoch changed');
		(, uint256 commitment) = commitmentIndex.totals();
		require(commitment == bounds.expectedTotalCommitment, 'Cure commitment changed');
		require(demandAttoEth == bounds.expectedDemand, 'Cure demand changed');
		_checkpoint();
		_serveRetirement(0);
		(, commitment) = commitmentIndex.totals();
		require(commitment > demandAttoEth && commitment - demandAttoEth >= bounds.minimumRemoved, 'Cure capacity below minimum');
	}
	function _finishBoundedCure(uint96 id, CureBounds calldata bounds) private returns (uint256 removed) {
		uint256 reward;
		(removed, reward) = _cure(id, msg.sender);
		require(removed >= bounds.minimumRemoved, 'Cure progress below minimum');
		require(reward >= bounds.minimumReward, 'Cure reward below minimum');
	}
	function _cure(uint96 id, address keeper) private returns (uint256 removed, uint256 reward) {
		require(id != 0 && id != auctionCohort.positionId, 'Materialize an individual auction vault');
		SecurityPoolCommitmentIndex.Cure memory result = commitmentIndex.cure(id, liquidationPrice, securityMultiplierBps, minimumCommitmentAttoEth, demandAttoEth);
		removed = result.removed;
		if (removed != 0) {
			owners[result.owner].freeAttoRep += result.freedRep;
			totalFreeAttoRep += result.freedRep;
			reward = result.rewardAttoRep;
			owners[keeper].feesAttoRep += reward;
			emit CommitmentCured(id, removed, reward);
		}
	}

	/// @notice Competitive takeover: only the target funds the REP award.
	function takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep) external nonReentrant returns (uint96 receiverId) {
		TakeoverBounds memory bounds;
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, false);
	}
	/// @notice Keeper-owned acquisition with signed owner exposure and quote bounds.
	function takeOverWithBounds(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, true);
	}
	function takeOverAuctionBid(uint256 bidId, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		(, uint96 id) = _materializeAuctionBid(bidId);
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, true);
	}
	function _takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds memory bounds, bool enforceBounds) private returns (uint96 receiverId) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		_cure(id, msg.sender);
		(SecurityPoolCommitmentIndex.Account memory source, uint256 award, uint256 debit) = commitmentIndex.takeoverQuote(id, msg.sender, commitment, minimumCommitmentAttoEth, minimumAward, liquidationPrice);
		_settleOwner(msg.sender);
		Owner storage receiver = owners[msg.sender];
		if (enforceBounds) {
			require(acceptedPriceEpoch == bounds.expectedAcceptedPriceEpoch, 'Takeover price epoch changed');
			require(_target(receiver) == bounds.expectedTargetHealthFactorBps, 'Takeover owner target changed');
			require(source.batch == bounds.expectedSourceBatch, 'Takeover source cohort changed');
		}
		receiverId = receiver.positionId;
		SecurityPoolCommitmentIndex.Account memory existing;
		if (receiverId != 0) {
			existing = commitmentIndex.accountOf(receiverId);
			require(existing.batch == source.batch, 'Receiver retirement differs');
		}
		// Any previously idle receiver principal joins its one live position.
		uint256 ownRep = receiver.freeAttoRep;
		require(ownRep <= maximumOwnRep, 'Receiver consent exceeded');
		uint256 needed = _requiredRep(existing.commitment + commitment, _target(receiver), ownerConservativePrice(msg.sender));
		require(existing.rep + award + ownRep >= needed, 'Receiver collateral insufficient');
		uint256 remainingK = source.commitment - commitment;
		uint256 remainingRep = source.rep - debit;
		uint256 receivedRep = award + ownRep;
		if (enforceBounds) {
			require(existing.rep + receivedRep <= bounds.maximumOwnerPrincipal, 'Takeover owner principal exceeds limit');
			require(existing.commitment + commitment <= bounds.maximumOwnerCommitment, 'Takeover owner commitment exceeds limit');
		}
		uint256 receiverRep;
		uint256 receiverK;
		if (receiverId == 0) {
			receiverId = commitmentIndex.split(id, msg.sender, debit, commitment, maximumHealthyPrice(remainingRep, remainingK), maximumHealthyPrice(receivedRep, commitment));
			receiver.positionId = receiverId;
			receiverRep = receivedRep;
			receiverK = commitment;
		} else {
			receiverRep = existing.rep + receivedRep;
			receiverK = existing.commitment + commitment;
			commitmentIndex.transferTo(id, receiverId, debit, commitment, maximumHealthyPrice(remainingRep, remainingK), maximumHealthyPrice(receiverRep, receiverK));
		}
		// Balanced transfer preserved a closed cohort's K. This replacement only
		// adjusts collateral and therefore cannot refill that cohort.
		_replace(receiverId, receiverRep, receiverK);
		_clearHealthyLiquidation(id, remainingK, maximumHealthyPrice(remainingRep, remainingK));
		receiver.freeAttoRep -= ownRep;
		totalFreeAttoRep -= ownRep;
		owners[source.owner].freeAttoRep += debit - award;
		totalFreeAttoRep += debit - award;
		emit CommitmentTakenOver(id, receiverId, commitment, award);
	}

	function freeze() external onlyForkAuthority {
		require(zoltar.getForkTime(universeId) != 0, 'Universe has not forked');
		if (frozen) return;
		_checkpoint();
		(frozenBackingAttoRep, frozenCommitmentAttoEth) = commitmentIndex.totals();
		frozen = true;
	}

	/// @notice Fork choices preserve exact owner principal and retirement intent.
	function exportChoice(address owner) external onlyForkAuthority returns (ChoicePosition memory choice, uint256 target) {
		return
			abi.decode(DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.exportChoice, (owner))), (ChoicePosition, uint256));
	}
	function beginForkImport() external onlyForkAuthority {
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.beginForkImport, ()));
	}
	function importChoice(address owner, ChoicePosition calldata position, uint256 target) external onlyForkAuthority {
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.importChoice, (owner, position, target)));
	}
	function finishForkImport(uint256 fundedDemand) external onlyForkAuthority {
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.finishForkImport, (fundedDemand)));
	}
	function releaseForkBacking() external onlyForkAuthority {
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.releaseForkBacking, ()));
	}

	/// @notice Recovery invalidates the old interval immediately, before a keeper
	/// touches the position. Uninterrupted distress retains its original clock.
	function liquidationStarted(uint96 id) public view returns (uint48 started) {
		return commitmentIndex.liquidationStarted(id);
	}
	function _clearHealthyLiquidation(uint96 id, uint256 commitment, uint256 maxPrice) private {
		if (commitment == 0 || (isPriceValid() && maxPrice >= liquidationPrice)) commitmentIndex.clearLiquidation(id);
	}
	function _replace(uint96 id, uint256 rep, uint256 commitment) private {
		uint256 maxPrice = maximumHealthyPrice(rep, commitment);
		commitmentIndex.replace(id, rep, commitment, maxPrice);
		_clearHealthyLiquidation(id, commitment, maxPrice);
	}
	function _owned(uint96 id, address owner) private view returns (SecurityPoolCommitmentIndex.Account memory account) {
		require(id != auctionCohort.positionId, 'Materialize an individual auction vault');
		account = commitmentIndex.accountOf(id);
		require(account.owner == owner, 'Position owner differs');
	}
}
