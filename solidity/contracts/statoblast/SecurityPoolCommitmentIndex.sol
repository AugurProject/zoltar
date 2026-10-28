// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolCommitmentTree } from './SecurityPoolCommitmentTree.sol';

/// @notice Portfolio-owned collateral, commitment, fee and retirement accounting.
/// @dev The controller settles time and prices before mutations and owns token
/// custody. Keys are exact uint256 health thresholds followed by unique uint96
/// position IDs. Balanced paths depend on live positions, never price-key entropy.
contract SecurityPoolCommitmentIndex is SecurityPoolCommitmentTree {
	address public immutable portfolio;
	uint96 public lastPositionId;
	uint96 public currentBatch;
	uint96 public nextBatch = 1;
	uint96 private lastBatch = 1;
	bool public importsOpen;
	bool private importsInitialized;
	uint64 public healthObservationEpoch;
	uint256 private observedPrice;
	mapping(uint64 => uint48) private observationTimes;
	mapping(uint96 => uint64) private healthyMutationEpochs;
	struct Account {
		address owner;
		uint96 batch;
		uint256 rep;
		uint256 commitment;
		uint256 maxHealthyPrice;
		uint256 releasedRep;
		uint256 ethFees;
		uint256 repFees;
		uint256 remainingCommitment;
	}
	struct Cure {
		uint256 removed;
		uint256 freedRep;
		uint256 previousCommitment;
		address owner;
	}

	struct Retirement {
		uint256 rep;
		uint256 commitment;
		uint96 boundaryPositionId;
	}

	constructor(address authority) {
		require(authority != address(0), 'Invalid commitment authority');
		portfolio = authority;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	modifier operational() {
		require(!importsOpen, 'Commitment imports are open');
		_;
	}

	/// @dev Only a newly created child ledger can initialize imported cohorts.
	/// Opening the child requires sealImports; sealed cohorts cannot reopen.
	function initCohorts(uint96 currentId, uint96 nextId) external onlyPortfolio {
		require(!importsInitialized && lastPositionId == 0, 'Commitment imports already initialized');
		require(currentId != 0 && currentId < nextId, 'Invalid imported cohorts');
		currentBatch = currentId;
		nextBatch = nextId;
		lastBatch = nextId;
		importsInitialized = true;
		importsOpen = true;
	}

	function importPosition(address owner, uint256 rep, uint256 commitment, uint256 maxHealthyPrice, uint96 batch, uint256 remainingCommitment) external onlyPortfolio returns (uint96) {
		require(importsOpen, 'Commitment imports are sealed');
		require(batch == 0 || batch == currentBatch || batch == nextBatch, 'Unknown imported cohort');
		require(remainingCommitment < commitment && (batch != 0 || remainingCommitment == 0), 'Invalid imported retirement target');
		return _create(owner, batch, rep, commitment, maxHealthyPrice, remainingCommitment);
	}

	function sealImports() external onlyPortfolio {
		require(importsOpen, 'Commitment imports are sealed');
		importsOpen = false;
	}

	/// @dev New commitments always start active. The controller limits the live
	/// slots per owner and checks collateral, desired health and keeper funding.
	function create(address owner, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) external onlyPortfolio operational returns (uint96) {
		return _create(owner, 0, rep, commitment, maxHealthyPrice, 0);
	}

	/// @dev A closed retirement cohort may shrink or gain collateral, never gain K.
	function replace(uint96 id, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) public onlyPortfolio operational {
		_touch(id);
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		require(!leaf.retired && leaf.commitment != 0, 'Position is not live');
		if (position.batch == currentBatch && currentBatch != 0)
			require(commitment <= leaf.commitment, 'Closed retirement commitment cannot increase');
		_detach(position.batch, position.node);
		leaf.rep = rep;
		leaf.commitment = commitment;
		leaf.price = maxHealthyPrice;
		if (commitment == 0) require(rep == 0, 'Uncommitted REP must leave index');
		_reinsert(position);
	}

	/// @dev Fees remain attached to the old owner. The receiver gets a fresh ID
	/// in precisely the source cohort; its insertion is balanced by source removal.
	function split(uint96 id, address receiver, uint256 rep, uint256 commitment, uint256 remainingMaxPrice, uint256 receiverMaxPrice) external onlyPortfolio operational returns (uint96 receiverId) {
		_touch(id);
		Position storage source = positions[id];
		Node storage leaf = nodes[source.node];
		require(!leaf.retired && commitment != 0 && commitment <= leaf.commitment && rep <= leaf.rep, 'Invalid commitment transfer');
		require(commitment != leaf.commitment || rep == leaf.rep, 'Residual REP has no commitment');
		uint96 batch = source.batch;
		_detach(source.batch, source.node);
		leaf.rep -= rep;
		leaf.commitment -= commitment;
		leaf.price = remainingMaxPrice;
		uint256 remaining = _transferRemaining(source, leaf.commitment);
		_reinsert(source);
		receiverId = _create(receiver, batch, rep, commitment, receiverMaxPrice, remaining);
	}

	/// @dev Supports an existing receiver slot without refreshing retirement
	/// priority. Both old fee entitlements stay with their respective owners.
	function transferTo(uint96 sourceId, uint96 receiverId, uint256 rep, uint256 commitment, uint256 sourceMaxPrice, uint256 receiverMaxPrice) external onlyPortfolio operational {
		require(sourceId != receiverId, 'Same commitment position');
		_touch(sourceId);
		_touch(receiverId);
		Position storage source = positions[sourceId];
		Position storage receiver = positions[receiverId];
		Node storage from = nodes[source.node];
		Node storage to = nodes[receiver.node];
		require(source.batch == receiver.batch, 'Commitment cohorts differ');
		require(!from.retired && !to.retired && to.commitment != 0, 'Position is not live');
		require(commitment != 0 && commitment <= from.commitment && rep <= from.rep, 'Invalid commitment transfer');
		require(commitment != from.commitment || rep == from.rep, 'Residual REP has no commitment');
		_detach(source.batch, source.node);
		_detach(receiver.batch, receiver.node);
		from.rep -= rep;
		from.commitment -= commitment;
		from.price = sourceMaxPrice;
		to.rep += rep;
		to.commitment += commitment;
		to.price = receiverMaxPrice;
		receiver.remainingCommitment += _transferRemaining(source, from.commitment);
		_reinsert(source);
		_reinsert(receiver);
	}

	function requestRetirement(uint96 id, uint256 remainingCommitment, uint256 minimumCommitment) external onlyPortfolio operational {
		_touch(id);
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		require(position.batch == 0 && leaf.commitment != 0, 'Position is not active');
		require(remainingCommitment < leaf.commitment, 'Retirement must reduce commitment');
		require(remainingCommitment == 0 || (remainingCommitment >= minimumCommitment && leaf.commitment - remainingCommitment >= minimumCommitment), 'Retirement below economic minimum');
		_detach(0, position.node);
		position.batch = nextBatch;
		position.remainingCommitment = remainingCommitment;
		leaf.retainedCommitment = remainingCommitment;
		_insert(nextBatch, position.node);
	}

	function cancelRetirement(uint96 id) external onlyPortfolio operational {
		_touch(id);
		Position storage position = positions[id];
		require(position.batch != 0 && !nodes[position.node].retired && nodes[position.node].commitment != 0, 'Position is not retiring');
		_detach(position.batch, position.node);
		position.batch = 0;
		position.remainingCommitment = 0;
		nodes[position.node].retainedCommitment = 0;
		_insert(0, position.node);
	}

	/// @notice Record which existing live positions are healthy at a fresh price.
	/// @dev Epochs distinguish recovery and relapse even within the same block.
	function observeHealthy(uint256 price) external onlyPortfolio operational {
		require(block.timestamp <= type(uint48).max, 'Commitment clock exhausted');
		uint64 epoch = ++healthObservationEpoch;
		observationTimes[epoch] = uint48(block.timestamp);
		observedPrice = price;
		_observeHealthy(roots[0], price, epoch);
		if (currentBatch != 0) _observeHealthy(roots[currentBatch], price, epoch);
		_observeHealthy(roots[nextBatch], price, epoch);
	}

	function healthEpoch(uint96 id) public view returns (uint64 epoch) {
		uint256 cursor = positions[id].node;
		while (cursor != 0) {
			Node storage node = nodes[cursor];
			if (epoch < node.healthEpoch) epoch = node.healthEpoch;
			cursor = node.parent;
		}
	}

	/// @notice Distress begins at the first adverse oracle observation after the
	/// position's latest recovery. No keeper transaction starts or resets a clock.
	/// One tree path combines lazy healthy observations and detached retirement.
	function liquidationStarted(uint96 id) public view returns (uint48) {
		uint256 cursor = positions[id].node;
		Node storage leaf = nodes[cursor];
		if (cursor == 0 || leaf.commitment == 0 || leaf.price >= observedPrice) return 0;
		uint64 epoch = healthyMutationEpochs[id];
		while (cursor != 0) {
			Node storage node = nodes[cursor];
			if (node.retired) return 0;
			if (epoch < node.healthEpoch) epoch = node.healthEpoch;
			cursor = node.parent;
		}
		if (epoch == healthObservationEpoch) return 0;
		return observationTimes[epoch + 1];
	}

	/// @dev The controller calls only after an actual healthy mutation at a fresh
	/// price, or full retirement. A stale-price deposit must not reset distress.
	function clearLiquidation(uint96 id) external onlyPortfolio {
		healthyMutationEpochs[id] = healthObservationEpoch;
	}

	/// @notice Quote real-progress execution pay from the target's funded budget.
	/// Funded positions retain their configured residual floor. An underfunded
	/// protocol reserve releases only the proportional share of its own budget.
	function executionReward(uint256 reserve, uint256 previousMinimum, uint256 remainingMinimum, uint256 measuredGas) external view returns (uint256) {
		uint256 retained = Math.min(remainingMinimum, Math.mulDiv(reserve, remainingMinimum, previousMinimum));
		uint256 gasPrice = Math.min(tx.gasprice, block.basefee + 2e9);
		uint256 gasReward = Math.mulDiv(measuredGas * gasPrice, 5, 4);
		return Math.min(reserve - retained, Math.max(previousMinimum - remainingMinimum, gasReward));
	}

	/// @dev Remove unused nominal K under exactly the ordinary collateral floor.
	/// Custody and payments for actual progress remain with the controller.
	function cure(uint96 id, uint256 price, uint256 multiplier, uint256 minimumCommitment, uint256 demand) external onlyPortfolio operational returns (Cure memory result) {
		Account memory account = accountOf(id);
		require(account.owner != address(0) && account.commitment > 0, 'Position is not live');
		uint256 supported = Math.mulDiv(Math.mulDiv(account.rep, 10_000, multiplier), 1e18, price);
		result.owner = account.owner;
		result.previousCommitment = account.commitment;
		if (supported >= account.commitment) {
			healthyMutationEpochs[id] = healthObservationEpoch;
			return result;
		}
		(, uint256 totalCommitment) = totals();
		uint256 spare = totalCommitment > demand ? totalCommitment - demand : 0;
		uint256 removed = Math.min(account.commitment, Math.min(Math.max(account.commitment - supported, minimumCommitment), spare));
		if (removed < minimumCommitment && removed != account.commitment) removed = 0;
		uint256 remaining = account.commitment - removed;
		result.removed = removed;
		if (removed != 0) {
			if (remaining == 0) {
				replace(id, 0, 0, 0);
				result.freedRep = account.rep;
			} else {
				uint256 maxPrice = Math.mulDiv(Math.mulDiv(account.rep, 10_000, multiplier), 1e18, remaining);
				replace(id, account.rep, remaining, maxPrice);
			}
		}
		if (remaining <= supported) healthyMutationEpochs[id] = healthObservationEpoch;
	}

	function eligibleCommitment(uint256 acceptedPrice) public view returns (uint256) {
		return
			_eligible(roots[0], acceptedPrice) +
			(currentBatch == 0 ? 0 : _eligible(roots[currentBatch], acceptedPrice)) +
			_eligible(roots[nextBatch], acceptedPrice);
	}
	/// @notice Validate an individual takeover against the index's current
	/// principal, cohort and adverse observation before custody moves any assets.
	function takeoverQuote(uint96 id, address receiver, uint256 commitment, uint256 minimumCommitment, uint256 minimumAward, uint256 price) external view onlyPortfolio returns (Account memory source, uint256 award, uint256 debit) {
		source = accountOf(id);
		require(source.owner != receiver && source.maxHealthyPrice < price, 'Position does not need takeover');
		uint48 started = liquidationStarted(id);
		require(started != 0, 'Adverse observation missing');
		require(commitment > 0 && commitment <= source.commitment, 'Invalid takeover commitment');
		require(commitment == source.commitment || source.commitment - commitment >= minimumCommitment, 'Take entire residual commitment');
		require(commitment >= minimumCommitment || commitment == source.commitment, 'Takeover below economic minimum');
		uint256 proportional =
			commitment == source.commitment ? source.rep : Math.mulDiv(source.rep, commitment, source.commitment);
		award = Math.mulDiv(proportional, Math.min(block.timestamp - started, 1 hours), 1 hours);
		require(award >= minimumAward, 'Takeover award below minimum');
		debit = commitment == source.commitment ? proportional : award;
	}
	function requiredRep(uint256 commitment, uint256 price, uint256 multiplier, uint256 health) external pure returns (uint256) {
		require(health >= 10_000 && price > 0, 'Invalid health or price');
		uint256 base = Math.mulDiv(commitment, price, 1e18, Math.Rounding.Ceil);
		base = Math.mulDiv(base, multiplier, 10_000, Math.Rounding.Ceil);
		return Math.mulDiv(base, health, 10_000, Math.Rounding.Ceil);
	}
	function maximumHealthyPrice(uint256 rep, uint256 commitment, uint256 multiplier) external pure returns (uint256) {
		if (commitment == 0) return type(uint256).max;
		return Math.mulDiv(Math.mulDiv(rep, 10_000, multiplier), 1e18, commitment);
	}

	/// @notice Fresh demand can use active K and the residual K a retiring owner
	/// explicitly retained. Only the requested reduction is reserved for exit.
	function eligibleActiveCommitment(uint256 acceptedPrice) external view returns (uint256) {
		return
			_eligible(roots[0], acceptedPrice) +
			(currentBatch == 0 ? 0 : _eligibleRetained(roots[currentBatch], acceptedPrice)) +
			_eligibleRetained(roots[nextBatch], acceptedPrice);
	}

	function totals() public view returns (uint256 rep, uint256 commitment) {
		Node storage active = nodes[roots[0]];
		Node storage current = nodes[currentBatch == 0 ? 0 : roots[currentBatch]];
		Node storage next = nodes[roots[nextBatch]];
		return (active.rep + current.rep + next.rep, active.commitment + current.commitment + next.commitment);
	}

	function batchTotals(uint96 batch) external view returns (uint256 rep, uint256 commitment) {
		Node storage root = nodes[roots[batch]];
		return (root.rep, root.commitment);
	}

	/// @notice Assign exact, already funded budgets to currently healthy K.
	/// @return assigned False when there are no healthy commitments; the controller
	/// retains the undistributed funds and applies its explicit no-recipient policy.
	function creditFees(uint256 acceptedPrice, uint256 ethAmount, uint256 repAmount) public onlyPortfolio operational returns (bool assigned) {
		uint256 total = eligibleCommitment(acceptedPrice);
		if (total == 0) return false;
		uint96[3] memory batches = [uint96(0), currentBatch, nextBatch];
		for (uint256 i; i < 3; i++) {
			if (i == 1 && currentBatch == 0) continue;
			uint256 root = roots[batches[i]];
			uint256 eligible = _eligible(root, acceptedPrice);
			if (eligible == 0) continue;
			uint256 ethPart = Math.mulDiv(ethAmount, eligible, total);
			uint256 repPart = Math.mulDiv(repAmount, eligible, total);
			_credit(root, acceptedPrice, eligible, ethPart, repPart);
			total -= eligible;
			ethAmount -= ethPart;
			repAmount -= repPart;
		}
		return true;
	}

	/// @notice Unhealthy commitment remains in the earnings denominator. The
	/// controller handles the unassigned funds without scanning their owners.
	function creditProportionalFees(uint256 acceptedPrice, uint256 ethAmount, uint256 repAmount) external onlyPortfolio returns (uint256 unassignedEth, uint256 unassignedRep) {
		(, uint256 total) = totals();
		uint256 eligible = acceptedPrice == 0 ? 0 : eligibleCommitment(acceptedPrice);
		uint256 assignedEth = total == 0 ? 0 : Math.mulDiv(ethAmount, eligible, total);
		uint256 assignedRep = total == 0 ? 0 : Math.mulDiv(repAmount, eligible, total);
		if (eligible != 0) creditFees(acceptedPrice, assignedEth, assignedRep);
		return (ethAmount - assignedEth, repAmount - assignedRep);
	}

	/// @notice Serve existing retirement groups before authorizing new demand.
	/// @dev At most two cohorts and one partial boundary are processed. A capped
	/// request rejoins active capacity at its residual K; full exits can close in
	/// bulk. The controller rekeys the sole boundary while retaining all its REP.
	function retire(uint256 acceptedPrice, uint256 demand, uint96 id) external onlyPortfolio operational returns (Retirement memory result) {
		if (id != 0) return _retirePosition(id, acceptedPrice, demand);
		uint256 healthy = eligibleCommitment(acceptedPrice);
		if (healthy < demand) return result;
		uint256 spare = healthy - demand;
		for (uint256 group; group < 2; group++) {
			_promote();
			if (currentBatch == 0) break;
			uint256 root = roots[currentBatch];
			uint256 eligible = _eligible(root, acceptedPrice);
			uint256 amount = Math.min(spare >= eligible ? nodes[root].commitment : spare, _retirementLimit(root));
			if (amount == nodes[root].commitment) {
				result.rep += nodes[root].rep;
				result.commitment += nodes[root].commitment;
				spare -= eligible;
				_close(root);
				roots[currentBatch] = 0;
				currentBatch = 0;
			} else {
				if (amount == 0) break;
				(uint256 replacement, uint256 rep, uint96 boundary) = _retirePrefix(root, amount);
				roots[currentBatch] = replacement;
				nodes[replacement].parent = 0;
				result.rep += rep;
				result.commitment += amount;
				result.boundaryPositionId = boundary;
				Position storage position = positions[boundary];
				if (
					position.remainingCommitment != 0 && nodes[position.node].commitment == position.remainingCommitment
				) {
					_touch(boundary);
					_detach(position.batch, position.node);
					_reinsert(position);
				}
				break;
			}
		}
	}

	/// @dev A requested position may finish without processing earlier owners,
	/// provided their healthy queued reductions remain fully reserved. Targeted
	/// service is all-or-nothing: partial rekeying could otherwise jump the same
	/// earlier requests on a subsequent call without adding any collateral.
	function _retirePosition(uint96 id, uint256 acceptedPrice, uint256 demand) private returns (Retirement memory result) {
		_touch(id);
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		require(position.batch != 0 && !leaf.retired && leaf.commitment != 0, 'Position is not retiring');
		_promote();
		uint256 healthy = eligibleCommitment(acceptedPrice);
		if (healthy < demand) return result;
		uint256 spare = healthy - demand;
		uint256 ahead = _queuedAhead(position, acceptedPrice);
		uint256 reduction = leaf.commitment - position.remainingCommitment;
		if (spare < ahead || (leaf.price >= acceptedPrice && spare - ahead < reduction)) return result;
		_detach(position.batch, position.node);
		result.commitment = reduction;
		if (position.remainingCommitment == 0) {
			result.rep = leaf.rep;
			_close(position.node);
		} else {
			leaf.commitment = position.remainingCommitment;
			_reinsert(position);
			result.boundaryPositionId = id;
		}
	}

	function _queuedAhead(Position storage position, uint256 acceptedPrice) private view returns (uint256 ahead) {
		uint256 cursor = position.node;
		if (nodes[cursor].price < acceptedPrice) {
			uint256 root = roots[position.batch];
			ahead = _eligible(root, acceptedPrice) - _eligibleRetained(root, acceptedPrice);
		} else {
			while (nodes[cursor].parent != 0) {
				uint256 parent = nodes[cursor].parent;
				if (nodes[parent].left == cursor) {
					Node storage right = nodes[nodes[parent].right];
					ahead += right.commitment - right.retainedCommitment;
				}
				cursor = parent;
			}
		}
		if (position.batch != currentBatch) {
			uint256 root = roots[currentBatch];
			ahead += _eligible(root, acceptedPrice) - _eligibleRetained(root, acceptedPrice);
		}
	}

	function claim(uint96 id) external onlyPortfolio operational returns (uint256 releasedRep, uint256 ethFees, uint256 repFees) {
		_touch(id);
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		releasedRep = position.releasedRep;
		position.releasedRep = 0;
		if (leaf.retired && !position.retiredRepClaimed) {
			releasedRep += leaf.rep;
			position.retiredRepClaimed = true;
		}
		ethFees = leaf.ethFees;
		repFees = leaf.repFees;
		leaf.ethFees = 0;
		leaf.repFees = 0;
	}

	function accountOf(uint96 id) public view returns (Account memory account) {
		Position storage position = positions[id];
		if (position.node == 0) return account;
		Node storage leaf = nodes[position.node];
		account.owner = position.owner;
		account.batch = position.batch;
		account.maxHealthyPrice = leaf.price;
		account.releasedRep = position.releasedRep;
		account.remainingCommitment = position.remainingCommitment;
		(bool retired, uint256 ethFees, uint256 repFees) = _preview(position.node);
		account.ethFees = ethFees;
		account.repFees = repFees;
		if (retired) {
			if (!position.retiredRepClaimed) account.releasedRep += leaf.rep;
		} else {
			account.rep = leaf.rep;
			account.commitment = leaf.commitment;
		}
	}

	function _create(address owner, uint96 batch, uint256 rep, uint256 commitment, uint256 price, uint256 remainingCommitment) private returns (uint96 id) {
		require(owner != address(0) && commitment != 0, 'Invalid commitment position');
		require(lastPositionId != type(uint96).max, 'Commitment IDs exhausted');
		id = ++lastPositionId;
		uint256 node = ++lastNode;
		nodes[node] = Node(0, 0, 0, rep, commitment, 0, 0, price, price, id, 0, false, 0, remainingCommitment);
		positions[id] = Position(owner, batch, node, 0, false, remainingCommitment);
		healthyMutationEpochs[id] = healthObservationEpoch;
		_insert(batch, node);
	}

	/// @dev Takeovers transfer requested exits first. Only commitment beyond the
	/// source's queued reduction carries residual intent to the receiver, keeping
	/// the closed cohort's aggregate requested reduction unchanged.
	function _transferRemaining(Position storage source, uint256 commitment) private returns (uint256 transferred) {
		if (source.remainingCommitment > commitment) {
			transferred = source.remainingCommitment - commitment;
			source.remainingCommitment = commitment;
		}
	}

	/// @dev The leaf must be detached before changing its active membership.
	/// Forced reductions can also fulfill a pending voluntary residual goal.
	function _reinsert(Position storage position) private {
		Node storage leaf = nodes[position.node];
		if (position.remainingCommitment != 0 && leaf.commitment <= position.remainingCommitment) {
			position.remainingCommitment = 0;
			position.batch = 0;
		}
		leaf.retainedCommitment = position.remainingCommitment;
		if (leaf.commitment != 0) _insert(position.batch, position.node);
	}

	function _promote() private {
		if (currentBatch != 0 && roots[currentBatch] != 0) return;
		currentBatch = 0;
		if (roots[nextBatch] == 0) return;
		currentBatch = nextBatch;
		require(lastBatch != type(uint96).max, 'Retirement batch IDs exhausted');
		nextBatch = ++lastBatch;
	}
}
