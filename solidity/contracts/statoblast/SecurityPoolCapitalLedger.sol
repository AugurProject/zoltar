// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ICapitalFeeStreams,
	ICapitalPriceExposure,
	ICapitalLedgerAccounting
} from './interfaces/ICapitalAccounting.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
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

	bool private constant ENFORCE_TAKEOVER_BOUNDS = true;
	bool private constant OMIT_TAKEOVER_BOUNDS = false;
	bool private constant USE_FUNDED_REPORT = true;
	bool private constant USE_ACCEPTED_PRICE = false;
	struct TakeoverPlan {
		uint256 remainingCommitmentAttoEth;
		uint256 remainingPrincipalAttoRep;
		uint256 receivedPrincipalAttoRep;
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
	event CommitmentCured(uint96 indexed positionId, uint256 removedCommitment);
	event CommitmentTakenOver(uint96 indexed sourceId, uint96 indexed receiverId, uint256 commitment, uint256 awardAttoRep);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);
	event UnassignedFeesBurned(uint256 ethAmount, uint256 repAmount);

	constructor(address authority, Zoltar _zoltar, uint248 _universeId, uint256 multiplier, uint256 minimumCommitment, uint48 vestingDuration) {
		require(authority != address(0), 'Capital authority missing');
		require(minimumCommitment > 0 && vestingDuration > 0, 'Capital economic minimum missing');
		portfolio = authority;
		lifecycleDelegate = new SecurityPoolCapitalLifecycleDelegate(address(this));
		auctionDelegate = new SecurityPoolCapitalAuctionDelegate(address(this));
		zoltar = _zoltar;
		universeId = _universeId;
		repToken = IERC20(address(_zoltar.getRepToken(_universeId)));
		securityMultiplierBps = multiplier;
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
		require(index.capitalLedger() == address(this), 'Wrong commitment authority');
		commitmentIndex = index;
		feeStreams = streams;
		services = serviceAuthority;
		forkAuthority = coordinator;
	}

	function storedOwnerAccount(address owner) external view returns (Owner memory) {
		return owners[owner].account;
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
			owners[owner].fundingPrice.epoch == acceptedPriceEpoch
				? Math.max(conservativePrice, owners[owner].fundingPrice.floor)
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
		_depositFor(_capitalOwner(), amount);
		_setHealthTarget(targetHealthFactorBps);
	}
	function _depositFor(address owner, uint256 amount) private {
		_requireOpen();
		require(owner == _capitalOwner() && owner != forkAuthority && amount > 0, 'Invalid capital deposit');
		_checkpoint();
		_settleOwner(owner);
		Owner storage account = owners[owner].account;
		if (account.positionId == 0) {
			account.freeAttoRep += amount;
			totalFreeAttoRep += amount;
		} else {
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(account.positionId);
			_replace(account.positionId, position.rep + amount, position.commitment);
		}
		repToken.safeTransferFrom(_capitalOwner(), address(this), amount);
		_serveRetirement(0);
		emit PrincipalDeposited(_capitalOwner(), owner, amount);
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
		_settleOwner(_capitalOwner());
		Owner storage owner = owners[_capitalOwner()].account;
		if (owner.positionId != 0 && targetHealthFactorBps > _target(owner)) {
			_requireFresh();
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			_requireTarget(position.rep, position.commitment, targetHealthFactorBps);
		}
		owner.targetHealthFactorBps = targetHealthFactorBps;
	}
	function _requireTarget(uint256 rep, uint256 commitment, uint256 health) private view {
		require(rep >= _requiredRep(commitment, health, ownerConservativePrice(_capitalOwner())), 'Chosen health target unmet');
	}

	/// @notice Set the owner's single commitment, which all deposited principal backs.
	/// @dev Raising or keeping it applies at once and must meet the owner's health
	/// target at a fresh price. Lowering it first cures an underwater position at
	/// once, which uses no healthy spare; the rest of the reduction joins the
	/// retirement queue. A pending request is locked until it is served: only
	/// its own value is accepted, which cures an underwater position in place.
	function setCommitment(uint256 commitment) external nonReentrant returns (uint96 id) {
		return _setCommitment(commitment, 0, USE_ACCEPTED_PRICE);
	}
	/// @notice Raise the commitment under a funded growth report's price floor.
	function setCommitmentWithReport(uint256 reportId, uint256 commitment) external nonReentrant returns (uint96 id) {
		return _setCommitment(commitment, reportId, USE_FUNDED_REPORT);
	}
	function _setCommitment(uint256 commitment, uint256 reportId, bool useReport) private returns (uint96 id) {
		_requireOpen();
		_checkpoint();
		_serveRetirement(0);
		_settleOwner(_capitalOwner());
		id = owners[_capitalOwner()].account.positionId;
		SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(id);
		bool pending = position.batch != 0;
		require(!pending || commitment == position.remainingCommitment, 'Retirement pending');
		if (commitment >= position.commitment) {
			_requireFresh();
			return
				abi.decode(DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.authorize, (commitment, reportId, useReport, minimumCommitmentAttoEth))), (uint96));
		}
		require(!useReport, 'Reports price growth only');
		require(commitment == 0 || commitment >= minimumCommitmentAttoEth, 'Commitment below minimum');
		uint256 current = position.commitment;
		if (isPriceValid()) current -= _cure(id, commitment);
		if (current > commitment && !pending)
			commitmentIndex.requestRetirement(id, commitment, minimumCommitmentAttoEth);
		_serveRetirement(0);
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
		require(reportOwner == address(0), 'Report operation active');
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
	/// new provider's jackpot, and no shared pot exists to receive it. Burn it.
	function _serviceIncome(uint256 ethAmount, uint256 repAmount) private {
		if (ethAmount == 0 && repAmount == 0) return;
		if (repAmount != 0) zoltar.burnRep(universeId, repAmount);
		_sendEth(Constants.BURN_ADDRESS, ethAmount);
		emit UnassignedFeesBurned(ethAmount, repAmount);
	}

	/// @dev An already time-earned amount; only the canonical checkpoint may call.
	function creditTimedFees(uint256 cash) external onlyAccounting {
		Collateral.pull(ICollateralConfig(portfolio).collateralToken(), msg.sender, address(this), cash);
		_creditEarnings(cash, 0);
	}

	function fundVestedFees(uint256 cash, uint256 repAmount) external onlyAccounting {
		require(!importing, 'Capital imports are not complete');
		_checkpoint();
		if (repAmount != 0) repToken.safeTransferFrom(msg.sender, address(this), repAmount);
		Collateral.pull(ICollateralConfig(portfolio).collateralToken(), msg.sender, address(this), cash);
		feeStreams.addStream(cash, repAmount);
	}

	function claimEarnings() external nonReentrant {
		_checkpoint();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.claimEarnings, ()));
	}

	/// @dev Cut unbacked commitment down to `target`. Only the owner's own
	/// `setCommitment` and a takeover, which needs an adverse observation, cure.
	function _cure(uint96 id, uint256 target) private returns (uint256 removed) {
		require(id != 0 && id != auctionCohort.positionId, 'Materialize an individual auction vault');
		SecurityPoolCommitmentIndex.Cure memory result = commitmentIndex.cure(id, liquidationPrice, securityMultiplierBps, minimumCommitmentAttoEth, demandAttoEth, target);
		removed = result.removed;
		if (removed != 0) {
			owners[result.owner].account.freeAttoRep += result.freedRep;
			totalFreeAttoRep += result.freedRep;
			emit CommitmentCured(id, removed);
		}
	}

	/// @notice Competitive takeover: only the target funds the REP award.
	function takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep) external nonReentrant returns (uint96 receiverId) {
		TakeoverBounds memory bounds;
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, OMIT_TAKEOVER_BOUNDS, _capitalOwner());
	}
	/// @notice Keeper-owned acquisition with signed owner exposure and quote bounds.
	function takeOverWithBounds(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, ENFORCE_TAKEOVER_BOUNDS, _capitalOwner());
	}
	function takeOverAuctionBid(uint256 bidId, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		(, uint96 id) = _materializeAuctionBid(bidId);
		return _takeOver(id, commitment, minimumAward, maximumOwnRep, bounds, ENFORCE_TAKEOVER_BOUNDS, _capitalOwner());
	}
	/// @notice Execute one existing owner operation as its funding sponsor.
	/// The canonical feed filters selectors and isolates calls. The selected
	/// public entrypoint retains its validation and reentrancy guard.
	function executeReportOperation(address sponsor, bytes calldata data) external {
		require(msg.sender == ICapitalLedgerAccounting(portfolio).priceFeed(universeId), 'Only canonical shared feed');
		require(!entered && reportOwner == address(0) && sponsor != address(0), 'Capital operation active');
		reportOwner = sponsor;
		(bool success, bytes memory result) = address(this).call(data);
		if (!success) DelegateCall.bubbleRevert(result);
		reportOwner = address(0);
	}

	function _takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep, TakeoverBounds memory bounds, bool enforceBounds, address receiverOwner) private returns (uint96 receiverId) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		_cure(id, 0);
		(
			SecurityPoolCommitmentIndex.Account memory source,
			uint256 receiverAwardAttoRep,
			uint256 sourcePrincipalDebitAttoRep
		) = commitmentIndex.takeoverQuote(id, receiverOwner, commitment, minimumCommitmentAttoEth, minimumAward, liquidationPrice);
		_settleOwner(receiverOwner);
		Owner storage receiver = owners[receiverOwner].account;
		if (enforceBounds) {
			require(acceptedPriceEpoch == bounds.expectedAcceptedPriceEpoch || (bounds.expectedAcceptedPriceEpoch == 0 && msg.sender == address(this) && reportOwner != address(0)), 'Takeover price epoch changed');
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
		uint256 receiverFreePrincipalAttoRep = receiver.freeAttoRep;
		require(receiverFreePrincipalAttoRep <= maximumOwnRep, 'Receiver consent exceeded');
		uint256 requiredReceiverPrincipalAttoRep = _requiredRep(existing.commitment + commitment, _target(receiver), ownerConservativePrice(receiverOwner));
		require(existing.rep + receiverAwardAttoRep + receiverFreePrincipalAttoRep >= requiredReceiverPrincipalAttoRep, 'Receiver collateral insufficient');
		TakeoverPlan memory plan = _planTakeover(source, commitment, sourcePrincipalDebitAttoRep, receiverAwardAttoRep, receiverFreePrincipalAttoRep);
		if (enforceBounds) {
			require(existing.rep + plan.receivedPrincipalAttoRep <= bounds.maximumOwnerPrincipal, 'Takeover owner principal exceeds limit');
			require(existing.commitment + commitment <= bounds.maximumOwnerCommitment, 'Takeover owner commitment exceeds limit');
		}
		receiverId = _transferTakeoverPosition(id, commitment, sourcePrincipalDebitAttoRep, receiver, existing, plan, receiverOwner);
		_clearHealthyLiquidation(id, plan.remainingCommitmentAttoEth, maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth));
		receiver.freeAttoRep -= receiverFreePrincipalAttoRep;
		totalFreeAttoRep -= receiverFreePrincipalAttoRep;
		owners[source.owner].account.freeAttoRep += sourcePrincipalDebitAttoRep - receiverAwardAttoRep;
		totalFreeAttoRep += sourcePrincipalDebitAttoRep - receiverAwardAttoRep;
		emit CommitmentTakenOver(id, receiverId, commitment, receiverAwardAttoRep);
	}

	function _planTakeover(SecurityPoolCommitmentIndex.Account memory source, uint256 commitmentAttoEth, uint256 sourcePrincipalDebitAttoRep, uint256 receiverAwardAttoRep, uint256 receiverFreePrincipalAttoRep) private pure returns (TakeoverPlan memory plan) {
		plan.remainingCommitmentAttoEth = source.commitment - commitmentAttoEth;
		plan.remainingPrincipalAttoRep = source.rep - sourcePrincipalDebitAttoRep;
		plan.receivedPrincipalAttoRep = receiverAwardAttoRep + receiverFreePrincipalAttoRep;
	}
	function _transferTakeoverPosition(uint96 id, uint256 commitment, uint256 sourcePrincipalDebitAttoRep, Owner storage receiver, SecurityPoolCommitmentIndex.Account memory existing, TakeoverPlan memory plan, address receiverOwner) private returns (uint96 receiverId) {
		receiverId = receiver.positionId;
		uint256 receiverPrincipalAttoRep;
		uint256 receiverCommitmentAttoEth;
		if (receiverId == 0) {
			receiverId = commitmentIndex.split(id, receiverOwner, sourcePrincipalDebitAttoRep, commitment, maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth), maximumHealthyPrice(plan.receivedPrincipalAttoRep, commitment));
			receiver.positionId = receiverId;
			receiverPrincipalAttoRep = plan.receivedPrincipalAttoRep;
			receiverCommitmentAttoEth = commitment;
		} else {
			receiverPrincipalAttoRep = existing.rep + plan.receivedPrincipalAttoRep;
			receiverCommitmentAttoEth = existing.commitment + commitment;
			commitmentIndex.transferTo(id, receiverId, sourcePrincipalDebitAttoRep, commitment, maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth), maximumHealthyPrice(receiverPrincipalAttoRep, receiverCommitmentAttoEth));
		}
		// Balanced transfer preserved a closed cohort's commitment. This replacement only
		// adjusts collateral and therefore cannot refill that cohort.
		_replace(receiverId, receiverPrincipalAttoRep, receiverCommitmentAttoEth);
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
}
