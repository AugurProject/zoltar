// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolCommitmentIndex } from '../../statoblast/SecurityPoolCommitmentIndex.sol';

contract InspectableCommitmentIndex is SecurityPoolCommitmentIndex {
	struct Checked {
		uint256 rep;
		uint256 commitment;
		uint256 minimumPrice;
		uint256 maximumPrice;
		uint96 firstId;
		uint96 lastId;
		uint16 height;
		uint256 leaves;
	}
	constructor(address authority) SecurityPoolCommitmentIndex(authority) {}
	function validate(uint96 batch) external view returns (uint256 leaves, uint16 height) {
		if (roots[batch] == 0) return (0, 0);
		Checked memory result = _check(roots[batch], 0);
		return (result.leaves, result.height);
	}
	function _check(uint256 id, uint256 parent) private view returns (Checked memory result) {
		Node storage node = nodes[id];
		require(node.parent == parent && !node.retired, 'Invalid live parent');
		if (node.left == 0) {
			require(node.right == 0 && node.height == 0 && node.price == node.maximumPrice, 'Invalid leaf');
			require(positions[node.positionId].node == id && node.commitment != 0, 'Invalid leaf identity');
			return Checked(node.rep, node.commitment, node.price, node.price, node.positionId, node.positionId, 0, 1);
		}
		Checked memory left = _check(node.left, id);
		Checked memory right = _check(node.right, id);
		require(left.height <= right.height + 1 && right.height <= left.height + 1, 'Unbalanced commitment tree');
		require(left.maximumPrice < right.minimumPrice || (left.maximumPrice == right.minimumPrice && left.lastId < right.firstId), 'Unordered commitment tree');
		uint16 height = (left.height > right.height ? left.height : right.height) + 1;
		require(node.rep == left.rep + right.rep && node.commitment == left.commitment + right.commitment, 'Wrong commitment aggregates');
		require(node.height == height && node.price == left.minimumPrice && node.maximumPrice == right.maximumPrice && node.positionId == left.firstId, 'Wrong commitment bounds');
		return
			Checked(node.rep, node.commitment, node.price, node.maximumPrice, left.firstId, right.lastId, height, left.leaves + right.leaves);
	}
}

contract CommitmentIndexHarness {
	InspectableCommitmentIndex public immutable index;
	uint256 public releasedRep;
	uint256 public retiredCommitment;
	uint96 public boundaryPositionId;
	mapping(uint96 => uint256) public paidRep;
	mapping(uint96 => uint256) public paidEthFees;
	mapping(uint96 => uint256) public paidRepFees;

	constructor() {
		index = new InspectableCommitmentIndex(address(this));
	}
	function validateAll() external view {
		index.validate(0);
		uint96 current = index.currentBatch();
		if (current != 0) index.validate(current);
		index.validate(index.nextBatch());
	}
	function initCohorts(uint96 currentId, uint96 nextId) external {
		index.initCohorts(currentId, nextId);
	}
	function importPosition(address owner, uint256 rep, uint256 commitment, uint256 price, uint96 batch) external {
		index.importPosition(owner, rep, commitment, price, batch);
	}
	function importProtocolReserve(address owner, uint256 rep, uint256 commitment, uint256 price) external {
		index.importProtocolReserve(owner, rep, commitment, price);
	}
	function importAdd(uint96 id, uint256 rep, uint256 commitment, uint256 price) external {
		index.importAdd(id, rep, commitment, price);
	}
	function sealImports() external {
		index.sealImports();
	}
	function create(address owner, uint256 rep, uint256 commitment, uint256 price) external returns (uint96) {
		return index.create(owner, rep, commitment, price);
	}
	function replace(uint96 id, uint256 rep, uint256 commitment, uint256 price) external {
		index.replace(id, rep, commitment, price);
	}
	function split(uint96 id, address owner, uint256 rep, uint256 commitment, uint256 oldPrice, uint256 newPrice) external returns (uint96) {
		return index.split(id, owner, rep, commitment, oldPrice, newPrice);
	}
	function transferTo(uint96 source, uint96 receiver, uint256 rep, uint256 commitment, uint256 oldPrice, uint256 newPrice) external {
		index.transferTo(source, receiver, rep, commitment, oldPrice, newPrice);
	}
	function request(uint96 id) external {
		index.requestRetirement(id);
	}
	function cancel(uint96 id) external {
		index.cancelRetirement(id);
	}
	function observeHealthy(uint256 price) external {
		index.observeHealthy(price);
	}
	function observeHealthyTwice(uint256 first, uint256 second) external {
		index.observeHealthy(first);
		index.observeHealthy(second);
	}
	function recover(uint96 id, uint256 rep, uint256 commitment, uint256 price) external {
		index.replace(id, rep, commitment, price);
		index.clearLiquidation(id);
	}
	function cure(uint96 id, uint256 price, uint256 multiplier, uint256 minimumCommitment, uint256 demand) external {
		index.cure(id, price, multiplier, minimumCommitment, demand);
	}
	function credit(uint256 price, uint256 ethAmount, uint256 repAmount) external {
		require(index.creditFees(price, ethAmount, repAmount), 'No eligible recipients');
	}
	function retire(uint256 price, uint256 demand) external {
		SecurityPoolCommitmentIndex.Retirement memory result = index.retire(price, demand);
		releasedRep += result.rep;
		retiredCommitment += result.commitment;
		boundaryPositionId = result.boundaryPositionId;
	}
	function claim(uint96 id) external {
		(uint256 rep, uint256 ethFees, uint256 repFees) = index.claim(id);
		paidRep[id] += rep;
		paidEthFees[id] += ethFees;
		paidRepFees[id] += repFees;
	}
	function creditAndClaim(uint256 price, uint256 ethAmount, uint256 repAmount, uint96[3] calldata ids) external {
		require(index.creditFees(price, ethAmount, repAmount), 'No eligible recipients');
		for (uint256 i; i < 3; i++) {
			(uint256 rep, uint256 ethFees, uint256 repFees) = index.claim(ids[i]);
			paidRep[ids[i]] += rep;
			paidEthFees[ids[i]] += ethFees;
			paidRepFees[ids[i]] += repFees;
		}
	}
	function createIdentical(uint256 count, uint256 rep, uint256 commitment, uint256 price, bool retiring) external {
		for (uint256 i; i < count; i++) {
			uint96 id = index.create(address(uint160(i + 1)), rep, commitment, price);
			if (retiring) index.requestRetirement(id);
		}
	}
	function createSparse(uint256 start, uint256 count, bool retiring) external {
		for (uint256 i; i < count; i++) {
			uint96 id = index.create(address(uint160(start + i + 1)), 10, 1, uint256(1) << (start + i));
			if (retiring) index.requestRetirement(id);
		}
	}
}
