// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCommitmentIndex } from './SecurityPoolCommitmentIndex.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface ICapitalFeeStreams {
	function addStream(uint256 ethAmount, uint256 repAmount, uint48 duration) external;
	function release(uint48 until) external returns (uint256 ethAmount, uint256 repAmount);
	function releasedThrough() external view returns (uint48);
}

interface ICapitalLedgerAccounting {
	/// @dev Deliver collateral-funded fees earned before this deadline, before any
	/// change to eligibility. The accounting contract must not advance past it.
	function checkpointCapitalFees(uint248 universeId, uint48 through) external;
}

/// @notice Exact REP custody and individually authorized underwriting.
/// @dev Principal never uses a pool exchange rate. Three live slots cover active,
/// closed-current and open-next retirement cohorts; historical slots are settled
/// before reuse. Index paths, not the number of owners or questions, bound work.
contract SecurityPoolCapitalLedger {
	using SafeERC20Ops for IERC20;
	uint256 private constant BPS = 10_000;
	uint256 private constant PRICE_PRECISION = 1e18;
	address public immutable portfolio;
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	IERC20 public immutable repToken;
	uint256 public immutable securityMultiplierBps;
	uint256 public immutable minimumCommitmentAttoEth;
	uint256 public immutable minimumExecutionReserveAttoEth;
	uint48 public immutable rewardDuration;
	SecurityPoolCommitmentIndex public commitmentIndex;
	ICapitalFeeStreams public feeStreams;
	address public forkAuthority;
	uint256 public acceptedPrice;
	uint48 public priceValidUntil;
	uint256 public demandAttoEth;
	uint256 public totalFreeAttoRep;
	uint256 public retirementCashAttoRep;
	uint256 public maintenanceAttoEth;
	uint256 public maintenanceAttoRep;
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
		uint96[3] positions;
	}
	struct ChoicePosition {
		uint256 rep;
		uint256 commitment;
		uint96 batch;
		uint256 executionReserveAttoEth;
	}
	mapping(address => Owner) private owners;
	mapping(address => bool) public exported;
	mapping(uint96 => uint48) public liquidationStarted;
	mapping(uint96 => uint256) public positionExecutionReserveAttoEth;

	event PrincipalDeposited(address indexed payer, address indexed owner, uint256 amountAttoRep);
	event PrincipalWithdrawn(address indexed owner, address indexed recipient, uint256 amountAttoRep);
	event CommitmentAuthorized(address indexed owner, uint96 indexed positionId, uint256 rep, uint256 commitment, uint256 targetHealthFactorBps);
	event RetirementServed(uint256 rep, uint256 commitment);
	event CommitmentCured(uint96 indexed positionId, uint256 removedCommitment, uint256 keeperReward);
	event CommitmentTakenOver(uint96 indexed sourceId, uint96 indexed receiverId, uint256 commitment, uint256 awardAttoRep, uint256 keeperReward);
	event CapitalPriceAccepted(uint256 price, uint48 validUntil);
	event EarningsClaimed(address indexed owner, uint256 ethAmount, uint256 repAmount);

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
		rewardDuration = vestingDuration;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
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

	function initialize(SecurityPoolCommitmentIndex index, ICapitalFeeStreams streams, address coordinator) external onlyPortfolio {
		require(address(commitmentIndex) == address(0), 'Capital already initialized');
		require(index.portfolio() == address(this), 'Wrong commitment authority');
		commitmentIndex = index;
		feeStreams = streams;
		forkAuthority = coordinator;
	}

	function ownerAccount(address owner) external view returns (Owner memory) {
		return owners[owner];
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
		healthy = isPriceValid() ? commitmentIndex.eligibleCommitment(acceptedPrice) : 0;
	}
	function requiredRep(uint256 commitment, uint256 health) public view returns (uint256) {
		require(health >= BPS && acceptedPrice > 0, 'Invalid health or price');
		uint256 base = Math.mulDiv(commitment, acceptedPrice, PRICE_PRECISION, Math.Rounding.Ceil);
		base = Math.mulDiv(base, securityMultiplierBps, BPS, Math.Rounding.Ceil);
		return Math.mulDiv(base, health, BPS, Math.Rounding.Ceil);
	}
	/// @notice Fund one execution unit for every minimum-sized commitment unit.
	/// A paid partial action removes at least one unit; the residual keeps its
	/// complete execution budget without charging another owner's principal.
	function requiredExecutionReserve(uint256 commitment) public view returns (uint256) {
		return Math.ceilDiv(commitment, minimumCommitmentAttoEth) * minimumExecutionReserveAttoEth;
	}
	function maximumHealthyPrice(uint256 rep, uint256 commitment) public view returns (uint256) {
		if (commitment == 0) return type(uint256).max;
		return Math.mulDiv(Math.mulDiv(rep, BPS, securityMultiplierBps), PRICE_PRECISION, commitment);
	}
	function maximumHealthyCommitment(uint256 rep) public view returns (uint256) {
		require(acceptedPrice > 0, 'Capital price unavailable');
		return Math.mulDiv(Math.mulDiv(rep, BPS, securityMultiplierBps), PRICE_PRECISION, acceptedPrice);
	}
	function _requireOpen() private view {
		require(!importing && zoltar.getForkTime(universeId) == 0 && !frozen, 'Capital universe inactive');
	}
	function _requireFresh() private view {
		require(isPriceValid(), 'Capital price stale');
	}

	/// @dev Free deposits and top-ups remain possible during a coverage deficit.
	function depositFor(address owner, uint256 amount) external nonReentrant {
		_requireOpen();
		require(owner != address(0) && amount > 0, 'Invalid capital deposit');
		_checkpoint();
		owners[owner].freeAttoRep += amount;
		totalFreeAttoRep += amount;
		repToken.safeTransferFrom(msg.sender, address(this), amount);
		emit PrincipalDeposited(msg.sender, owner, amount);
	}

	function withdrawFree(uint256 amount, address recipient) external nonReentrant {
		require(recipient != address(0) && amount > 0, 'Invalid capital withdrawal');
		_checkpoint();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		require(amount <= owner.freeAttoRep, 'Insufficient free principal');
		owner.freeAttoRep -= amount;
		totalFreeAttoRep -= amount;
		repToken.safeTransfer(recipient, amount);
		emit PrincipalWithdrawn(msg.sender, recipient, amount);
	}

	function fundExecutionReserve(address owner) external payable {
		require(owner != address(0) && msg.value > 0, 'Invalid execution funding');
		require(!exported[owner], 'Execution reserve follows fork choice');
		owners[owner].executionReserveAttoEth += msg.value;
	}

	function withdrawExecutionReserve(uint256 amount) external nonReentrant {
		_checkpoint();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		require(!exported[msg.sender], 'Execution reserve follows fork choice');
		require(amount <= owner.executionReserveAttoEth, 'Execution reserve insufficient');
		owner.executionReserveAttoEth -= amount;
		_sendEth(msg.sender, amount);
	}

	function setHealthTarget(uint256 targetHealthFactorBps) external nonReentrant {
		_requireOpen();
		require(targetHealthFactorBps >= BPS, 'Health target below protocol floor');
		_checkpoint();
		owners[msg.sender].targetHealthFactorBps = targetHealthFactorBps;
	}

	/// @notice Authorize one active standing commitment, leaving other cohorts fixed.
	function authorize(uint256 rep, uint256 commitment) external nonReentrant returns (uint96 id) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement();
		_settleOwner(msg.sender);
		Owner storage owner = owners[msg.sender];
		uint256 health = _target(owner);
		require(commitment >= minimumCommitmentAttoEth, 'Commitment below economic minimum');
		require(rep >= requiredRep(commitment, health), 'Collateral below chosen health target');
		id = _positionInBatch(owner, 0);
		SecurityPoolCommitmentIndex.Account memory old;
		if (id != 0) old = commitmentIndex.accountOf(id);
		require(rep <= owner.freeAttoRep + old.rep, 'Insufficient owner principal');
		// Owners cannot bypass a closed retirement cohort with direct reductions.
		require(commitment >= old.commitment, 'Retire commitment before reducing it');
		owner.freeAttoRep = owner.freeAttoRep + old.rep - rep;
		totalFreeAttoRep = totalFreeAttoRep + old.rep - rep;
		if (id == 0) {
			id = commitmentIndex.create(msg.sender, rep, commitment, maximumHealthyPrice(rep, commitment));
			_addSlot(owner, id);
		} else _replace(id, rep, commitment);
		_fundPositionReserve(owner, id, commitment);
		emit CommitmentAuthorized(msg.sender, id, rep, commitment, health);
	}

	function topUp(uint96 id, uint256 amount) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_settleOwner(msg.sender);
		SecurityPoolCommitmentIndex.Account memory account = _owned(id, msg.sender);
		require(account.commitment > 0 && amount > 0, 'Position is not live');
		Owner storage owner = owners[msg.sender];
		require(amount <= owner.freeAttoRep, 'Insufficient free principal');
		owner.freeAttoRep -= amount;
		totalFreeAttoRep -= amount;
		_replace(id, account.rep + amount, account.commitment);
		if (isPriceValid() && maximumHealthyPrice(account.rep + amount, account.commitment) >= acceptedPrice)
			delete liquidationStarted[id];
		_serveRetirement();
	}

	function requestRetirement(uint96 id) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_settleOwner(msg.sender);
		_owned(id, msg.sender);
		Owner storage owner = owners[msg.sender];
		require(_positionInBatch(owner, commitmentIndex.nextBatch()) == 0, 'Next retirement position already exists');
		commitmentIndex.requestRetirement(id);
		_serveRetirement();
	}

	function cancelRetirement(uint96 id) external nonReentrant {
		_requireOpen();
		_checkpoint();
		_settleOwner(msg.sender);
		_owned(id, msg.sender);
		require(_positionInBatch(owners[msg.sender], 0) == 0, 'Active commitment already exists');
		commitmentIndex.cancelRetirement(id);
	}

	function serveRetirement() external nonReentrant {
		_requireOpen();
		_checkpoint();
		_serveRetirement();
	}
	function _serveRetirement() private {
		if (!isPriceValid() || frozen || zoltar.getForkTime(universeId) != 0) return;
		SecurityPoolCommitmentIndex.Retirement memory result = commitmentIndex.retire(acceptedPrice, demandAttoEth);
		retirementCashAttoRep += result.rep;
		if (result.boundaryPositionId != 0) {
			SecurityPoolCommitmentIndex.Account memory boundary = commitmentIndex.accountOf(result.boundaryPositionId);
			_replace(result.boundaryPositionId, boundary.rep, boundary.commitment);
		}
		if (result.commitment != 0) emit RetirementServed(result.rep, result.commitment);
	}

	/// @dev All question liabilities enter through this aggregate, after old-time fees.
	function setDemand(uint256 demand) external onlyForkAuthority {
		_requireOpen();
		_checkpoint();
		if (demand > demandAttoEth) {
			_requireFresh();
			_serveRetirement();
			require(demand <= commitmentIndex.eligibleCommitment(acceptedPrice), 'Insufficient healthy shared commitment');
		}
		demandAttoEth = demand;
		_serveRetirement();
	}

	/// @dev The book may remove matured liabilities during the pre-mutation fee
	/// checkpoint. Do not change index weights until all old-time income is paid.
	function synchronizeDemand(uint256 demand) external onlyForkAuthority {
		require(demand <= demandAttoEth, 'Synchronization cannot add demand');
		demandAttoEth = demand;
	}

	/// @dev Called synchronously BEFORE the canonical feed commits a new price.
	function acceptPrice(uint256 price, uint48 validUntil) external onlyPortfolio {
		require(zoltar.getForkTime(universeId) == 0, 'Fork price already frozen');
		require(price > 0 && validUntil > block.timestamp, 'Invalid capital price');
		_checkpoint();
		acceptedPrice = price;
		priceValidUntil = validUntil;
		emit CapitalPriceAccepted(price, validUntil);
	}

	function checkpoint() external nonReentrant {
		_checkpoint();
	}
	function _checkpoint() private {
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
		uint48 previous = feeStreams.releasedThrough();
		if (through > previous) {
			(uint256 ethAmount, uint256 repAmount) = feeStreams.release(through);
			_creditEarnings(ethAmount, repAmount);
		}
		if (nowTime > feeStreams.releasedThrough()) {
			(uint256 ethAmount, uint256 repAmount) = feeStreams.release(nowTime);
			maintenanceAttoEth += ethAmount;
			maintenanceAttoRep += repAmount;
		}
		checkpointing = false;
	}

	function _creditEarnings(uint256 ethAmount, uint256 repAmount) private {
		if (ethAmount == 0 && repAmount == 0) return;
		if (acceptedPrice == 0 || !commitmentIndex.creditFees(acceptedPrice, ethAmount, repAmount)) {
			maintenanceAttoEth += ethAmount;
			maintenanceAttoRep += repAmount;
		}
	}

	/// @dev An already time-earned amount; only the canonical checkpoint may call.
	function creditTimedFees() external payable onlyPortfolio {
		_creditEarnings(msg.value, 0);
	}

	function fundVestedFees(uint256 repAmount) external payable onlyPortfolio {
		require(!importing, 'Capital imports are not complete');
		_checkpoint();
		if (repAmount != 0) repToken.safeTransferFrom(msg.sender, address(this), repAmount);
		feeStreams.addStream(msg.value, repAmount, rewardDuration);
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
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement();
		removed = _cure(id, msg.sender);
	}
	function _cure(uint96 id, address keeper) private returns (uint256 removed) {
		SecurityPoolCommitmentIndex.Account memory account = commitmentIndex.accountOf(id);
		require(account.owner != address(0) && account.commitment > 0, 'Position is not live');
		uint256 supported = maximumHealthyCommitment(account.rep);
		if (supported >= account.commitment) {
			delete liquidationStarted[id];
			return 0;
		}
		(, uint256 totalCommitment) = commitmentIndex.totals();
		uint256 spare = totalCommitment > demandAttoEth ? totalCommitment - demandAttoEth : 0;
		removed = Math.min(account.commitment, Math.min(Math.max(account.commitment - supported, minimumCommitmentAttoEth), spare));
		if (removed < minimumCommitmentAttoEth && removed != account.commitment) removed = 0;
		uint256 remaining = account.commitment - removed;
		if (removed != 0) {
			if (remaining == 0) {
				commitmentIndex.replace(id, 0, 0, 0);
				owners[account.owner].freeAttoRep += account.rep;
				totalFreeAttoRep += account.rep;
			} else _replace(id, account.rep, remaining);
			uint256 reward = _payProgress(id, removed, account.commitment, keeper);
			emit CommitmentCured(id, removed, reward);
		}
		if (remaining <= supported) delete liquidationStarted[id];
		else if (liquidationStarted[id] == 0) liquidationStarted[id] = uint48(block.timestamp);
	}

	/// @notice Competitive takeover: only the target funds the award and execution.
	function takeOver(uint96 id, uint256 commitment, uint256 minimumAward, uint256 maximumOwnRep) external nonReentrant returns (uint96 receiverId) {
		_requireOpen();
		_requireFresh();
		_checkpoint();
		_serveRetirement();
		_cure(id, msg.sender);
		SecurityPoolCommitmentIndex.Account memory source = commitmentIndex.accountOf(id);
		require(source.owner != msg.sender && source.commitment > maximumHealthyCommitment(source.rep), 'Position does not need takeover');
		require(commitment > 0 && commitment <= source.commitment, 'Invalid takeover commitment');
		require(commitment == source.commitment || source.commitment - commitment >= minimumCommitmentAttoEth, 'Take entire residual commitment');
		require(commitment >= minimumCommitmentAttoEth || commitment == source.commitment, 'Takeover below economic minimum');
		_settleOwner(msg.sender);
		Owner storage receiver = owners[msg.sender];
		uint256 proportional =
			commitment == source.commitment ? source.rep : Math.mulDiv(source.rep, commitment, source.commitment);
		uint256 elapsed = block.timestamp - liquidationStarted[id];
		uint256 award = Math.mulDiv(proportional, Math.min(elapsed, 1 hours), 1 hours);
		require(award >= minimumAward, 'Takeover award below minimum');
		uint256 needed = requiredRep(commitment, _target(receiver));
		receiverId = _positionInBatch(receiver, source.batch);
		SecurityPoolCommitmentIndex.Account memory existing;
		if (receiverId != 0) {
			existing = commitmentIndex.accountOf(receiverId);
			uint256 combined = requiredRep(existing.commitment + commitment, _target(receiver));
			needed = Math.max(needed, combined > existing.rep ? combined - existing.rep : 0);
		}
		uint256 ownRep = needed > award ? needed - award : 0;
		require(ownRep <= maximumOwnRep && ownRep <= receiver.freeAttoRep, 'Receiver collateral insufficient');
		uint256 remainingRep = source.rep - proportional;
		uint256 remainingK = source.commitment - commitment;
		uint256 receivedRep = award + ownRep;
		uint256 receiverRep;
		uint256 receiverK;
		if (receiverId == 0) {
			receiverId = commitmentIndex.split(id, msg.sender, proportional, commitment, maximumHealthyPrice(remainingRep, remainingK), maximumHealthyPrice(receivedRep, commitment));
			_addSlot(receiver, receiverId);
			receiverRep = receivedRep;
			receiverK = commitment;
		} else {
			receiverRep = existing.rep + receivedRep;
			receiverK = existing.commitment + commitment;
			commitmentIndex.transferTo(id, receiverId, proportional, commitment, maximumHealthyPrice(remainingRep, remainingK), maximumHealthyPrice(receiverRep, receiverK));
		}
		// Balanced transfer preserved a closed cohort's K. This replacement only
		// adjusts collateral and therefore cannot refill that cohort.
		_replace(receiverId, receiverRep, receiverK);
		_fundPositionReserve(receiver, receiverId, receiverK);
		receiver.freeAttoRep -= ownRep;
		totalFreeAttoRep -= ownRep;
		owners[source.owner].freeAttoRep += proportional - award;
		totalFreeAttoRep += proportional - award;
		uint256 reward = _payProgress(id, commitment, source.commitment, msg.sender);
		emit CommitmentTakenOver(id, receiverId, commitment, award, reward);
	}

	function _payProgress(uint96 id, uint256 progress, uint256 previousCommitment, address keeper) private returns (uint256 reward) {
		uint256 reserve = positionExecutionReserveAttoEth[id];
		reward = Math.min(reserve, requiredExecutionReserve(previousCommitment) - requiredExecutionReserve(previousCommitment - progress));
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
	function exportChoice(address owner) external onlyForkAuthority returns (ChoicePosition[3] memory positions, uint256 target, uint256 reserve) {
		require(frozen && !exported[owner], 'Fork choice unavailable');
		_settleOwner(owner);
		Owner storage account = owners[owner];
		for (uint256 i; i < 3; i++) {
			uint96 id = account.positions[i];
			if (id == 0) continue;
			SecurityPoolCommitmentIndex.Account memory position = commitmentIndex.accountOf(id);
			uint96 batch;
			if (position.batch != 0) batch = position.batch == commitmentIndex.currentBatch() ? 1 : 2;
			uint256 positionReserve = positionExecutionReserveAttoEth[id];
			positions[i] = ChoicePosition(position.rep, position.commitment, batch, positionReserve);
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
	function setAuctionReferencePrice(uint256 price) external onlyForkAuthority {
		require(importing && acceptedPrice == 0 && price != 0, 'Auction price unavailable');
		// This is an auction collateral reference, not a fresh oracle acceptance.
		acceptedPrice = price;
	}
	function importChoice(address owner, ChoicePosition[3] calldata positions, uint256 target) external payable onlyForkAuthority {
		require(importing && target >= BPS, 'Fork import unavailable');
		Owner storage account = owners[owner];
		require(account.positions[0] == 0 && account.positions[1] == 0 && account.positions[2] == 0, 'Owner already imported');
		account.targetHealthFactorBps = target;
		uint256 assignedReserve;
		for (uint256 i; i < 3; i++) {
			ChoicePosition calldata position = positions[i];
			if (position.commitment == 0) {
				require(position.rep == 0 && position.executionReserveAttoEth == 0, 'Empty choice contains collateral');
				continue;
			}
			uint96 id = commitmentIndex.importPosition(owner, position.rep, position.commitment, maximumHealthyPrice(position.rep, position.commitment), position.batch);
			_addSlot(account, id);
			positionExecutionReserveAttoEth[id] = position.executionReserveAttoEth;
			assignedReserve += position.executionReserveAttoEth;
		}
		require(msg.value >= assignedReserve, 'Fork execution reserve unfunded');
		account.executionReserveAttoEth += msg.value - assignedReserve;
	}
	/// @notice Installs a funded recap purchase in its buyer's own active position.
	/// @dev The coordinator authenticates the buyer and supplies the actual child
	/// REP before activation. No later winner claim can defer liquidation exposure.
	function importAuctionPosition(address owner, uint256 rep, uint256 commitment, uint256 target) external payable onlyForkAuthority returns (uint96 id) {
		require(importing && owner != address(0) && target >= BPS, 'Auction import unavailable');
		require(commitment != 0 && rep >= requiredRep(commitment, target), 'Auction collateral below chosen health');
		Owner storage account = owners[owner];
		account.executionReserveAttoEth += msg.value;
		id = _positionInBatch(account, 0);
		if (id == 0) {
			require(commitment >= minimumCommitmentAttoEth, 'Commitment below economic minimum');
			id = commitmentIndex.importPosition(owner, rep, commitment, maximumHealthyPrice(rep, commitment), 0);
			_addSlot(account, id);
		} else {
			SecurityPoolCommitmentIndex.Account memory old = commitmentIndex.accountOf(id);
			require(old.rep + rep >= requiredRep(old.commitment + commitment, target), 'Combined auction health below target');
			commitmentIndex.importAdd(id, rep, commitment, maximumHealthyPrice(old.rep + rep, old.commitment + commitment));
			commitment += old.commitment;
		}
		_fundPositionReserve(account, id, commitment);
		account.targetHealthFactorBps = target;
	}
	function finishForkImport(uint256 fundedDemand) external onlyForkAuthority {
		require(importing, 'Fork import is not open');
		(uint256 pledged, ) = commitmentIndex.totals();
		require(repToken.balanceOf(address(this)) >= pledged + totalFreeAttoRep + retirementCashAttoRep, 'Fork principal unfunded');
		commitmentIndex.sealImports();
		importing = false;
		demandAttoEth = fundedDemand;
	}
	/// @dev Move only frozen pledged principal into the shared native migration.
	/// Free principal, retired cash and every old fee claim remain in this ledger.
	function releaseForkBacking() external onlyForkAuthority {
		require(frozen && !migrationPrepared, 'Fork backing already released or not frozen');
		migrationPrepared = true;
		if (frozenBackingAttoRep != 0) repToken.safeTransfer(msg.sender, frozenBackingAttoRep);
	}

	function _settleOwner(address owner) private {
		Owner storage account = owners[owner];
		for (uint256 i; i < 3; i++) {
			uint96 id = account.positions[i];
			if (id == 0) continue;
			(uint256 rep, uint256 ethFees, uint256 repFees) = commitmentIndex.claim(id);
			account.freeAttoRep += rep;
			totalFreeAttoRep += rep;
			retirementCashAttoRep -= rep;
			account.feesAttoEth += ethFees;
			account.feesAttoRep += repFees;
			if (commitmentIndex.accountOf(id).commitment == 0) {
				account.positions[i] = 0;
				account.executionReserveAttoEth += positionExecutionReserveAttoEth[id];
				delete positionExecutionReserveAttoEth[id];
			}
		}
	}
	function _replace(uint96 id, uint256 rep, uint256 commitment) private {
		commitmentIndex.replace(id, rep, commitment, maximumHealthyPrice(rep, commitment));
	}
	function _owned(uint96 id, address owner) private view returns (SecurityPoolCommitmentIndex.Account memory account) {
		account = commitmentIndex.accountOf(id);
		require(account.owner == owner, 'Position belongs to another owner');
	}
	function _positionInBatch(Owner storage owner, uint96 batch) private view returns (uint96) {
		for (uint256 i; i < 3; i++) {
			uint96 id = owner.positions[i];
			if (id != 0 && commitmentIndex.accountOf(id).batch == batch) return id;
		}
		return 0;
	}
	function _addSlot(Owner storage owner, uint96 id) private {
		for (uint256 i; i < 3; i++)
			if (owner.positions[i] == 0) {
				owner.positions[i] = id;
				return;
			}
		revert('Settle existing owner positions first');
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
