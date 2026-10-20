// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @dev Leaf-oriented AVL tree. Unique uint96 position IDs bound the number of
/// live leaves below 2^96; AVL height is below 192 even at that numeric limit.
/// Health key width does not determine execution depth. Retired subtrees detach
/// before later rotations, preserving direct, bounded paths to historical claims.
abstract contract SecurityPoolCommitmentTree {
	uint256 private constant MAX_DEPTH = 192;
	uint256 internal lastNode;
	struct Node {
		uint256 parent;
		uint256 left;
		uint256 right;
		uint256 rep;
		uint256 commitment;
		uint128 ethFees;
		uint128 repFees;
		uint256 price;
		uint256 maximumPrice;
		uint96 positionId;
		uint16 height;
		bool retired;
	}
	struct Position {
		address owner;
		uint96 batch;
		uint256 node;
		uint256 releasedRep;
		bool retiredRepClaimed;
	}
	mapping(uint256 => Node) internal nodes;
	mapping(uint96 => Position) internal positions;
	mapping(uint96 => uint256) internal roots;

	function _before(Node storage a, Node storage b) private view returns (bool) {
		return a.price < b.price || (a.price == b.price && a.positionId < b.positionId);
	}

	function _refresh(uint256 nodeId) private {
		Node storage node = nodes[nodeId];
		Node storage left = nodes[node.left];
		Node storage right = nodes[node.right];
		node.rep = left.rep + right.rep;
		node.commitment = left.commitment + right.commitment;
		node.price = left.price;
		node.maximumPrice = right.maximumPrice;
		node.positionId = left.positionId;
		node.height = uint16(Math.max(left.height, right.height) + 1);
	}

	function _branch(uint256 id, uint256 left, uint256 right, uint256 parent) private {
		Node storage node = nodes[id];
		node.parent = parent;
		node.left = left;
		node.right = right;
		nodes[left].parent = id;
		nodes[right].parent = id;
		_refresh(id);
	}

	function _insert(uint96 batch, uint256 leafId) internal {
		Node storage leaf = nodes[leafId];
		uint256 cursor = roots[batch];
		leaf.maximumPrice = leaf.price;
		if (cursor == 0) {
			roots[batch] = leafId;
			leaf.parent = 0;
			return;
		}
		while (nodes[cursor].left != 0) {
			_push(cursor);
			cursor = _before(leaf, nodes[nodes[cursor].right]) ? nodes[cursor].left : nodes[cursor].right;
		}
		uint256 parent = nodes[cursor].parent;
		uint256 branch = ++lastNode;
		if (_before(leaf, nodes[cursor])) _branch(branch, leafId, cursor, parent);
		else _branch(branch, cursor, leafId, parent);
		_attach(batch, parent, cursor, branch);
		_repair(batch, parent);
	}

	function _attach(uint96 batch, uint256 parent, uint256 oldChild, uint256 newChild) private {
		nodes[newChild].parent = parent;
		if (parent == 0) roots[batch] = newChild;
		else if (nodes[parent].left == oldChild) nodes[parent].left = newChild;
		else nodes[parent].right = newChild;
	}

	/// @dev The caller pushes the leaf path before removing its membership.
	function _detach(uint96 batch, uint256 leafId) internal {
		uint256 parent = nodes[leafId].parent;
		if (parent == 0) {
			roots[batch] = 0;
			return;
		}
		uint256 sibling = nodes[parent].left == leafId ? nodes[parent].right : nodes[parent].left;
		uint256 grandparent = nodes[parent].parent;
		_attach(batch, grandparent, parent, sibling);
		nodes[leafId].parent = 0;
		_repair(batch, grandparent);
	}

	function _repair(uint96 batch, uint256 cursor) private {
		while (cursor != 0) {
			uint256 parent = nodes[cursor].parent;
			_refresh(cursor);
			uint256 replacement = _balance(cursor);
			_attach(batch, parent, cursor, replacement);
			cursor = parent;
		}
	}

	function _balance(uint256 id) private returns (uint256) {
		Node storage node = nodes[id];
		if (nodes[node.left].height > nodes[node.right].height + 1) {
			uint256 left = node.left;
			if (nodes[nodes[left].right].height > nodes[nodes[left].left].height) {
				node.left = _rotateLeft(left);
				nodes[node.left].parent = id;
			}
			return _rotateRight(id);
		}
		if (nodes[node.right].height > nodes[node.left].height + 1) {
			uint256 right = node.right;
			if (nodes[nodes[right].left].height > nodes[nodes[right].right].height) {
				node.right = _rotateRight(right);
				nodes[node.right].parent = id;
			}
			return _rotateLeft(id);
		}
		return id;
	}

	function _rotateLeft(uint256 id) private returns (uint256 replacement) {
		_push(id);
		replacement = nodes[id].right;
		_push(replacement);
		uint256 middle = nodes[replacement].left;
		nodes[replacement].parent = nodes[id].parent;
		nodes[id].right = middle;
		nodes[middle].parent = id;
		nodes[replacement].left = id;
		nodes[id].parent = replacement;
		_refresh(id);
		_refresh(replacement);
	}

	function _rotateRight(uint256 id) private returns (uint256 replacement) {
		_push(id);
		replacement = nodes[id].left;
		_push(replacement);
		uint256 middle = nodes[replacement].right;
		nodes[replacement].parent = nodes[id].parent;
		nodes[id].left = middle;
		nodes[middle].parent = id;
		nodes[replacement].right = id;
		nodes[id].parent = replacement;
		_refresh(id);
		_refresh(replacement);
	}

	/// @dev Join two ordered AVL trees after a bulk retirement. The taller spine
	/// is traversed once; ordinary single-deletion balancing would not suffice.
	function _join(uint256 left, uint256 right, uint256 branch) private returns (uint256 replacement) {
		nodes[left].parent = 0;
		nodes[right].parent = 0;
		uint256[MAX_DEPTH] memory path;
		uint256 depth;
		bool leftTall = nodes[left].height > nodes[right].height;
		uint256 cursor = leftTall ? left : right;
		uint256 shorter = leftTall ? right : left;
		while (nodes[cursor].height > nodes[shorter].height + 1) {
			_push(cursor);
			path[depth++] = cursor;
			cursor = leftTall ? nodes[cursor].right : nodes[cursor].left;
		}
		if (leftTall) _branch(branch, cursor, shorter, 0);
		else _branch(branch, shorter, cursor, 0);
		replacement = branch;
		while (depth != 0) {
			uint256 parent = path[--depth];
			if (leftTall) nodes[parent].right = replacement;
			else nodes[parent].left = replacement;
			nodes[replacement].parent = parent;
			_refresh(parent);
			replacement = _balance(parent);
		}
		nodes[replacement].parent = 0;
	}

	function _eligible(uint256 cursor, uint256 price) internal view returns (uint256 amount) {
		while (cursor != 0) {
			Node storage node = nodes[cursor];
			if (node.price >= price) return amount + node.commitment;
			if (node.maximumPrice < price) return amount;
			if (nodes[node.right].price < price) cursor = node.right;
			else {
				amount += nodes[node.right].commitment;
				cursor = node.left;
			}
		}
	}

	function _credit(uint256 cursor, uint256 price, uint256 eligible, uint256 ethAmount, uint256 repAmount) internal {
		while (cursor != 0) {
			Node storage node = nodes[cursor];
			if (node.price >= price) {
				_addFees(node, ethAmount, repAmount);
				return;
			}
			if (nodes[node.right].price < price) cursor = node.right;
			else {
				Node storage right = nodes[node.right];
				uint256 ethPart = Math.mulDiv(ethAmount, right.commitment, eligible);
				uint256 repPart = Math.mulDiv(repAmount, right.commitment, eligible);
				_addFees(right, ethPart, repPart);
				eligible -= right.commitment;
				ethAmount -= ethPart;
				repAmount -= repPart;
				if (eligible == 0) return;
				cursor = node.left;
			}
		}
	}

	function _push(uint256 id) private {
		Node storage node = nodes[id];
		if (node.left == 0) return;
		Node storage left = nodes[node.left];
		Node storage right = nodes[node.right];
		if (node.retired) {
			left.retired = true;
			right.retired = true;
		}
		if (node.ethFees != 0 || node.repFees != 0) {
			uint256 ethAmount = Math.mulDiv(node.ethFees, left.commitment, node.commitment);
			uint256 repAmount = Math.mulDiv(node.repFees, left.commitment, node.commitment);
			_addFees(left, ethAmount, repAmount);
			_addFees(right, node.ethFees - ethAmount, node.repFees - repAmount);
			node.ethFees = 0;
			node.repFees = 0;
		}
	}

	function _addFees(Node storage node, uint256 ethAmount, uint256 repAmount) private {
		uint256 ethTotal = uint256(node.ethFees) + ethAmount;
		uint256 repTotal = uint256(node.repFees) + repAmount;
		require(ethTotal <= type(uint128).max && repTotal <= type(uint128).max, 'Fee budget exceeds token domain');
		node.ethFees = uint128(ethTotal);
		node.repFees = uint128(repTotal);
	}

	function _touch(uint96 id) internal {
		uint256 cursor = positions[id].node;
		require(cursor != 0, 'Unknown commitment position');
		uint256[MAX_DEPTH] memory path;
		uint256 depth;
		while (nodes[cursor].parent != 0) {
			cursor = nodes[cursor].parent;
			path[depth++] = cursor;
		}
		while (depth != 0) _push(path[--depth]);
	}

	function _close(uint256 root) internal {
		nodes[root].retired = true;
		nodes[root].parent = 0;
	}

	function _retirePrefix(uint256 cursor, uint256 amount) internal returns (uint256 replacement, uint256 released, uint96 boundary) {
		uint256[MAX_DEPTH] memory kept;
		uint256 depth;
		while (true) {
			Node storage node = nodes[cursor];
			if (amount == node.commitment) {
				released += node.rep;
				_close(cursor);
				break;
			}
			if (node.left == 0) {
				uint256 rep = Math.mulDiv(node.rep, amount, node.commitment);
				node.rep -= rep;
				node.commitment -= amount;
				positions[node.positionId].releasedRep += rep;
				released += rep;
				replacement = cursor;
				boundary = node.positionId;
				break;
			}
			_push(cursor);
			uint256 right = node.right;
			if (amount < nodes[right].commitment) {
				kept[depth++] = cursor;
				cursor = right;
			} else {
				amount -= nodes[right].commitment;
				released += nodes[right].rep;
				_close(right);
				cursor = node.left;
				nodes[cursor].parent = 0;
				if (amount == 0) {
					replacement = cursor;
					break;
				}
			}
		}
		while (depth != 0) {
			uint256 parent = kept[--depth];
			if (replacement == 0) {
				replacement = nodes[parent].left;
				nodes[replacement].parent = 0;
			} else replacement = _join(nodes[parent].left, replacement, parent);
		}
	}

	function _preview(uint256 leafId) internal view returns (bool retired, uint256 ethFees, uint256 repFees) {
		uint256[MAX_DEPTH] memory path;
		uint256 depth;
		uint256 cursor = leafId;
		while (nodes[cursor].parent != 0) {
			path[depth++] = cursor;
			cursor = nodes[cursor].parent;
		}
		while (true) {
			Node storage node = nodes[cursor];
			retired = retired || node.retired;
			ethFees += node.ethFees;
			repFees += node.repFees;
			if (depth == 0) break;
			uint256 child = path[--depth];
			uint256 leftEth = Math.mulDiv(ethFees, nodes[node.left].commitment, node.commitment);
			uint256 leftRep = Math.mulDiv(repFees, nodes[node.left].commitment, node.commitment);
			if (child == node.left) {
				ethFees = leftEth;
				repFees = leftRep;
			} else {
				ethFees -= leftEth;
				repFees -= leftRep;
			}
			cursor = child;
		}
	}
}
