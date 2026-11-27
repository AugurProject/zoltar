// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { OraclePriceMath } from './OraclePriceMath.sol';
import { OPEN_ORACLE_PERCENTAGE_PRECISION } from './OraclePriceTypes.sol';

import { SecurityPoolCapitalState } from './SecurityPoolCapitalState.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { ICapitalPriceExposure, ICapitalLedgerAccounting } from './interfaces/ICapitalAccounting.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';

interface ICapitalSettlementRepairRoot {
	function settlement() external view returns (address);
}

interface ICapitalLifecycleHost {
	function securityPool() external view returns (address);
	function universeId() external view returns (uint248);
	function securityMultiplierBps() external view returns (uint256);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function ownerConservativePrice(address owner) external view returns (uint256);
	function repToken() external view returns (IERC20);
	function zoltar() external view returns (Zoltar);
	function maximumHealthyPrice(uint256 rep, uint256 commitment) external view returns (uint256);
	function isPriceValid() external view returns (bool);
}

/// @notice Owner registration and bounded fork choices in the custody ledger's context.
/// @dev Direct mutations are rejected. Ledger
/// wrappers guard owner authorization and authenticate fork accounting callers.
contract SecurityPoolCapitalLifecycleDelegate is SecurityPoolCapitalState {
	using SafeERC20Ops for IERC20;
	address public immutable implementation = address(this);
	modifier onlyDelegateCall() {
		require(address(this) != implementation, 'Only capital delegatecall');
		_;
	}

	/// @dev The ledger validates the floor and checkpoints old-price income first.
	function setHealthTarget(uint256 targetHealthFactorBps) external onlyDelegateCall {
		_settleOwner(_capitalOwner());
		Owner storage owner = owners[_capitalOwner()].account;
		if (owner.positionId != 0 && targetHealthFactorBps > _target(owner)) {
			ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
			require(host.isPriceValid(), 'Capital price stale');
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			require(position.rep >= _requiredRep(host, position.commitment, targetHealthFactorBps), 'Chosen health target unmet');
		}
		owner.targetHealthFactorBps = targetHealthFactorBps;
	}

	/// @notice Record a canonical settlement's donation without changing index weights.
	function recordSettlementRepair(uint256 demand) external onlyDelegateCall {
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		require(msg.sender == ICapitalSettlementRepairRoot(host.securityPool()).settlement(), 'Only canonical settlement');
		_requireOpen(host);
		require(demand >= demandAttoEth, 'Repair cannot remove demand');
		(, uint256 commitment) = commitmentIndex.totals();
		require(demand <= commitment, 'Repair exceeds underwriting commitment');
		demandAttoEth = demand;
	}

	/// @dev The ledger authenticates the security pool, validates the input, and
	/// checkpoints all old-price income before forwarding its canonical feed.
	function acceptPrice(ICapitalPriceExposure feed, uint256 price, uint48 validUntil) external onlyDelegateCall {
		uint256 uncertainty = feed.targetPriceErrorForDispute();
		require(uncertainty < OPEN_ORACLE_PERCENTAGE_PRECISION, 'Invalid oracle uncertainty');
		acceptedPriceEpoch = feed.acceptedEpoch();
		acceptedPrice = price;
		conservativePrice = OraclePriceMath.conservativePrice(price, uncertainty);
		liquidationPrice = OraclePriceMath.liquidationPrice(price, uncertainty);
		require(liquidationPrice != 0, 'Liquidation price rounds to zero');
		if (!importing && block.timestamp >= priceValidUntil) commitmentIndex.restartLiquidationClock();
		priceValidUntil = validUntil;
		// Child reports can fund the fork auction before capital activation.
		// Imported positions have no operating health history until imports seal.
		if (!importing) commitmentIndex.observeHealthy(liquidationPrice);
		emit CapitalPriceAccepted(price, validUntil);
	}

	/// @dev The ledger has already checkpointed fees, settled the owner, served
	/// prior retirements, and required an open universe with a fresh accepted
	/// price. It calls only for a commitment at least the current one, which a
	/// position queued for retirement can never request, because its saved
	/// remaining commitment is always below its live commitment.
	function authorize(uint256 commitment, uint256 reportId, bool useReport) external onlyDelegateCall returns (uint96 id) {
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		Owner storage owner = owners[_capitalOwner()].account;
		uint256 health = _target(owner);
		require(commitment >= host.minimumCommitmentAttoEth(), 'Commitment below minimum');
		id = owner.positionId;
		SecurityPoolCommitmentIndex.Account memory old;
		if (id != 0) old = commitmentIndex.accountOf(id);
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(host.securityPool()).priceFeed(host.universeId()));
		if (useReport) {
			(, uint256 totalCommitment) = commitmentIndex.totals();
			(uint256 reportPrice, uint256 epoch) = feed.reportAuthorization(reportId, Math.max(demandAttoEth, totalCommitment - old.commitment + commitment));
			require(epoch == acceptedPriceEpoch, 'Capital price epoch changed');
			owners[_capitalOwner()].fundingPrice = FundingPrice(Math.max(host.ownerConservativePrice(_capitalOwner()), reportPrice), epoch);
		}
		uint256 rep = owner.freeAttoRep + old.rep;
		require(rep >= _requiredRep(host, commitment, health), 'Chosen health target unmet');
		totalFreeAttoRep -= owner.freeAttoRep;
		owner.freeAttoRep = 0;
		if (id == 0) {
			id = commitmentIndex.create(_capitalOwner(), rep, commitment, host.maximumHealthyPrice(rep, commitment));
			owner.positionId = id;
		} else {
			uint256 maxPrice = host.maximumHealthyPrice(rep, commitment);
			commitmentIndex.replace(id, rep, commitment, maxPrice);
			if (maxPrice >= liquidationPrice) commitmentIndex.clearLiquidation(id);
		}
		// Keeping the commitment adds no exposure.
		if (!useReport && commitment > old.commitment) feed.validateExposure();
		emit CommitmentAuthorized(_capitalOwner(), id, rep, commitment, health);
	}

	/// @dev These owner operations run after the ledger checkpoints old income.
	function withdrawPrincipal(uint256 amount, address recipient) external onlyDelegateCall {
		require(recipient != address(0) && recipient != address(this) && amount > 0, 'Invalid capital withdrawal');
		_settleOwner(_capitalOwner());
		Owner storage owner = owners[_capitalOwner()].account;
		uint256 free = Math.min(amount, owner.freeAttoRep);
		owner.freeAttoRep -= free;
		totalFreeAttoRep -= free;
		uint256 pledged = amount - free;
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		if (pledged != 0) {
			require(owner.positionId != 0 && _capitalOwner() != forkAuthority, 'Insufficient owner principal');
			_requireOpen(host);
			require(host.isPriceValid(), 'Capital price stale');
			require(commitmentIndex.eligibleCommitment(conservativePrice) >= demandAttoEth, 'Security pool backing insufficient');
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(owner.positionId);
			require(pledged <= position.rep && position.rep - pledged >= _requiredRep(host, position.commitment, _target(owner)), 'Owner collateral too low');
			uint256 maxPrice = host.maximumHealthyPrice(position.rep - pledged, position.commitment);
			commitmentIndex.replace(owner.positionId, position.rep - pledged, position.commitment, maxPrice);
			if (position.commitment == 0 || maxPrice >= liquidationPrice)
				commitmentIndex.clearLiquidation(owner.positionId);
		}
		host.repToken().safeTransfer(recipient, amount);
		emit PrincipalWithdrawn(_capitalOwner(), recipient, amount);
	}
	/// @dev Pays to a recipient the owner chooses, so a token that refuses the owner
	/// cannot strand either the REP or the collateral earnings.
	function claimEarnings(address recipient) external onlyDelegateCall {
		require(recipient != address(0) && recipient != address(this), 'Invalid earnings recipient');
		_settleOwner(_capitalOwner());
		Owner storage owner = owners[_capitalOwner()].account;
		uint256 ethAmount = owner.feesAttoEth;
		uint256 repAmount = owner.feesAttoRep;
		owner.feesAttoEth = 0;
		owner.feesAttoRep = 0;
		if (repAmount != 0) ICapitalLifecycleHost(address(this)).repToken().safeTransfer(recipient, repAmount);
		_sendCollateral(recipient, ethAmount);
		emit EarningsClaimed(_capitalOwner(), ethAmount, repAmount);
	}

	function cure(uint96 id, uint256 target, bool ownerExit) external onlyDelegateCall returns (uint256 removed) {
		require(id != 0 && id != repairAuctionCohort.positionId, 'Materialize an individual repair auction bidder');
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		SecurityPoolCommitmentIndex.Cure memory result = commitmentIndex.cure(id, liquidationPrice, host.securityMultiplierBps(), host.minimumCommitmentAttoEth(), demandAttoEth, target, ownerExit);
		removed = result.removed;
		if (removed != 0) {
			owners[result.owner].account.freeAttoRep += result.freedRep;
			totalFreeAttoRep += result.freedRep;
			emit CommitmentCured(id, removed);
		}
	}

	function takeOver(uint96 id, uint256 commitment, uint256 minimumTakeoverReward, uint256 maximumOwnRep, TakeoverBounds calldata bounds, bool enforceBounds) external onlyDelegateCall returns (uint96 receiverId) {
		ICapitalLifecycleHost host = ICapitalLifecycleHost(address(this));
		address receiverOwner = _capitalOwner();
		uint256 securityMultiplierBps = host.securityMultiplierBps();
		uint256 minimumCommitmentAttoEth = host.minimumCommitmentAttoEth();
		(
			SecurityPoolCommitmentIndex.Cure memory cured,
			SecurityPoolCommitmentIndex.Account memory source,
			uint256 repaired,
			uint256 takeoverReward,
			uint256 debit
		) = commitmentIndex.takeover(id, repairAuctionCohort.positionId, receiverOwner, commitment, minimumCommitmentAttoEth, demandAttoEth, liquidationPrice, conservativePrice, securityMultiplierBps);
		require(takeoverReward >= minimumTakeoverReward, 'Takeover reward below minimum');
		if (cured.removed != 0) {
			owners[cured.owner].account.freeAttoRep += cured.freedRep;
			totalFreeAttoRep += cured.freedRep;
			emit CommitmentCured(id, cured.removed);
		}
		if (cured.settled) return 0;
		commitment = repaired;
		ICapitalPriceExposure feed = ICapitalPriceExposure(ICapitalLedgerAccounting(host.securityPool()).priceFeed(host.universeId()));
		require(source.rep <= feed.acceptedRepExposureLimitAttoRep(), 'Accepted report REP exposure exceeded');
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
			require(existing.batch == source.batch || existing.batch == 0, 'Receiver retirement differs');
		}
		// Any previously idle receiver principal joins its one live position.
		uint256 receiverFreePrincipalAttoRep = receiver.freeAttoRep;
		require(receiverFreePrincipalAttoRep <= maximumOwnRep, 'Receiver consent exceeded');
		uint256 requiredReceiverPrincipalAttoRep = _requiredRep(host, existing.commitment + commitment, _target(receiver));
		require(existing.rep + receiverFreePrincipalAttoRep + takeoverReward >= requiredReceiverPrincipalAttoRep, 'Receiver collateral insufficient');
		require(existing.commitment + commitment >= minimumCommitmentAttoEth, 'Receiver commitment below minimum');
		TakeoverPlan memory plan = TakeoverPlan({remainingCommitmentAttoEth: source.commitment - commitment, remainingPrincipalAttoRep: source.rep - debit, receivedPrincipalAttoRep: receiverFreePrincipalAttoRep + takeoverReward});
		if (enforceBounds) {
			require(existing.rep + plan.receivedPrincipalAttoRep <= bounds.maximumOwnerPrincipal, 'Takeover owner principal exceeds limit');
			require(existing.commitment + commitment <= bounds.maximumOwnerCommitment, 'Takeover owner commitment exceeds limit');
		}
		receiverId = _transferTakeoverPosition(id, commitment, debit, receiver, existing, plan, receiverOwner, minimumCommitmentAttoEth);
		if (
			plan.remainingCommitmentAttoEth == 0 ||
			ICapitalLifecycleHost(address(this)).maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth) >=
				liquidationPrice
		) commitmentIndex.clearLiquidation(id);
		receiver.freeAttoRep -= receiverFreePrincipalAttoRep;
		totalFreeAttoRep -= receiverFreePrincipalAttoRep;
		owners[source.owner].account.freeAttoRep += debit - takeoverReward;
		totalFreeAttoRep += debit - takeoverReward;
		emit CommitmentTakenOver(id, receiverId, commitment, takeoverReward);
	}

	function _transferTakeoverPosition(uint96 id, uint256 commitment, uint256 debit, Owner storage receiver, SecurityPoolCommitmentIndex.Account memory existing, TakeoverPlan memory plan, address receiverOwner, uint256 minimumCommitmentAttoEth) private returns (uint96 receiverId) {
		receiverId = receiver.positionId;
		uint256 receiverPrincipalAttoRep;
		uint256 receiverCommitmentAttoEth;
		if (receiverId == 0) {
			receiverId = commitmentIndex.split(id, receiverOwner, debit, commitment, ICapitalLifecycleHost(address(this)).maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth), ICapitalLifecycleHost(address(this)).maximumHealthyPrice(plan.receivedPrincipalAttoRep, commitment), minimumCommitmentAttoEth);
			receiver.positionId = receiverId;
			receiverPrincipalAttoRep = plan.receivedPrincipalAttoRep;
			receiverCommitmentAttoEth = commitment;
		} else {
			receiverPrincipalAttoRep = existing.rep + plan.receivedPrincipalAttoRep;
			receiverCommitmentAttoEth = existing.commitment + commitment;
			commitmentIndex.transferTo(id, receiverId, debit, commitment, ICapitalLifecycleHost(address(this)).maximumHealthyPrice(plan.remainingPrincipalAttoRep, plan.remainingCommitmentAttoEth), ICapitalLifecycleHost(address(this)).maximumHealthyPrice(receiverPrincipalAttoRep, receiverCommitmentAttoEth), minimumCommitmentAttoEth);
		}
		// Balanced transfer preserved a closed cohort's commitment. This replacement only
		// adjusts collateral and therefore cannot refill that cohort.
		uint256 maxPrice = ICapitalLifecycleHost(address(this)).maximumHealthyPrice(receiverPrincipalAttoRep, receiverCommitmentAttoEth);
		commitmentIndex.replace(receiverId, receiverPrincipalAttoRep, receiverCommitmentAttoEth, maxPrice);
		if (maxPrice >= liquidationPrice) commitmentIndex.clearLiquidation(receiverId);
	}

	function exportChoice(address owner) external onlyDelegateCall returns (ChoicePosition memory choice, uint256 target) {
		require(frozen && !owners[owner].exported, 'Fork choice unavailable');
		require(owners[owner].unclaimedRepairAuctionBids == 0, 'Claim repair auction bids before choosing');
		_settleOwner(owner);
		Owner storage account = owners[owner].account;
		uint96 id = account.positionId;
		if (id != 0) {
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(id);
			uint96 batch;
			if (position.batch != 0) batch = position.batch == commitmentIndex.currentBatch() ? 1 : 2;
			choice = ChoicePosition({rep: position.rep, commitment: position.commitment, batch: batch, remainingCommitment: position.remainingCommitment, retirementOrder: commitmentIndex.retirementOrder(id)});
		}
		owners[owner].exported = true;
		target = _target(account);
	}
	function beginForkImport() external onlyDelegateCall {
		(uint256 rep, uint256 commitment) = commitmentIndex.totals();
		require(rep == 0 && commitment == 0 && !importing, 'Capital already used');
		importing = true;
		commitmentIndex.initCohorts(1, 2);
	}
	function importChoice(address owner, ChoicePosition calldata position, uint256 target) external onlyDelegateCall {
		require(importing && target >= BPS, 'Fork import unavailable');
		Owner storage account = owners[owner].account;
		require(account.positionId == 0 && account.freeAttoRep == 0, 'Owner already imported');
		account.targetHealthFactorBps = target;
		require(position.commitment != 0 && position.rep != 0, 'Empty fork choice');
		uint96 id = commitmentIndex.importPosition(owner, position.rep, position.commitment, ICapitalLifecycleHost(address(this)).maximumHealthyPrice(position.rep, position.commitment), position.batch, position.remainingCommitment, position.retirementOrder);
		account.positionId = id;
	}
	function finishForkImport(uint256 fundedDemand) external onlyDelegateCall {
		require(importing, 'Fork import unavailable');
		(uint256 pledged, ) = commitmentIndex.totals();
		require(ICapitalLifecycleHost(address(this)).repToken().balanceOf(address(this)) >= pledged + totalFreeAttoRep + retirementCashAttoRep, 'Fork principal unfunded');
		commitmentIndex.sealImports();
		importing = false;
		demandAttoEth = fundedDemand;
		if (ICapitalLifecycleHost(address(this)).isPriceValid()) commitmentIndex.observeHealthy(liquidationPrice);
	}
	function releaseForkBacking() external onlyDelegateCall {
		require(frozen && !migrationPrepared, 'Fork backing release unavailable');
		migrationPrepared = true;
		if (frozenBackingAttoRep != 0)
			ICapitalLifecycleHost(address(this)).repToken().safeTransfer(_capitalOwner(), frozenBackingAttoRep);
	}
	function _requireOpen(ICapitalLifecycleHost host) private view {
		require(!importing && host.zoltar().getForkTime(host.universeId()) == 0 && !frozen, 'Capital universe inactive');
	}
	function _requiredRep(ICapitalLifecycleHost host, uint256 commitment, uint256 health) private view returns (uint256) {
		return
			commitmentIndex.requiredRep(commitment, host.ownerConservativePrice(_capitalOwner()), host.securityMultiplierBps(), health);
	}
}
