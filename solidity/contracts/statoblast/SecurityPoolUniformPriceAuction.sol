// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Constants } from '../Constants.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice A branch auction of exact ETH lots. Lower REP-per-lot limits bid a
/// higher price; every winning lot pledges exactly the same clearing REP.
/// Weak demand buys all inventory; grid residue belongs to winners as REP fees.
/// Its AVL tree freezes at closing and also owns unmaterialized winners' fees.
/// Bidding, clearing and detaching one winner use logarithmic paths, never scans.
contract SecurityPoolUniformPriceAuction {
	struct Bid {
		address bidder;
		address vault;
		uint256 targetHealthBps;
		uint256 lots;
		uint256 minimumAttoRepPerLot;
		bool settled;
		bool feesRemoved;
	}

	struct Clearing {
		uint256 attoRepPerLot;
		uint256 filledLots;
		uint256 raisedAttoEth;
		uint256 soldAttoRep;
		uint256 roundingAttoRep;
		uint256 marginalMinimumAttoRepPerLot;
		uint256 marginalFillLots;
		uint256 marginalDemandLots;
		uint256 fullBeforeLots;
		bool raiseLimitReached;
	}

	struct Fill {
		address bidder;
		address vault;
		uint256 targetHealthBps;
		uint256 filledLots;
		uint256 usedAttoEth;
		uint256 principalAttoRep;
		uint256 refundAttoEth;
	}

	struct Node {
		uint96 left;
		uint96 right;
		uint8 height;
		uint128 subtreeLots;
		uint128 removedLots;
		uint128 pendingAttoEth;
		uint128 pendingAttoRep;
		uint128 ownedAttoEth;
		uint128 ownedAttoRep;
	}

	address public immutable controller;
	address public feeAllocator;
	uint256 public opensAt;
	uint256 public closesAt;
	uint256 public lotAttoEth;
	uint256 public targetLots;
	uint256 public inventoryAttoRep;
	uint256 public maximumBidAttoRepPerLot;
	uint256 public repGrid;
	uint256 public depositedAttoEth;
	uint256 public bidCount;
	uint256 public remainingFeeLots;
	bool public initialized;
	bool public finalized;
	bool public raisedWithdrawn;
	Clearing public clearing;
	mapping(uint256 => Bid) public bids;
	mapping(address => uint256) public refundCreditAttoEth;
	mapping(address => uint256[]) private bidderIds;
	mapping(uint256 => Node) private nodes;
	uint96 private root;

	event AuctionStarted(uint256 opensAt, uint256 closesAt, uint256 lotAttoEth, uint256 targetLots, uint256 inventoryAttoRep, uint256 maximumAttoRepPerLot);
	event BidSubmitted(uint256 indexed bidId, address indexed bidder, address indexed vault, uint256 lots, uint256 minimumAttoRepPerLot, uint256 targetHealthBps);
	event AuctionFinalized(uint256 attoRepPerLot, uint256 filledLots, uint256 raisedAttoEth, uint256 soldAttoRep);
	event BidSettled(uint256 indexed bidId, address indexed bidder, uint256 filledLots, uint256 refundAttoEth);
	event FeesRemoved(uint256 indexed bidId, uint256 attoEth, uint256 attoRep);
	event RefundWithdrawn(address indexed bidder, address indexed recipient, uint256 amountAttoEth);
	event RaisedWithdrawn(address indexed recipient, uint256 amountAttoEth);

	constructor(address controller_) {
		require(controller_ != address(0), 'Auction controller is required');
		controller = controller_;
	}

	modifier onlyController() {
		require(msg.sender == controller, 'Only the auction controller can perform this operation');
		_;
	}

	function startAuction(uint256 opensAt_, uint256 closesAt_, uint256 lotAttoEth_, uint256 targetLots_, uint256 inventoryAttoRep_, uint256 repGrid_, address feeAllocator_) external onlyController {
		require(!initialized, 'Auction has already started');
		require(closesAt_ > opensAt_, 'Auction closing time must follow opening time');
		require(lotAttoEth_ > 0 && targetLots_ > 0 && targetLots_ <= type(uint128).max / lotAttoEth_, 'Auction ETH target is outside the supported range');
		require(inventoryAttoRep_ > 0 && inventoryAttoRep_ <= Constants.MAX_ATTO_REP, 'Auction REP inventory is outside the supported range');
		require(repGrid_ > 0 && feeAllocator_ != address(0), 'Auction grid and fee allocator are required');
		uint256 maximum = inventoryAttoRep_ - (inventoryAttoRep_ % repGrid_);
		require(maximum > 0, 'Auction inventory cannot fund one REP grid unit');
		initialized = true;
		opensAt = opensAt_;
		closesAt = closesAt_;
		lotAttoEth = lotAttoEth_;
		targetLots = targetLots_;
		inventoryAttoRep = inventoryAttoRep_;
		maximumBidAttoRepPerLot = maximum;
		repGrid = repGrid_;
		feeAllocator = feeAllocator_;
		emit AuctionStarted(opensAt_, closesAt_, lotAttoEth_, targetLots_, inventoryAttoRep_, maximum);
	}

	function submitBid(address bidder, address vault, uint256 targetHealthBps, uint256 lots, uint256 minimumAttoRepPerLot) external payable onlyController returns (uint256 bidId) {
		require(initialized && !finalized, 'Auction is not accepting bids');
		require(block.timestamp >= opensAt && block.timestamp < closesAt, 'Auction bidding window is closed');
		require(bidder != address(0) && vault != address(0), 'Auction bidder and vault are required');
		require(lots > 0 && lots <= type(uint128).max / lotAttoEth && msg.value == lots * lotAttoEth, 'Auction bid must fund exact whole ETH lots');
		require(msg.value <= type(uint128).max - depositedAttoEth, 'Auction deposits exceed the supported range');
		require(minimumAttoRepPerLot > 0 && minimumAttoRepPerLot % repGrid == 0, 'Auction bid must use the REP price grid');
		require(minimumAttoRepPerLot <= maximumBidAttoRepPerLot, 'Auction bid exceeds the REP inventory per lot');
		require(bidCount < type(uint96).max, 'Auction bid identifiers exhausted');
		depositedAttoEth += msg.value;
		bidId = ++bidCount;
		bids[bidId] = Bid(bidder, vault, targetHealthBps, lots, minimumAttoRepPerLot, false, false);
		nodes[bidId].height = 1;
		nodes[bidId].subtreeLots = _amount128(lots);
		root = _insert(root, uint96(bidId));
		bidderIds[bidder].push(bidId);
		emit BidSubmitted(bidId, bidder, vault, lots, minimumAttoRepPerLot, targetHealthBps);
	}

	/// @notice Zero capacity cancels safely. Otherwise the winning prefix must
	/// fit the inventory at every winner's minimum collateral amount per lot.
	function finalize(uint256 maximumFilledLots) external onlyController returns (Clearing memory result) {
		require(initialized && !finalized, 'Auction cannot be finalized');
		require(block.timestamp >= closesAt, 'Auction bidding window has not closed');
		result = previewFinalization(maximumFilledLots);
		clearing = result;
		remainingFeeLots = result.filledLots;
		if (result.roundingAttoRep != 0) nodes[root].pendingAttoRep = _amount128(result.roundingAttoRep);
		finalized = true;
		emit AuctionFinalized(result.attoRepPerLot, result.filledLots, result.raisedAttoEth, result.soldAttoRep);
	}

	function previewFinalization(uint256 maximumFilledLots) public view returns (Clearing memory result) {
		require(initialized, 'Auction has not started');
		if (finalized) return clearing;
		require(maximumFilledLots <= targetLots, 'Auction raise limit exceeds its target');
		if (maximumFilledLots == 0) return result;
		result.filledLots = _fundedLots(maximumFilledLots);
		if (result.filledLots == 0) return result;
		uint256 marginal = bids[_lotAt(result.filledLots)].minimumAttoRepPerLot;
		result.marginalMinimumAttoRepPerLot = marginal;
		result.fullBeforeLots = _pricePrefix(marginal, false);
		result.marginalDemandLots = _pricePrefix(marginal, true) - result.fullBeforeLots;
		result.marginalFillLots = result.filledLots - result.fullBeforeLots;
		result.raiseLimitReached = result.filledLots == maximumFilledLots;
		result.attoRepPerLot = result.raiseLimitReached ? marginal : inventoryAttoRep / result.filledLots;
		result.attoRepPerLot -= result.attoRepPerLot % repGrid;
		result.raisedAttoEth = result.filledLots * lotAttoEth;
		uint256 principal = result.filledLots * result.attoRepPerLot;
		result.soldAttoRep = result.raiseLimitReached ? principal : inventoryAttoRep;
		result.roundingAttoRep = result.soldAttoRep - principal;
	}

	function previewBid(uint256 bidId) public view returns (Fill memory fill) {
		require(finalized, 'Auction has not been finalized');
		Bid storage bid = bids[bidId];
		require(bid.bidder != address(0), 'Auction bid does not exist');
		uint256 before = _bidPrefix(bidId);
		fill.bidder = bid.bidder;
		fill.vault = bid.vault;
		fill.targetHealthBps = bid.targetHealthBps;
		fill.filledLots = _acceptedPrefix(before + bid.lots) - _acceptedPrefix(before);
		fill.usedAttoEth = fill.filledLots * lotAttoEth;
		fill.principalAttoRep = fill.filledLots * clearing.attoRepPerLot;
		fill.refundAttoEth = (bid.lots - fill.filledLots) * lotAttoEth;
	}

	function settleBid(uint256 bidId) external onlyController returns (Fill memory fill) {
		fill = previewBid(bidId);
		require(!bids[bidId].settled, 'Auction bid has already been settled');
		bids[bidId].settled = true;
		refundCreditAttoEth[fill.bidder] += fill.refundAttoEth;
		emit BidSettled(bidId, fill.bidder, fill.filledLots, fill.refundAttoEth);
	}

	/// @notice Accounting only: the capital ledger retains custody of these fees.
	/// Push exact integer budgets before removing ownership, so a late claimant
	/// keeps old earnings and cannot collect any later earnings after detaching.
	function allocateAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		require(msg.sender == feeAllocator, 'Only the auction fee allocator can detach ownership');
		Fill memory fill = previewBid(bidId);
		require(fill.filledLots > 0 && !bids[bidId].feesRemoved, 'Auction bid has no remaining fee ownership');
		nodes[root].pendingAttoEth += _amount128(addedAttoEth);
		nodes[root].pendingAttoRep += _amount128(addedAttoRep);
		(ownedAttoEth, ownedAttoRep) = _removeFees(root, bidId, 0, fill.filledLots);
		bids[bidId].feesRemoved = true;
		remainingFeeLots -= fill.filledLots;
		emit FeesRemoved(bidId, ownedAttoEth, ownedAttoRep);
	}

	/// @notice Exact fees this bid would receive if detached with the supplied
	/// newly checkpointed aggregate fees. Reading does not change any ownership.
	function previewBidFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external view returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		_amount128(addedAttoEth);
		_amount128(addedAttoRep);
		Fill memory fill = previewBid(bidId);
		if (fill.filledLots == 0 || bids[bidId].feesRemoved) return (0, 0);
		uint256 id = root;
		uint256 start;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 before = start + nodes[node.left].subtreeLots;
			uint256 leftWeight = _remainingWeight(node.left, start);
			uint256 ownWeight =
				bids[id].feesRemoved ? 0 : _acceptedPrefix(before + bids[id].lots) - _acceptedPrefix(before);
			uint256 total = _remainingWeight(id, start);
			(uint256 leftEth, uint256 ownEth, uint256 rightEth) = _partition(_amount128(uint256(node.pendingAttoEth) + addedAttoEth), leftWeight, ownWeight, total);
			(uint256 leftRep, uint256 ownRep, uint256 rightRep) = _partition(_amount128(uint256(node.pendingAttoRep) + addedAttoRep), leftWeight, ownWeight, total);
			if (id == bidId)
				return (
					_amount128(uint256(node.ownedAttoEth) + ownEth),
					_amount128(uint256(node.ownedAttoRep) + ownRep)
				);
			if (_before(bidId, id)) {
				id = node.left;
				addedAttoEth = leftEth;
				addedAttoRep = leftRep;
			} else {
				start = before + bids[id].lots;
				id = node.right;
				addedAttoEth = rightEth;
				addedAttoRep = rightRep;
			}
		}
		revert('Auction fee owner is missing');
	}

	function withdrawRaised(address payable recipient) external onlyController {
		require(finalized && !raisedWithdrawn, 'Auction proceeds are not withdrawable');
		require(recipient != address(0), 'Auction proceeds recipient is required');
		raisedWithdrawn = true;
		uint256 amount = clearing.raisedAttoEth;
		emit RaisedWithdrawn(recipient, amount);
		if (amount == 0) return;
		(bool sent, ) = recipient.call{value: amount}('');
		require(sent, 'Auction proceeds transfer failed');
	}

	function withdrawRefund(address payable recipient) external {
		require(refundCreditAttoEth[msg.sender] > 0, 'Auction has no refund credit for this bidder');
		_withdrawRefund(msg.sender, recipient);
	}

	function withdrawRefundFor(address bidder, address payable recipient) external onlyController {
		_withdrawRefund(bidder, recipient);
	}

	function _withdrawRefund(address bidder, address payable recipient) private {
		require(recipient != address(0), 'Auction refund recipient is required');
		uint256 amount = refundCreditAttoEth[bidder];
		if (amount == 0) return;
		refundCreditAttoEth[bidder] = 0;
		emit RefundWithdrawn(bidder, recipient, amount);
		(bool sent, ) = recipient.call{value: amount}('');
		require(sent, 'Auction refund transfer failed');
	}

	function bidderBidCount(address bidder) external view returns (uint256) {
		return bidderIds[bidder].length;
	}

	function bidderBidId(address bidder, uint256 index) external view returns (uint256) {
		return bidderIds[bidder][index];
	}

	function _acceptedPrefix(uint256 rawLots) private view returns (uint256) {
		Clearing storage result = clearing;
		if (rawLots <= result.fullBeforeLots) return rawLots;
		if (result.marginalDemandLots == 0 || rawLots >= result.fullBeforeLots + result.marginalDemandLots)
			return result.filledLots;
		return
			result.fullBeforeLots +
			Math.mulDiv(rawLots - result.fullBeforeLots, result.marginalFillLots, result.marginalDemandLots);
	}

	function _remainingWeight(uint256 id, uint256 start) private view returns (uint256) {
		if (id == 0) return 0;
		Node storage node = nodes[id];
		return _acceptedPrefix(start + node.subtreeLots) - _acceptedPrefix(start) - node.removedLots;
	}

	function _pushFees(uint256 id, uint256 start) private {
		Node storage node = nodes[id];
		uint256 eth = node.pendingAttoEth;
		uint256 rep = node.pendingAttoRep;
		if (eth == 0 && rep == 0) return;
		uint256 before = start + nodes[node.left].subtreeLots;
		uint256 leftWeight = _remainingWeight(node.left, start);
		uint256 ownWeight =
			bids[id].feesRemoved ? 0 : _acceptedPrefix(before + bids[id].lots) - _acceptedPrefix(before);
		uint256 total = _remainingWeight(id, start);
		require(total > 0, 'Auction fee budget has no remaining owner');
		(uint256 leftEth, uint256 ownEth, uint256 rightEth) = _partition(eth, leftWeight, ownWeight, total);
		(uint256 leftRep, uint256 ownRep, uint256 rightRep) = _partition(rep, leftWeight, ownWeight, total);
		node.pendingAttoEth = 0;
		node.pendingAttoRep = 0;
		node.ownedAttoEth += _amount128(ownEth);
		node.ownedAttoRep += _amount128(ownRep);
		if (node.left != 0) {
			nodes[node.left].pendingAttoEth += _amount128(leftEth);
			nodes[node.left].pendingAttoRep += _amount128(leftRep);
		}
		if (node.right != 0) {
			nodes[node.right].pendingAttoEth += _amount128(rightEth);
			nodes[node.right].pendingAttoRep += _amount128(rightRep);
		}
	}

	function _partition(uint256 budget, uint256 left, uint256 own, uint256 total) private pure returns (uint256 leftBudget, uint256 ownBudget, uint256 rightBudget) {
		leftBudget = Math.mulDiv(budget, left, total);
		uint256 throughOwn = Math.mulDiv(budget, left + own, total);
		ownBudget = throughOwn - leftBudget;
		rightBudget = budget - throughOwn;
	}

	function _removeFees(uint256 id, uint256 target, uint256 start, uint256 weight) private returns (uint256 eth, uint256 rep) {
		Node storage node = nodes[id];
		_pushFees(id, start);
		if (id == target) {
			eth = node.ownedAttoEth;
			rep = node.ownedAttoRep;
			node.ownedAttoEth = 0;
			node.ownedAttoRep = 0;
		} else if (_before(target, id)) (eth, rep) = _removeFees(node.left, target, start, weight);
		else (eth, rep) = _removeFees(node.right, target, start + nodes[node.left].subtreeLots + bids[id].lots, weight);
		node.removedLots += _amount128(weight);
	}

	function _pricePrefix(uint256 price, bool inclusive) private view returns (uint256 lots) {
		uint256 id = root;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 limit = bids[id].minimumAttoRepPerLot;
			if (limit < price || (inclusive && limit == price)) {
				lots += nodes[node.left].subtreeLots + bids[id].lots;
				id = node.right;
			} else id = node.left;
		}
	}

	/// @dev A later bid has a weakly larger minimum and can only lower affordable
	/// capacity. Subtree lot sums locate the largest feasible prefix in one path.
	function _fundedLots(uint256 maximumFilledLots) private view returns (uint256 lots) {
		uint256 id = root;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 before = lots + nodes[node.left].subtreeLots;
			uint256 capacity = Math.min(maximumFilledLots, inventoryAttoRep / bids[id].minimumAttoRepPerLot);
			if (capacity < before) id = node.left;
			else if (capacity <= before + bids[id].lots) return capacity;
			else {
				lots = before + bids[id].lots;
				id = node.right;
			}
		}
	}

	function _bidPrefix(uint256 target) private view returns (uint256 lots) {
		uint256 id = root;
		while (id != target) {
			Node storage node = nodes[id];
			if (_before(target, id)) id = node.left;
			else {
				lots += nodes[node.left].subtreeLots + bids[id].lots;
				id = node.right;
			}
		}
		return lots + nodes[nodes[id].left].subtreeLots;
	}

	function _lotAt(uint256 ordinal) private view returns (uint256 id) {
		id = root;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 left = nodes[node.left].subtreeLots;
			if (ordinal <= left) id = node.left;
			else if (ordinal <= left + bids[id].lots) return id;
			else {
				ordinal -= left + bids[id].lots;
				id = node.right;
			}
		}
		revert('Auction demand does not cover its clearing limit');
	}

	function _before(uint256 a, uint256 b) private view returns (bool) {
		uint256 first = bids[a].minimumAttoRepPerLot;
		uint256 second = bids[b].minimumAttoRepPerLot;
		return first < second || (first == second && a < b);
	}

	function _refresh(uint256 id) private {
		Node storage node = nodes[id];
		uint8 leftHeight = nodes[node.left].height;
		uint8 rightHeight = nodes[node.right].height;
		node.height = (leftHeight > rightHeight ? leftHeight : rightHeight) + 1;
		node.subtreeLots = _amount128(uint256(nodes[node.left].subtreeLots) + bids[id].lots + nodes[node.right].subtreeLots);
	}

	function _rotateLeft(uint96 id) private returns (uint96 pivot) {
		pivot = nodes[id].right;
		nodes[id].right = nodes[pivot].left;
		nodes[pivot].left = id;
		_refresh(id);
		_refresh(pivot);
	}

	function _rotateRight(uint96 id) private returns (uint96 pivot) {
		pivot = nodes[id].left;
		nodes[id].left = nodes[pivot].right;
		nodes[pivot].right = id;
		_refresh(id);
		_refresh(pivot);
	}

	function _insert(uint96 id, uint96 added) private returns (uint96) {
		if (id == 0) return added;
		Node storage node = nodes[id];
		if (_before(added, id)) node.left = _insert(node.left, added);
		else node.right = _insert(node.right, added);
		_refresh(id);
		if (nodes[node.left].height > nodes[node.right].height + 1) {
			if (!_before(added, node.left)) node.left = _rotateLeft(node.left);
			return _rotateRight(id);
		}
		if (nodes[node.right].height > nodes[node.left].height + 1) {
			if (_before(added, node.right)) node.right = _rotateRight(node.right);
			return _rotateLeft(id);
		}
		return id;
	}

	// These are outstanding custodial balances, not lifetime fee counters. The
	// bound greatly exceeds the ETH supply and the protocol's uint88 REP cap.
	function _amount128(uint256 value) private pure returns (uint128) {
		require(value <= type(uint128).max, 'Auction amount exceeds the supported range');
		return uint128(value);
	}
}
