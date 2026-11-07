// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Persistent, ordered checkpoints with constant-work append and root copies.
/// @dev A skew-binary forest stores timestamps in newest-first preorder. Appending
/// joins only the first two equally sized trees, or adds one leaf; it never copies
/// an old path. Fork children can append independently to the same immutable head.
/// Strictly increasing uint48 timestamps bound the forest and a selected tree to
/// at most 48 levels each. Ceiling lookup reads those paths without scanning history.
library SecurityPoolFrozenHistory {
	struct Node {
		uint48 timestamp;
		uint48 size;
		uint64 left;
		uint64 right;
		uint64 next;
		uint256 value;
	}

	struct Store {
		uint64 lastId;
		mapping(uint64 => Node) nodes;
	}

	function append(Store storage self, uint64 head, uint48 timestamp, uint256 value) internal returns (uint64 id) {
		require(value != 0, 'Empty frozen checkpoint');
		Node storage first = self.nodes[head];
		require(head == 0 || timestamp > first.timestamp, 'Frozen checkpoints must advance');
		uint64 left;
		uint64 right;
		uint64 next = head;
		uint48 size = 1;
		if (head != 0 && first.next != 0) {
			Node storage second = self.nodes[first.next];
			if (first.size == second.size) {
				left = head;
				right = first.next;
				next = second.next;
				size += first.size + second.size;
			}
		}
		id = ++self.lastId;
		self.nodes[id] = Node(timestamp, size, left, right, next, value);
	}

	/// @notice The earliest checkpoint at or after a question's finality deadline.
	function ceiling(Store storage self, uint64 head, uint48 timestamp) internal view returns (uint256 value) {
		if (head == 0 || self.nodes[head].timestamp < timestamp) return 0;
		while (self.nodes[head].next != 0 && self.nodes[self.nodes[head].next].timestamp >= timestamp)
			head = self.nodes[head].next;
		while (true) {
			Node storage node = self.nodes[head];
			if (node.right != 0 && self.nodes[node.right].timestamp >= timestamp) head = node.right;
			else if (node.left != 0 && self.nodes[node.left].timestamp >= timestamp) head = node.left;
			else return node.value;
		}
	}
}
