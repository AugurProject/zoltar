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
	uint96 public protocolReserveId;
	uint96 public currentBatch;
	uint96 public nextBatch = 1;
	uint96 private lastBatch = 1;
	bool public importsOpen;
	bool private importsInitialized;
	uint64 public healthObservationEpoch;
	struct Account {
		address owner;
		uint96 batch;
		uint256 rep;
		uint256 commitment;
		uint256 maxHealthyPrice;
		uint256 releasedRep;
		uint256 ethFees;
		uint256 repFees;
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

	function importPosition(address owner, uint256 rep, uint256 commitment, uint256 maxHealthyPrice, uint96 batch) external onlyPortfolio returns (uint96) {
		require(importsOpen, 'Commitment imports are sealed');
		require(batch == 0 || batch == currentBatch || batch == nextBatch, 'Unknown imported cohort');
		return _create(owner, batch, rep, commitment, maxHealthyPrice);
	}

	/// @dev The one unchosen fork reserve shares active accounting, but may only
	/// retire after both owner cohorts and never supplies capacity to new demand.
	function importProtocolReserve(address owner, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) external onlyPortfolio returns (uint96 id) {
		require(importsOpen && protocolReserveId == 0, 'Protocol reserve import unavailable');
		id = _create(owner, 0, rep, commitment, maxHealthyPrice);
		protocolReserveId = id;
	}

	/// @dev Atomic recap fills may merge with a chosen active position. Imported
	/// retirement cohorts retain exactly the owner's frozen authorization.
	function importAdd(uint96 id, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) external onlyPortfolio {
		require(importsOpen, 'Commitment imports are sealed');
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		require(position.node != 0 && position.batch == 0 && leaf.commitment != 0, 'Import receiver is not active');
		require(commitment != 0, 'Imported commitment is zero');
		_detach(0, position.node);
		leaf.rep += rep;
		leaf.commitment += commitment;
		leaf.price = maxHealthyPrice;
		_insert(0, position.node);
	}

	function sealImports() external onlyPortfolio {
		require(importsOpen, 'Commitment imports are sealed');
		importsOpen = false;
	}

	/// @dev New commitments always start active. The controller limits the live
	/// slots per owner and checks collateral, desired health and keeper funding.
	function create(address owner, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) external onlyPortfolio operational returns (uint96) {
		return _create(owner, 0, rep, commitment, maxHealthyPrice);
	}

	/// @dev A closed retirement cohort may shrink or gain collateral, never gain K.
	function replace(uint96 id, uint256 rep, uint256 commitment, uint256 maxHealthyPrice) external onlyPortfolio operational {
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
		if (commitment != 0) _insert(position.batch, position.node);
		else require(rep == 0, 'Uncommitted REP must leave index');
	}

	/// @dev Fees remain attached to the old owner. The receiver gets a fresh ID
	/// in precisely the source cohort; its insertion is balanced by source removal.
	function split(uint96 id, address receiver, uint256 rep, uint256 commitment, uint256 remainingMaxPrice, uint256 receiverMaxPrice) external onlyPortfolio operational returns (uint96 receiverId) {
		_touch(id);
		Position storage source = positions[id];
		Node storage leaf = nodes[source.node];
		require(!leaf.retired && commitment != 0 && commitment <= leaf.commitment && rep <= leaf.rep, 'Invalid commitment transfer');
		require(commitment != leaf.commitment || rep == leaf.rep, 'Residual REP has no commitment');
		_detach(source.batch, source.node);
		leaf.rep -= rep;
		leaf.commitment -= commitment;
		leaf.price = remainingMaxPrice;
		if (leaf.commitment != 0) _insert(source.batch, source.node);
		receiverId = _create(receiver, source.batch, rep, commitment, receiverMaxPrice);
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
		if (from.commitment != 0) _insert(source.batch, source.node);
		_insert(receiver.batch, receiver.node);
	}

	function requestRetirement(uint96 id) external onlyPortfolio operational {
		require(id != protocolReserveId, 'Protocol reserve follows owner retirement');
		_touch(id);
		Position storage position = positions[id];
		require(position.batch == 0 && nodes[position.node].commitment != 0, 'Position is not active');
		_detach(0, position.node);
		position.batch = nextBatch;
		_insert(nextBatch, position.node);
	}

	function cancelRetirement(uint96 id) external onlyPortfolio operational {
		_touch(id);
		Position storage position = positions[id];
		require(position.batch != 0 && !nodes[position.node].retired && nodes[position.node].commitment != 0, 'Position is not retiring');
		_detach(position.batch, position.node);
		position.batch = 0;
		_insert(0, position.node);
	}

	/// @notice Record which existing live positions are healthy at a fresh price.
	/// @dev Epochs distinguish recovery and relapse even within the same block.
	function observeHealthy(uint256 price) external onlyPortfolio operational {
		uint64 epoch = ++healthObservationEpoch;
		_observeHealthy(roots[0], price, epoch);
		if (currentBatch != 0) _observeHealthy(roots[currentBatch], price, epoch);
		_observeHealthy(roots[nextBatch], price, epoch);
	}

	function healthEpoch(uint96 id) external view returns (uint64 epoch) {
		uint256 cursor = positions[id].node;
		while (cursor != 0) {
			Node storage node = nodes[cursor];
			if (epoch < node.healthEpoch) epoch = node.healthEpoch;
			cursor = node.parent;
		}
	}

	function eligibleCommitment(uint256 acceptedPrice) public view returns (uint256) {
		return
			_eligible(roots[0], acceptedPrice) +
			(currentBatch == 0 ? 0 : _eligible(roots[currentBatch], acceptedPrice)) +
			_eligible(roots[nextBatch], acceptedPrice);
	}

	/// @notice Capacity available to fresh demand after honoring queued retirement.
	function eligibleActiveCommitment(uint256 acceptedPrice) external view returns (uint256) {
		Node storage reserve = nodes[positions[protocolReserveId].node];
		uint256 reserved = reserve.price >= acceptedPrice ? reserve.commitment : 0;
		return _eligible(roots[0], acceptedPrice) - reserved;
	}

	function totals() external view returns (uint256 rep, uint256 commitment) {
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
	function creditFees(uint256 acceptedPrice, uint256 ethAmount, uint256 repAmount) external onlyPortfolio operational returns (bool assigned) {
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

	/// @notice Serve existing retirement groups before authorizing new demand.
	/// @dev Current is closed before service. Only two groups can be present at
	/// entry, followed by at most one protocol reserve. Unhealthy tails cost no
	/// healthy capacity once reached. A partial boundary keeps its conservative
	/// old price; the controller can rekey it once.
	function retire(uint256 acceptedPrice, uint256 demand) external onlyPortfolio operational returns (Retirement memory result) {
		uint256 healthy = eligibleCommitment(acceptedPrice);
		if (healthy < demand) return result;
		uint256 spare = healthy - demand;
		for (uint256 group; group < 2; group++) {
			_promote();
			if (currentBatch == 0) break;
			uint256 root = roots[currentBatch];
			uint256 eligible = _eligible(root, acceptedPrice);
			if (spare >= eligible) {
				result.rep += nodes[root].rep;
				result.commitment += nodes[root].commitment;
				spare -= eligible;
				_close(root);
				roots[currentBatch] = 0;
				currentBatch = 0;
			} else {
				if (spare == 0) break;
				(uint256 replacement, uint256 rep, uint96 boundary) = _retirePrefix(root, spare);
				roots[currentBatch] = replacement;
				nodes[replacement].parent = 0;
				result.rep += rep;
				result.commitment += spare;
				result.boundaryPositionId = boundary;
				break;
			}
		}
		if ((currentBatch == 0 || roots[currentBatch] == 0) && roots[nextBatch] == 0) {
			Retirement memory reserve = _retireProtocolReserve(acceptedPrice, spare);
			result.rep += reserve.rep;
			result.commitment += reserve.commitment;
			result.boundaryPositionId = reserve.boundaryPositionId;
		}
	}

	function _retireProtocolReserve(uint256 acceptedPrice, uint256 spare) private returns (Retirement memory result) {
		uint96 id = protocolReserveId;
		if (id == 0) return result;
		Position storage position = positions[id];
		Node storage leaf = nodes[position.node];
		if (leaf.commitment == 0) return result;
		uint256 amount = leaf.price < acceptedPrice ? leaf.commitment : Math.min(spare, leaf.commitment);
		if (amount == 0) return result;
		_touch(id);
		_detach(0, position.node);
		result.rep = Math.mulDiv(leaf.rep, amount, leaf.commitment);
		result.commitment = amount;
		position.releasedRep += result.rep;
		leaf.rep -= result.rep;
		leaf.commitment -= amount;
		if (leaf.commitment != 0) {
			_insert(0, position.node);
			result.boundaryPositionId = id;
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

	function accountOf(uint96 id) external view returns (Account memory account) {
		Position storage position = positions[id];
		if (position.node == 0) return account;
		Node storage leaf = nodes[position.node];
		account.owner = position.owner;
		account.batch = position.batch;
		account.maxHealthyPrice = leaf.price;
		account.releasedRep = position.releasedRep;
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

	function _create(address owner, uint96 batch, uint256 rep, uint256 commitment, uint256 price) private returns (uint96 id) {
		require(owner != address(0) && commitment != 0, 'Invalid commitment position');
		require(lastPositionId != type(uint96).max, 'Commitment IDs exhausted');
		id = ++lastPositionId;
		uint256 node = ++lastNode;
		nodes[node] = Node(0, 0, 0, rep, commitment, 0, 0, price, price, id, 0, false, 0);
		positions[id] = Position(owner, batch, node, 0, false);
		_insert(batch, node);
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
