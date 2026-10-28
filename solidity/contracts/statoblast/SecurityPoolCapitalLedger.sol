// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import {
	ICapitalFeeStreams,
	ICapitalPriceExposure,
	ICapitalLedgerAccounting
} from './interfaces/ICapitalAccounting.sol';
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
contract SecurityPoolCapitalLedger {
	using SafeERC20Ops for IERC20;
	uint256 private constant BPS = 10_000;
	address public immutable portfolio;
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	IERC20 public immutable repToken;
	uint256 public immutable securityMultiplierBps;
	uint256 private immutable minimumCommitmentAttoEth;
	uint256 private immutable minimumExecutionReserveAttoEth;
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
	bool private entered;
	bool private checkpointing;

	struct Owner {
		uint256 freeAttoRep;
		uint256 feesAttoEth;
		uint256 feesAttoRep;
		uint256 executionReserveAttoEth;
		uint256 targetHealthFactorBps;
		uint96 positionId;
	}
	struct ChoicePosition {
		uint256 rep;
		uint256 commitment;
		uint96 batch;
		uint256 executionReserveAttoEth;
		uint256 remainingCommitment;
	}
	mapping(address => Owner) private owners;
	mapping(address => bool) public exported;
	mapping(uint96 => uint256) public positionExecutionReserveAttoEth;

	event PrincipalDeposited(address indexed payer, address indexed owner, uint256 amountAttoRep);
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amountAttoRep);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event RetirementServed(uint256 rep, uint256 commitment);
	event CommitmentCured(uint96 indexed positionId, uint256 removedCommitment, uint256 keeperReward);
	event CommitmentTakenOver(uint96 indexed sourceId, uint96 indexed receiverId, uint256 commitment, uint256 awardAttoRep, uint256 keeperReward);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);
	event TerminalFeesBurned(uint256 ethAmount, uint256 repAmount);

	constructor(address authority, Zoltar _zoltar, uint248 _universeId, uint256 multiplier, uint256 minimumCommitment, uint256 minimumReserve, uint48 vestingDuration) {
		require(authority != address(0), 'Capital authority missing');
		require(minimumCommitment > 0 && minimumReserve > 0 && vestingDuration > 0, 'Capital economic minimum missing');
		portfolio = authority;
		zoltar = _zoltar;
		universeId = _universeId;
		repToken = IERC20(address(_zoltar.getRepToken(_universeId)));
		securityMultiplierBps = Math.max(multiplier, 10_500);
		minimumCommitmentAttoEth = minimumCommitment;
		minimumExecutionReserveAttoEth = minimumReserve;
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

	function ownerAccount(address owner) external view returns (Owner memory) {
		return owners[owner];
	}
	/// @notice Deposited principal excludes earnings, even before their claim.
	function ownerCollateral(address owner) external view returns (uint256 principal, uint256 commitment, uint256 withdrawable) {
		Owner storage account = owners[owner];
		SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(account.positionId);
		withdrawable = account.freeAttoRep + position.releasedRep;
		principal = withdrawable + position.rep;
		commitment = position.commitment;
		if (commitment == 0) return (principal, 0, principal);
		if (importing || frozen || exported[owner] || zoltar.getForkTime(universeId) != 0 || !isPriceValid())
			return (principal, commitment, withdrawable);
		uint256 required = _requiredRep(commitment, _target(account), ownerConservativePrice(owner));
		if (position.rep > required) withdrawable += position.rep - required;
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
	/// @notice Fund one execution unit for every minimum-sized commitment unit.
	/// A paid partial action removes at least one unit; the residual keeps its
	/// complete execution budget without charging another owner's principal.
	function requiredExecutionReserve(uint256 commitment) public view returns (uint256) {
		return Math.ceilDiv(commitment, minimumCommitmentAttoEth) * minimumExecutionReserveAttoEth;
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
		require(recipient != address(0) && amount > 0, 'Invalid capital withdrawal');
		_checkpoint();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 free = Math.min(amount, owner.freeAttoRep);
		owner.freeAttoRep -= free;
		totalFreeAttoRep -= free;
		uint256 pledged = amount - free;
		if (pledged != 0) {
			require(owner.positionId != 0 && msg.sender != forkAuthority, 'Insufficient owner principal');
			_requireOpen();
			_requireFresh();
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			require(pledged <= position.rep && position.rep - pledged >= _requiredRep(position.commitment, _target(owner), ownerConservativePrice(msg.sender)), 'Owner collateral too low');
			_replace(owner.positionId, position.rep - pledged, position.commitment);
		}
		repToken.safeTransfer(recipient, amount);
		emit PrincipalWithdrawn(msg.sender, recipient, amount);
	}

	/// @notice Funding a live position commits the additional ETH to its work.
	/// Before authorization, or after retirement, funding stays withdrawable.
	function fundExecutionReserve(address owner) external payable {
		require(owner != address(0) && msg.value > 0, 'Invalid execution funding');
		require(!exported[owner], 'Reserve follows fork choice');
		uint96 id = owners[owner].positionId;
		if (id != 0 && commitmentIndex.accountOf(id).commitment != 0) positionExecutionReserveAttoEth[id] += msg.value;
		else owners[owner].executionReserveAttoEth += msg.value;
	}

	function withdrawExecutionReserve(uint256 amount) external nonReentrant {
		_checkpoint();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		require(!exported[msg.sender], 'Reserve follows fork choice');
		if (zoltar.getForkTime(universeId) != 0 && block.timestamp >= zoltar.getForkChoiceDeadline(universeId)) {
			owner.executionReserveAttoEth += positionExecutionReserveAttoEth[owner.positionId];
			delete positionExecutionReserveAttoEth[owner.positionId];
		}
		require(amount <= owner.executionReserveAttoEth, 'Execution reserve insufficient');
		owner.executionReserveAttoEth -= amount;
		_sendEth(msg.sender, amount);
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
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 health = _target(owner);
		require(commitment >= minimumCommitmentAttoEth, 'Commitment below minimum');
		id = owner.positionId;
		SecurityPoolCommitmentIndex.Account memory old;
		if (id != 0) old = commitmentIndex.accountOf(id);
		require(old.batch == 0, 'Cancel retirement first');
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(portfolio).priceFeed(universeId));
		if (useReport) {
			(, uint256 totalCommitment) = commitmentIndex.totals();
			(uint256 reportPrice, uint256 epoch) = feed.reportAuthorization(reportId, Math.max(demandAttoEth, totalCommitment - old.commitment + commitment));
			require(epoch == acceptedPriceEpoch, 'Capital price epoch changed');
			fundingPriceFloor[msg.sender] = Math.max(ownerConservativePrice(msg.sender), reportPrice);
			fundingPriceEpoch[msg.sender] = epoch;
		}
		uint256 rep = owner.freeAttoRep + old.rep;
		_requireTarget(rep, commitment, health);
		// Owners cannot bypass a closed retirement cohort with direct reductions.
		require(commitment >= old.commitment, 'Retire before reducing');
		totalFreeAttoRep -= owner.freeAttoRep;
		owner.freeAttoRep = 0;
		if (id == 0) {
			id = commitmentIndex.create(msg.sender, rep, commitment, maximumHealthyPrice(rep, commitment));
			owner.positionId = id;
		} else _replace(id, rep, commitment);
		_fundPositionReserve(owner, id, commitment);
		if (!useReport) feed.validateExposure();
		emit CommitmentAuthorized(msg.sender, id, rep, commitment, health);
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
		uint256 uncertainty = feed.targetPriceErrorForDispute();
		acceptedPriceEpoch = feed.acceptedEpoch();
		require(uncertainty < 10_000_000, 'Invalid oracle uncertainty');
		acceptedPrice = price;
		conservativePrice = Math.mulDiv(price, 10_000_000, 10_000_000 - uncertainty, Math.Rounding.Ceil);
		liquidationPrice = Math.mulDiv(price, 10_000_000, 10_000_000 + uncertainty);
		require(liquidationPrice != 0, 'Liquidation price rounds to zero');
		priceValidUntil = validUntil;
		commitmentIndex.observeHealthy(liquidationPrice);
		emit CapitalPriceAccepted(price, validUntil);
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
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 ethAmount = owner.feesAttoEth;
		uint256 repAmount = owner.feesAttoRep;
		owner.feesAttoEth = 0;
		owner.feesAttoRep = 0;
		if (repAmount != 0) repToken.safeTransfer(msg.sender, repAmount);
		_sendEth(msg.sender, ethAmount);
		emit EarningsClaimed(msg.sender, ethAmount, repAmount);
	}

	/// @notice Remove only enough unused nominal K to cure this particular vault.
	function cure(uint96 id) external nonReentrant returns (uint256 removed) {
		uint256 initialGas = gasleft();
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		removed = _cure(id, msg.sender, initialGas);
	}
	function _cure(uint96 id, address keeper, uint256 initialGas) private returns (uint256 removed) {
		SecurityPoolCommitmentIndex.Cure memory result = commitmentIndex.cure(id, liquidationPrice, securityMultiplierBps, minimumCommitmentAttoEth, demandAttoEth);
		removed = result.removed;
		if (removed != 0) {
			owners[result.owner].freeAttoRep += result.freedRep;
			totalFreeAttoRep += result.freedRep;
			uint256 reward = _payProgress(id, removed, result.previousCommitment, keeper, initialGas);
			emit CommitmentCured(id, removed, reward);
		}
	}

	/// @notice Competitive takeover: only the target funds the award and execution.
	function takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep) external nonReentrant returns (uint96 receiverId) {
		uint256 initialGas = gasleft();
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement(0);
		if (_cure(id, msg.sender, initialGas) != 0) initialGas = gasleft();
		(SecurityPoolCommitmentIndex.Account memory source, uint256 award, uint256 debit) = commitmentIndex.takeoverQuote(id, msg.sender, commitment, minimumCommitmentAttoEth, minimumAward, liquidationPrice);
		_settleOwner(msg.sender);
		Owner storage receiver = owners[msg.sender];
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
		_fundPositionReserve(receiver, receiverId, receiverK);
		receiver.freeAttoRep -= ownRep;
		totalFreeAttoRep -= ownRep;
		owners[source.owner].freeAttoRep += debit - award;
		totalFreeAttoRep += debit - award;
		uint256 reward = _payProgress(id, commitment, source.commitment, msg.sender, initialGas);
		emit CommitmentTakenOver(id, receiverId, commitment, award, reward);
	}

	function _payProgress(uint96 id, uint256 progress, uint256 previousCommitment, address keeper, uint256 initialGas) private returns (uint256 reward) {
		uint256 reserve = positionExecutionReserveAttoEth[id];
		uint256 previousMinimum = requiredExecutionReserve(previousCommitment);
		uint256 remainingMinimum = requiredExecutionReserve(previousCommitment - progress);
		// Funded positions preserve the complete configured residual floor. An
		// underfunded position releases its own budget in proportion to progress.
		reward = commitmentIndex.executionReward(reserve, previousMinimum, remainingMinimum, initialGas - gasleft() + 60_000);
		positionExecutionReserveAttoEth[id] -= reward;
		// Pull credit avoids a receiver veto over an otherwise valid cure.
		owners[keeper].feesAttoEth += reward;
	}

	function _fundPositionReserve(Owner storage owner, uint96 id, uint256 commitment) private {
		uint256 required = requiredExecutionReserve(commitment);
		uint256 previous = positionExecutionReserveAttoEth[id];
		if (previous >= required) return;
		uint256 additional = required - previous;
		require(owner.executionReserveAttoEth >= additional, 'Fund execution reserve');
		owner.executionReserveAttoEth -= additional;
		positionExecutionReserveAttoEth[id] = required;
	}

	function freeze() external onlyForkAuthority {
		require(zoltar.getForkTime(universeId) != 0, 'Universe has not forked');
		if (frozen) return;
		_checkpoint();
		(frozenBackingAttoRep, frozenCommitmentAttoEth) = commitmentIndex.totals();
		frozen = true;
	}

	/// @dev Choices move exact C and K, never a shared NAV fraction. The caller
	/// records this bounded tuple in the actual native fork's choice ledger.
	function exportChoice(address owner) external onlyForkAuthority returns (ChoicePosition memory choice, uint256 target, uint256 reserve) {
		require(frozen && !exported[owner], 'Fork choice unavailable');
		_settleOwner(owner);
		Owner storage account = owners[owner];
		uint96 id = account.positionId;
		if (id != 0) {
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(id);
			uint96 batch;
			if (position.batch != 0) batch = position.batch == commitmentIndex.currentBatch() ? 1 : 2;
			uint256 positionReserve = positionExecutionReserveAttoEth[id];
			choice = ChoicePosition(position.rep, position.commitment, batch, positionReserve, position.remainingCommitment);
			reserve += positionReserve;
			delete positionExecutionReserveAttoEth[id];
		}
		exported[owner] = true;
		target = _target(account);
		reserve += account.executionReserveAttoEth;
		account.executionReserveAttoEth = 0;
		_sendEth(msg.sender, reserve);
	}

	function beginForkImport() external onlyForkAuthority {
		(uint256 rep, uint256 commitment) = commitmentIndex.totals();
		require(rep == 0 && commitment == 0 && !importing, 'Capital already used');
		importing = true;
		commitmentIndex.initCohorts(1, 2);
	}
	function importChoice(address owner, ChoicePosition calldata position, uint256 target) external payable onlyForkAuthority {
		require(importing && target >= BPS, 'Fork import unavailable');
		Owner storage account = owners[owner];
		require(account.positionId == 0 && account.freeAttoRep == 0, 'Owner already imported');
		account.targetHealthFactorBps = target;
		require(position.commitment != 0 && position.rep != 0, 'Empty fork choice');
		uint96 id = commitmentIndex.importPosition(owner, position.rep, position.commitment, maximumHealthyPrice(position.rep, position.commitment), position.batch, position.remainingCommitment);
		account.positionId = id;
		positionExecutionReserveAttoEth[id] = position.executionReserveAttoEth;
		uint256 assignedReserve = position.executionReserveAttoEth;
		require(msg.value >= assignedReserve, 'Fork execution reserve unfunded');
		account.executionReserveAttoEth += msg.value - assignedReserve;
	}
	function finishForkImport(uint256 fundedDemand) external onlyForkAuthority {
		require(importing, 'Fork import unavailable');
		(uint256 pledged, ) = commitmentIndex.totals();
		require(repToken.balanceOf(address(this)) >= pledged + totalFreeAttoRep + retirementCashAttoRep, 'Fork principal unfunded');
		commitmentIndex.sealImports();
		importing = false;
		demandAttoEth = fundedDemand;
	}
	/// @dev Move only frozen pledged principal into the shared native migration.
	/// Free principal, retired cash and every old fee claim remain in this ledger.
	function releaseForkBacking() external onlyForkAuthority {
		require(frozen && !migrationPrepared, 'Fork backing release unavailable');
		migrationPrepared = true;
		if (frozenBackingAttoRep != 0) repToken.safeTransfer(msg.sender, frozenBackingAttoRep);
	}

	function _settleOwner(address owner) private {
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
			account.executionReserveAttoEth += positionExecutionReserveAttoEth[id];
			delete positionExecutionReserveAttoEth[id];
		}
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
		account = commitmentIndex.accountOf(id);
		require(account.owner == owner, 'Position owner differs');
	}
	function _target(Owner storage owner) private view returns (uint256) {
		return owner.targetHealthFactorBps == 0 ? BPS : owner.targetHealthFactorBps;
	}
	function _sendEth(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool success, ) = recipient.call{value: amount}('');
		require(success, 'Capital ETH transfer failed');
	}
}
