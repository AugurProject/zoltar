// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { IERC20 } from '../IERC20.sol';
import { Collateral } from '../Collateral.sol';

import { Constants } from '../Constants.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice A branch auction of exact collateral lots. Lower REP-per-lot limits bid a
/// higher price; every winning lot pledges exactly the same clearing REP.
/// Only filled lots sell REP; unsold inventory, including grid residue, returns to the fork
/// coordinator, which burns it after a full repair and otherwise keeps it as recovery REP.
/// Its AVL tree freezes at closing and also owns unmaterialized winners' fees.
/// Bidding, clearing and detaching one winner use logarithmic paths, never scans.
contract SecurityPoolUniformPriceRepairAuction {
	/// @dev The bidder's own address receives any winning lots in the capital
	/// ledger; the flags share the bidder's slot.
	struct Bid {
		address bidder;
		bool settled;
		bool feesRemoved;
		uint256 lots;
		uint256 minimumAttoRepPerLot;
	}

	struct Clearing {
		uint256 attoRepPerLot;
		uint256 filledLots;
		uint256 raisedAttoEth;
		uint256 soldAttoRep;
		bool raiseLimitReached;
	}

	struct Fill {
		address bidder;
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
	uint256 public closesAt;
	uint256 public lotAttoEth;
	uint256 public targetLots;
	uint256 public inventoryAttoRep;
	uint256 public maximumBidAttoRepPerLot;
	uint256 public repGrid;
	uint256 public depositedAttoEth;
	uint256 private withdrawnCollateral;
	uint256 public bidCount;
	uint256 public remainingFeeLots;
	bool public initialized;
	bool public finalized;
	Clearing public clearing;
	mapping(uint256 => Bid) public bids;
	mapping(address => uint256[]) private bidderIds;
	mapping(uint256 => Node) private nodes;
	uint96 private root;

	event RepairAuctionStarted(uint256 closesAt, uint256 lotAttoEth, uint256 targetLots, uint256 inventoryAttoRep, uint256 maximumAttoRepPerLot);
	event BidSubmitted(uint256 indexed bidId, address indexed bidder, uint256 lots, uint256 minimumAttoRepPerLot);
	event RepairAuctionFinalized(uint256 attoRepPerLot, uint256 filledLots, uint256 raisedAttoEth, uint256 soldAttoRep);
	event BidSettled(uint256 indexed bidId, address indexed bidder, uint256 filledLots, uint256 refundAttoEth);
	event FeesRemoved(uint256 indexed bidId, uint256 attoEth, uint256 attoRep);
	event RefundWithdrawn(address indexed bidder, address indexed recipient, uint256 amountAttoEth);

	IERC20 public immutable collateralToken;
	constructor(address controller_, IERC20 token) {
		collateralToken = token;
		require(controller_ != address(0), 'Auction controller is required');
		controller = controller_;
	}

	modifier onlyController() {
		require(msg.sender == controller, 'Only the auction controller can perform this operation');
		_;
	}

	/// @notice Bidding opens at once and runs until `closesAt_`.
	function startRepairAuction(uint256 closesAt_, uint256 lotAttoEth_, uint256 targetLots_, uint256 inventoryAttoRep_, uint256 repGrid_) external onlyController {
		require(!initialized && !finalized, 'Auction has already started');
		require(closesAt_ > block.timestamp, 'Auction closing time must follow opening time');
		require(lotAttoEth_ > 0 && targetLots_ > 0 && targetLots_ <= type(uint128).max / lotAttoEth_, 'Auction ETH target is outside the supported range');
		require(inventoryAttoRep_ > 0 && inventoryAttoRep_ <= Constants.MAX_ATTO_REP, 'Auction REP inventory is outside the supported range');
		require(repGrid_ > 0, 'Auction REP grid is required');
		uint256 maximum = inventoryAttoRep_ - (inventoryAttoRep_ % repGrid_);
		require(maximum > 0, 'Auction inventory cannot fund one REP grid unit');
		initialized = true;
		closesAt = closesAt_;
		lotAttoEth = lotAttoEth_;
		targetLots = targetLots_;
		inventoryAttoRep = inventoryAttoRep_;
		maximumBidAttoRepPerLot = maximum;
		repGrid = repGrid_;
		emit RepairAuctionStarted(closesAt_, lotAttoEth_, targetLots_, inventoryAttoRep_, maximum);
	}

	function submitBid(address bidder, uint256 lots, uint256 minimumAttoRepPerLot) external onlyController returns (uint256 bidId) {
		require(initialized && !finalized, 'Auction is not accepting bids');
		require(block.timestamp < closesAt, 'Auction bidding window is closed');
		require(bidder != address(0), 'Auction bidder is required');
		require(lots > 0 && lots <= type(uint128).max / lotAttoEth, 'Auction bid must fund exact whole ETH lots');
		require(lots * lotAttoEth <= type(uint128).max - depositedAttoEth, 'Auction deposits exceed the supported range');
		require(minimumAttoRepPerLot > 0 && minimumAttoRepPerLot % repGrid == 0, 'Auction bid must use the REP price grid');
		require(minimumAttoRepPerLot <= maximumBidAttoRepPerLot, 'Auction bid exceeds the REP inventory per lot');
		// Equal limits fill in submission order, so a new bid ranks after every equal one.
		require(!_isBidExcluded(minimumAttoRepPerLot), 'Better bids already exclude this bid');
		require(bidCount < type(uint96).max, 'Auction bid identifiers exhausted');
		// The controller transfers bidder collateral directly into this engine before registration.
		require(collateralToken.balanceOf(address(this)) + withdrawnCollateral >= depositedAttoEth + lots * lotAttoEth, 'Auction bid collateral missing');
		depositedAttoEth += lots * lotAttoEth;
		bidId = ++bidCount;
		bids[bidId] = Bid({bidder: bidder, settled: false, feesRemoved: false, lots: lots, minimumAttoRepPerLot: minimumAttoRepPerLot});
		nodes[bidId].height = 1;
		nodes[bidId].subtreeLots = _amount128(lots);
		root = _insert(root, uint96(bidId));
		bidderIds[bidder].push(bidId);
		emit BidSubmitted(bidId, bidder, lots, minimumAttoRepPerLot);
	}

	/// @notice Records an empty clearing when the controller closes without opening bidding.
	function finalizeUnopened() external onlyController {
		require(!initialized && !finalized, 'Auction cannot be finalized');
		finalized = true;
		emit RepairAuctionFinalized(0, 0, 0, 0);
	}

	/// @notice Zero capacity cancels safely. Otherwise the winning prefix must
	/// fit the inventory at every winner's minimum collateral amount per lot.
	/// The raised collateral goes to the controller in the same call.
	function finalize(uint256 maximumFilledLots, uint256 floorAttoRepPerLot) external onlyController returns (Clearing memory result) {
		require(initialized && !finalized, 'Auction cannot be finalized');
		require(block.timestamp >= closesAt, 'Auction bidding window has not closed');
		result = previewFinalization(maximumFilledLots, floorAttoRepPerLot);
		clearing = result;
		remainingFeeLots = result.filledLots;
		finalized = true;
		emit RepairAuctionFinalized(result.attoRepPerLot, result.filledLots, result.raisedAttoEth, result.soldAttoRep);
		if (result.raisedAttoEth == 0) return result;
		withdrawnCollateral += result.raisedAttoEth;
		Collateral.send(collateralToken, controller, result.raisedAttoEth);
	}

	/// @notice Highest grid-aligned limit that a new bid can enter at this block.
	/// Inclusive demand gives every existing equal-price bid its submission priority.
	function maximumAdmissibleBidAttoRepPerLot() external view returns (uint256) {
		if (!initialized || finalized || block.timestamp >= closesAt || lotAttoEth > type(uint128).max - depositedAttoEth) return 0;
		uint256 low;
		uint256 high = maximumBidAttoRepPerLot / repGrid;
		while (low < high) {
			uint256 middle = low + (high - low + 1) / 2;
			if (_isBidExcluded(middle * repGrid)) high = middle - 1;
			else low = middle;
		}
		return low * repGrid;
	}
	function _isBidExcluded(uint256 minimum) private view returns (bool) {
		return _pricePrefix(minimum) >= Math.min(targetLots, inventoryAttoRep / minimum);
	}

	/// @notice `floorAttoRepPerLot` is the least REP every winning lot must receive,
	/// whatever its bid accepted. It lowers the lots the inventory can fund and
	/// raises the clearing REP per lot, and never changes which bids rank first.
	function previewFinalization(uint256 maximumFilledLots, uint256 floorAttoRepPerLot) public view returns (Clearing memory result) {
		if (finalized) return clearing;
		require(initialized, 'Auction has not started');
		require(maximumFilledLots <= targetLots, 'Auction raise limit exceeds its target');
		require(floorAttoRepPerLot % repGrid == 0, 'Auction floor must use the REP price grid');
		if (maximumFilledLots == 0) return result;
		result.filledLots = _fundedLots(maximumFilledLots, floorAttoRepPerLot);
		if (result.filledLots == 0) return result;
		uint256 marginal = bids[_lotAt(result.filledLots)].minimumAttoRepPerLot;
		result.raiseLimitReached = result.filledLots == maximumFilledLots;
		result.attoRepPerLot = Math.max(marginal, floorAttoRepPerLot);
		result.raisedAttoEth = result.filledLots * lotAttoEth;
		// Both bid limits and the floor are already REP-grid aligned.
		result.soldAttoRep = result.filledLots * result.attoRepPerLot;
	}

	function previewBid(uint256 bidId) public view returns (Fill memory fill) {
		require(finalized, 'Auction has not been finalized');
		Bid storage bid = bids[bidId];
		require(bid.bidder != address(0), 'Auction bid does not exist');
		uint256 before = _bidPrefix(bidId);
		fill.bidder = bid.bidder;
		fill.filledLots = _acceptedPrefix(before + bid.lots) - _acceptedPrefix(before);
		fill.usedAttoEth = fill.filledLots * lotAttoEth;
		fill.principalAttoRep = fill.filledLots * clearing.attoRepPerLot;
		fill.refundAttoEth = (bid.lots - fill.filledLots) * lotAttoEth;
	}

	/// @notice Refund only a bid excluded by binding demand that ranks before it:
	/// a lower limit, or an equal limit submitted earlier. That demand never
	/// decreases: bids cannot be cancelled or repriced and later equal bids rank after. A
	/// refunded bid stays in the tree, permanently outside every winning prefix,
	/// so neither clearing nor lazy fee ownership needs a deletion or a scan.
	function earlyRefundAttoEth(uint256 bidId) public view returns (uint256) {
		Bid storage bid = bids[bidId];
		if (!initialized || finalized || bid.bidder == address(0) || bid.settled) return 0;
		uint256 capacity = Math.min(targetLots, inventoryAttoRep / bid.minimumAttoRepPerLot);
		if (_bidPrefix(bidId) < capacity) return 0;
		return bid.lots * lotAttoEth;
	}

	/// @notice Next still-shared winner in price order, excluding afterBidId.
	/// Zero starts or ends a sweep. The frozen tree preserves cursors even after
	/// materialization. Zero-weight subtrees skip losers and detached winners.
	function nextUnmaterializedBid(uint256 afterBidId) external view returns (uint256) {
		require(finalized, 'Auction has not been finalized');
		require(afterBidId <= bidCount, 'Auction cursor does not exist');
		uint256 cutoff = afterBidId == 0 ? 0 : _bidPrefix(afterBidId) + bids[afterBidId].lots;
		return _nextUnmaterialized(root, 0, cutoff);
	}

	function _nextUnmaterialized(uint256 id, uint256 start, uint256 cutoff) private view returns (uint256) {
		if (id == 0 || start + nodes[id].subtreeLots <= cutoff || _remainingWeight(id, start) == 0) return 0;
		Node storage node = nodes[id];
		uint256 found = _nextUnmaterialized(node.left, start, cutoff);
		if (found != 0) return found;
		uint256 before = start + nodes[node.left].subtreeLots;
		uint256 end = before + bids[id].lots;
		if (end > cutoff && !bids[id].feesRemoved && _acceptedPrefix(end) > _acceptedPrefix(before)) return id;
		return _nextUnmaterialized(node.right, end, cutoff);
	}

	/// @notice Settle one of `bidder`'s bids and pay its unused collateral to
	/// `recipient`: the whole bid once better bids exclude it, or its unfilled
	/// lots after closing. Each bid settles once, so it pays at most once.
	function refundBid(uint256 bidId, address bidder, address recipient) external onlyController returns (uint256 amountAttoEth) {
		Bid storage bid = bids[bidId];
		require(bid.bidder != address(0) && bid.bidder == bidder, 'Auction bid belongs to another bidder');
		require(!bid.settled, 'Auction bid has already been settled');
		require(recipient != address(0), 'Auction refund recipient is required');
		uint256 filledLots;
		if (finalized) {
			Fill memory fill = previewBid(bidId);
			filledLots = fill.filledLots;
			amountAttoEth = fill.refundAttoEth;
		} else {
			amountAttoEth = earlyRefundAttoEth(bidId);
			require(amountAttoEth != 0, 'Bid may still win');
		}
		require(amountAttoEth != 0, 'Auction bid has no refund');
		bid.settled = true;
		emit BidSettled(bidId, bidder, filledLots, amountAttoEth);
		emit RefundWithdrawn(bidder, recipient, amountAttoEth);
		withdrawnCollateral += amountAttoEth;
		Collateral.send(collateralToken, recipient, amountAttoEth);
	}

	/// @notice Accounting only: the capital ledger retains custody of these fees.
	/// Push exact integer budgets before removing ownership, so a late claimant
	/// keeps old earnings and cannot collect any later earnings after detaching.
	function allocateAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external onlyController returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
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

	function bidderBidCount(address bidder) external view returns (uint256) {
		return bidderIds[bidder].length;
	}

	function bidderBidId(address bidder, uint256 index) external view returns (uint256) {
		return bidderIds[bidder][index];
	}

	/// @dev Price-time priority: the tree orders equal limits by bid id, so the winning
	/// lots are exactly the first `filledLots` of the order. A late oversized bid at the
	/// marginal limit cannot crowd out equal bids submitted before it.
	function _acceptedPrefix(uint256 rawLots) private view returns (uint256) {
		return Math.min(rawLots, clearing.filledLots);
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

	/// @dev Lots of every bid whose limit is at most `minimumRepPerLot`.
	function _pricePrefix(uint256 minimumRepPerLot) private view returns (uint256 lots) {
		uint256 id = root;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 limit = bids[id].minimumAttoRepPerLot;
			if (limit <= minimumRepPerLot) {
				lots += nodes[node.left].subtreeLots + bids[id].lots;
				id = node.right;
			} else id = node.left;
		}
	}

	/// @dev A later bid has a weakly larger minimum and can only lower affordable
	/// capacity. Subtree lot sums locate the largest feasible prefix in one path.
	function _fundedLots(uint256 maximumFilledLots, uint256 floorAttoRepPerLot) private view returns (uint256 lots) {
		uint256 id = root;
		while (id != 0) {
			Node storage node = nodes[id];
			uint256 before = lots + nodes[node.left].subtreeLots;
			uint256 capacity = Math.min(maximumFilledLots, inventoryAttoRep / Math.max(bids[id].minimumAttoRepPerLot, floorAttoRepPerLot));
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
