// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ICapitalFeeStreams,
	ICapitalPriceExposure,
	ICapitalLedgerAccounting
} from './interfaces/ICapitalAccounting.sol';
import { CheckedCast } from '../CheckedCast.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { SecurityPoolCapitalState } from './SecurityPoolCapitalState.sol';
import { SecurityPoolCapitalLifecycleDelegate } from './SecurityPoolCapitalLifecycleDelegate.sol';
import {
	SecurityPoolCapitalRepairAuctionDelegate,
	ICapitalRepairAuctionHost
} from './SecurityPoolCapitalRepairAuctionDelegate.sol';
import { SecurityPoolBoundClones } from './SecurityPoolBoundClones.sol';
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
	address public immutable securityPool;
	Zoltar public immutable zoltar;
	SecurityPoolCapitalLifecycleDelegate public immutable lifecycleDelegate;
	SecurityPoolCapitalRepairAuctionDelegate public immutable repairAuctionDelegate;
	uint256 public immutable securityMultiplierBps;
	uint256 private immutable minimumCommitmentAttoEth;

	bool private constant ENFORCE_TAKEOVER_BOUNDS = true;
	bool private constant OMIT_TAKEOVER_BOUNDS = false;
	bool private constant USE_FUNDED_REPORT = true;
	bool private constant USE_ACCEPTED_PRICE = false;

	event PrincipalDeposited(address indexed payer, address indexed owner, uint256 amountAttoRep);
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amountAttoRep);
	event HealthTargetSet(address indexed owner, uint256 targetHealthFactorBps);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event RetirementServed(uint256 rep, uint256 commitment);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);
	event UnassignedFeesBurned(uint256 ethAmount, uint256 repAmount);

	constructor(address authority, Zoltar protocol, uint256 multiplier, uint256 minimumCommitment, SecurityPoolCapitalLifecycleDelegate lifecycle, SecurityPoolCapitalRepairAuctionDelegate repairAuction) {
		require(authority != address(0), 'Capital authority missing');
		require(minimumCommitment > 0, 'Capital economic minimum missing');
		securityPool = authority;
		zoltar = protocol;
		securityMultiplierBps = multiplier;
		minimumCommitmentAttoEth = minimumCommitment;
		lifecycleDelegate = lifecycle;
		repairAuctionDelegate = repairAuction;
	}

	function universeId() public view returns (uint248 universe) {
		(universe, ) = SecurityPoolBoundClones.universeBindings();
	}
	function repToken() public view returns (IERC20) {
		(, address token) = SecurityPoolBoundClones.universeBindings();
		return IERC20(token);
	}
	function _requireInitialized() private view {
		require(address(commitmentIndex) != address(0), 'Capital not initialized');
	}

	modifier onlyAccounting() {
		_requireInitialized();
		require(msg.sender == securityPool || msg.sender == services, 'Only capital accounting');
		_;
	}
	modifier onlyDemandAccounting() {
		_requireInitialized();
		require(msg.sender == securityPool || msg.sender == services || msg.sender == forkAuthority, 'Only demand accounting');
		_;
	}
	modifier onlyForkAuthority() {
		_requireInitialized();
		require(msg.sender == securityPool || msg.sender == forkAuthority, 'Only fork authority');
		_;
	}
	modifier nonReentrant() {
		_requireInitialized();
		require(!entered, 'Capital operation active');
		entered = true;
		_;
		entered = false;
	}

	function initialize(SecurityPoolCommitmentIndex index, ICapitalFeeStreams streams, address coordinator, address serviceAuthority) external {
		require(msg.sender == securityPool, 'Only security pool');
		(uint248 universe, address token) = SecurityPoolBoundClones.universeBindings();
		require(address(commitmentIndex) == address(0), 'Capital already initialized');
		require(index.capitalLedger() == address(this), 'Wrong commitment authority');
		commitmentIndex = index;
		feeStreams = streams;
		services = serviceAuthority;
		forkAuthority = coordinator;
		if (universe == 0) IERC20(token).safeApprove(address(zoltar), type(uint256).max);
	}

	function storedOwnerAccount(address owner) external view returns (Owner memory) {
		return owners[owner].account;
	}
	function ownerAccount(address owner) external view returns (Owner memory) {
		return repairAuctionDelegate.previewOwner(ICapitalRepairAuctionHost(address(this)), owner);
	}
	/// @notice Deposited principal includes virtual winning bids and excludes
	/// earnings, even before either the position or its earnings are claimed.
	function ownerCollateral(address owner) external view returns (uint256 principal, uint256 commitment, uint256 withdrawable) {
		return repairAuctionDelegate.previewCollateral(ICapitalRepairAuctionHost(address(this)), owner);
	}
	function repairAuctionPosition(uint256 bidId) external view returns (RepairAuctionPosition memory) {
		return repairAuctionDelegate.previewRepairAuctionPosition(ICapitalRepairAuctionHost(address(this)), bidId);
	}
	function installRepairAuctionCohort(address adapter, uint256 lots, uint256 repPerLot, uint256 commitmentPerLot) external onlyForkAuthority nonReentrant {
		DelegateCall.invoke(address(repairAuctionDelegate), abi.encodeCall(repairAuctionDelegate.install, (adapter, lots, repPerLot, commitmentPerLot, minimumCommitmentAttoEth)));
	}
	function materializeRepairAuctionBid(uint256 bidId) external nonReentrant returns (address vault, uint96 id) {
		_checkpoint();
		return _materializeRepairAuctionBid(bidId);
	}
	function _materializeRepairAuctionBid(uint256 bidId) private returns (address vault, uint96 id) {
		return
			abi.decode(DelegateCall.invoke(address(repairAuctionDelegate), abi.encodeCall(repairAuctionDelegate.materialize, (bidId))), (address, uint96));
	}
	function isPriceValid() public view returns (bool) {
		return acceptedPrice > 0 && block.timestamp < priceValidUntil;
	}
	function effectiveTime() public view returns (uint48) {
		uint256 timestamp = block.timestamp;
		uint256 forkTimestamp = zoltar.getForkTime(universeId());
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
	/// canonical report covers the enlarged security pool. No owner scan is needed.
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
		require(!importing && zoltar.getForkTime(universeId()) == 0 && !frozen, 'Capital universe inactive');
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
			// Deposits cannot undo the adverse-price condition that permits takeover.
			require(position.maxHealthyPrice >= liquidationPrice, 'Position is liquidating');
			_replace(account.positionId, position.rep + amount, position.commitment);
		}
		repToken().safeTransferFrom(_capitalOwner(), address(this), amount);
		emit PrincipalDeposited(_capitalOwner(), owner, amount);
	}

	function withdrawPrincipal(uint256 amount, address recipient) external nonReentrant {
		_checkpoint();
		_serveRetirement(owners[_capitalOwner()].account.positionId);
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.withdrawPrincipal, (amount, recipient)));
	}

	function setHealthTarget(uint256 targetHealthFactorBps) external nonReentrant {
		_setHealthTarget(targetHealthFactorBps);
	}
	function _setHealthTarget(uint256 targetHealthFactorBps) private {
		_requireOpen();
		require(targetHealthFactorBps >= BPS, 'Health below protocol floor');
		_checkpoint();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.setHealthTarget, (targetHealthFactorBps)));
		emit HealthTargetSet(_capitalOwner(), targetHealthFactorBps);
	}

	/// @notice Set the owner's single commitment, which all deposited principal backs.
	/// @dev Raising or keeping it applies at once and must meet the owner's health
	/// target at a fresh price. Lowering can cure an uncovered deficit immediately
	/// when it meets the economic minimum and capacity permits; a smaller deficit
	/// queues the whole reduction for partial and full exits alike. A pending
	/// request accepts only its saved value, which may cure the position in place.
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
		if (isPriceValid()) current -= _cure(id, commitment, commitment == 0);
		if (current > commitment && !pending)
			commitmentIndex.requestRetirement(id, commitment, minimumCommitmentAttoEth);
		_serveRetirement(id);
	}

	/// @notice Execute any owner's ready retirement request. Serving only carries out
	/// the owner's own request and its REP stays with that owner, so anyone may call
	/// it; an owner cannot keep an ineligible request reserving spare it does not supply.
	/// A position without a pending request is left unchanged.
	function serveRetirement(uint96 id) external nonReentrant {
		_requireOpen();
		_checkpoint();
		require(id == 0 || id != repairAuctionCohort.positionId, 'Materialize an individual repair auction vault');
		_serveRetirement(id);
	}
	function _serveRetirement(uint96 id) private {
		if (id == 0) return;
		SecurityPoolCommitmentIndex.Account memory pending = commitmentIndex.accountOf(id);
		if (pending.batch == 0 || pending.commitment == 0) return;
		require(id == 0 || id != repairAuctionCohort.positionId, 'Materialize an individual repair auction vault');
		if (!isPriceValid() || frozen || zoltar.getForkTime(universeId()) != 0) return;
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
			require(demand <= commitmentIndex.eligibleActiveCommitment(conservativePrice), 'Healthy commitment insufficient');
		}
		demandAttoEth = demand;
	}

	/// @dev The book may remove matured liabilities during the pre-mutation fee
	/// checkpoint. Do not change index weights until all old-time income is paid.
	function synchronizeDemand(uint256 demand) external onlyDemandAccounting {
		require(demand <= demandAttoEth, 'Sync cannot add demand');
		demandAttoEth = demand;
	}

	/// @notice Account for collateral donated to restore existing claims.
	/// The canonical settlement checkpoints old fees before receiving cash,
	/// then supplies its actual active cash balance. No new shares are minted.
	function recordSettlementRepair(uint256 demand) external {
		_requireInitialized();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.recordSettlementRepair, (demand)));
	}

	/// @dev The callback checkpoints the ledger's cached old price before reading
	/// the feed's new epoch and bounds; all acceptance changes are atomic.
	function acceptPrice(uint256 price, uint48 validUntil) external {
		require(msg.sender == securityPool, 'Only security pool');
		_requireInitialized();
		require(reportOwner == address(0), 'Report operation active');
		require(zoltar.getForkTime(universeId()) == 0, 'Fork price already frozen');
		require(price > 0 && validUntil > block.timestamp, 'Invalid capital price');
		_checkpointAccounting();
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(securityPool).priceFeed(universeId()));
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
		ICapitalLedgerAccounting(securityPool).checkpointCapitalFees(universeId(), through);
		// Prepaid rewards keep their original vesting dates after a fork. Their
		// old commitments and eligibility are immutable, and parent earnings stay
		// separately claimable even after the owner has selected a child.
		if (effective < block.timestamp && effective < priceValidUntil) through = CheckedCast.toUint48(block.timestamp);
		// Prepaid income belongs to the commitments at the last accepted price.
		// Every weight mutation checkpoints first, including during a price lapse.
		_checkpointStream(feeStreams, acceptedPrice == 0 ? through : CheckedCast.toUint48(block.timestamp));
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
		if (repAmount != 0) zoltar.burnRep(universeId(), repAmount);
		pendingBurnCash += ethAmount;
		if (repAmount != 0) emit UnassignedFeesBurned(0, repAmount);
	}

	/// @notice Flush quarantined collateral independently of REP operations.
	function flushBurn() external nonReentrant {
		uint256 amount = pendingBurnCash;
		pendingBurnCash = 0;
		_sendCollateral(Constants.BURN_ADDRESS, amount);
		if (amount != 0) emit UnassignedFeesBurned(amount, 0);
	}

	/// @dev Services retain custody until an earnings or burn payout needs cash.
	function creditDeferredTimedFees(uint256 cash) external {
		require(msg.sender == services, 'Only capital services');
		pendingServiceCash += cash;
		_creditEarnings(cash, 0);
	}

	function fundVestedFees(uint256 cash, uint256 repAmount) external onlyAccounting {
		require(!importing, 'Capital imports are not complete');
		_checkpoint();
		if (repAmount != 0) repToken().safeTransferFrom(msg.sender, address(this), repAmount);
		Collateral.pull(ICollateralConfig(securityPool).collateralToken(), msg.sender, address(this), cash);
		feeStreams.addStream(cash, repAmount);
	}

	function claimEarnings(address recipient) external nonReentrant {
		_checkpoint();
		DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.claimEarnings, (recipient)));
	}

	/// @dev Cut unbacked commitment down to `target`. Only the owner's own
	/// `setCommitment` and a takeover, which needs an adverse observation, cure.
	function _cure(uint96 id, uint256 target, bool ownerExit) private returns (uint256) {
		return
			abi.decode(DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.cure, (id, target, ownerExit, minimumCommitmentAttoEth, securityMultiplierBps))), (uint256));
	}

	/// @notice Auction repair; the takeover reward from the source stays pledged in the receiver vault.
	function takeOver(uint96 id, uint256 commitment, uint256 minimumTakeoverReward, uint256 maximumOwnRep) external nonReentrant returns (uint96 receiverId) {
		TakeoverBounds memory bounds;
		return _takeOver(id, commitment, minimumTakeoverReward, maximumOwnRep, bounds, OMIT_TAKEOVER_BOUNDS);
	}
	/// @notice Keeper-owned acquisition with signed owner exposure and quote bounds.
	function takeOverWithBounds(uint96 id, uint256 commitment, uint256 minimumTakeoverReward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		return _takeOver(id, commitment, minimumTakeoverReward, maximumOwnRep, bounds, ENFORCE_TAKEOVER_BOUNDS);
	}
	function takeOverRepairAuctionBid(uint256 bidId, uint256 commitment, uint256 minimumTakeoverReward, uint256 maximumOwnRep, TakeoverBounds calldata bounds) external nonReentrant returns (uint96 receiverId) {
		_requireOpen();
		_checkpoint();
		(, uint96 id) = _materializeRepairAuctionBid(bidId);
		return _takeOver(id, commitment, minimumTakeoverReward, maximumOwnRep, bounds, ENFORCE_TAKEOVER_BOUNDS);
	}
	/// @notice Execute one existing owner operation as its funding sponsor.
	/// The canonical feed filters selectors and isolates calls. The selected
	/// public entrypoint retains its validation and reentrancy guard.
	function executeReportOperation(address sponsor, bytes calldata data) external {
		require(msg.sender == ICapitalLedgerAccounting(securityPool).priceFeed(universeId()), 'Only canonical shared feed');
		require(!entered && reportOwner == address(0) && sponsor != address(0), 'Capital operation active');
		reportOwner = sponsor;
		(bool success, bytes memory result) = address(this).call(data);
		if (!success) DelegateCall.bubbleRevert(result);
		reportOwner = address(0);
	}

	function _takeOver(uint96 id, uint256 commitment, uint256 minimumTakeoverReward, uint256 maximumOwnRep, TakeoverBounds memory bounds, bool enforceBounds) private returns (uint96) {
		_requireOpen();
		// The index requires an existing adverse observation. Its auction remains
		// executable at the last accepted valuation after that report expires.
		_checkpoint();
		return
			abi.decode(DelegateCall.invoke(address(lifecycleDelegate), abi.encodeCall(lifecycleDelegate.takeOver, (id, commitment, minimumTakeoverReward, maximumOwnRep, bounds, enforceBounds, minimumCommitmentAttoEth))), (uint96));
	}

	function freeze() external onlyForkAuthority {
		require(zoltar.getForkTime(universeId()) != 0, 'Universe has not forked');
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
	function liquidationElapsed(uint96 id) external view returns (uint256) {
		return commitmentIndex.liquidationElapsed(id);
	}
	function liquidationPenaltyPaid(uint96 id) external view returns (uint256) {
		return commitmentIndex.liquidationPenaltyPaid(id);
	}
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
