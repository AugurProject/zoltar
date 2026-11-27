// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Collateral } from '../Collateral.sol';
import { Constants } from '../Constants.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolUniformPriceRepairAuction } from './SecurityPoolUniformPriceRepairAuction.sol';
import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';
import { ISecurityPoolRepairAuctionCapital } from './interfaces/ISecurityPoolRepairAuctionCapital.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface ICollateralRepairAuctionSecurityPool {
	function zoltar() external view returns (Zoltar);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function priceFeed(uint248 universeId) external view returns (address);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function oracleExposure(uint248 universeId) external view returns (uint256);
}

interface IRepairAuctionCapitalBidders {
	function registerRepairAuctionBidder(address bidder) external;
}

interface ICollateralRepairAuctionPriceFeed {
	function conservativePrice() external view returns (uint256);
	function priceValidUntil() external view returns (uint256);
	function lastSettlementTimestamp() external view returns (uint256);
	function acceptedExposureLimitAttoEth() external view returns (uint256);
	function acceptedRepExposureLimitAttoRep() external view returns (uint256);
}

/// @notice A fixed-deadline collateral repair auction whose winners are funded underwriters.
/// Only newly forfeited backing is sold. Old recovery REP and chosen capital
/// never enter this custody; missing demand or reports leave claims in runoff.
contract SecurityPoolRepairAuction is ISecurityPoolRepairAuctionCapital {
	using SafeERC20Ops for IERC20;

	address public immutable forkAuthority;
	ICollateralRepairAuctionSecurityPool public immutable securityPool;
	SecurityPoolCapitalLedger public immutable capital;
	SecurityPoolUniformPriceRepairAuction public immutable engine;
	IERC20 public immutable repToken;
	uint248 public immutable universeId;
	uint256 public immutable closesAt;
	uint256 public immutable inventoryAttoRep;
	uint256 public immutable shortfallAttoEth;
	uint256 public lotAttoEth;
	uint256 public targetLots;
	uint256 public immutable repGrid;
	uint256 public openingConservativePrice;
	uint256 public minimumCollateralAttoRepPerLot;
	bool private constant REQUIRE_FRESH_QUOTE = true;
	bool private constant ALLOW_EXPIRED_QUOTE = false;
	bool public opened;
	bool public finalized;
	bool private entered;

	event RepairAuctionOpened(uint256 conservativePrice, uint256 minimumCollateralAttoRepPerLot, uint256 maximumBidAttoRepPerLot);
	event RepairAuctionClosed(uint256 filledLots, uint256 raisedAttoEth, uint256 soldAttoRep);

	constructor(address authority, address root, uint248 child, uint256 deadline, uint256 inventory, uint256 shortfall) {
		require(authority != address(0) && root.code.length != 0, 'Collateral repair auction dependencies missing');
		forkAuthority = authority;
		securityPool = ICollateralRepairAuctionSecurityPool(root);
		capital = securityPool.capitalLedger(child);
		require(address(capital) != address(0), 'Collateral repair auction capital missing');
		repToken = IERC20(address(securityPool.zoltar().getRepToken(child)));
		universeId = child;
		closesAt = deadline;
		inventoryAttoRep = inventory;
		shortfallAttoEth = shortfall;
		uint256 minimumLot = securityPool.minimumCommitmentAttoEth();
		(targetLots, lotAttoEth) = _coveringLots(shortfall, Math.max(1, shortfall / minimumLot), minimumLot);
		uint256 multiplier = capital.securityMultiplierBps();
		repGrid = multiplier / _gcd(multiplier, 10_000);
		engine = new SecurityPoolUniformPriceRepairAuction(address(this), ICollateralConfig(root).collateralToken());
	}

	modifier nonReentrant() {
		require(!entered, 'Collateral repair auction operation active');
		entered = true;
		_;
		entered = false;
	}
	modifier onlyCapital() {
		require(msg.sender == address(capital), 'Only auction capital');
		_;
	}

	/// @notice Opening needs a challenged quote covering the maximum possible
	/// winning commitments and the fresh REP inventory before any bid is accepted.
	function open() external nonReentrant {
		require(!opened && !finalized && block.timestamp < closesAt, 'Collateral repair auction opening unavailable');
		require(closesAt - block.timestamp >= 1 days, 'Collateral repair auction requires one day of bidding');
		require(securityPool.zoltar().getForkTime(universeId) == 0, 'Collateral repair auction universe forked');
		require(targetLots != 0 && inventoryAttoRep != 0, 'Collateral repair auction has no saleable lots');
		ICollateralRepairAuctionPriceFeed feed = ICollateralRepairAuctionPriceFeed(securityPool.priceFeed(universeId));
		require(address(feed) != address(0) && _fundedQuote(feed, block.timestamp, REQUIRE_FRESH_QUOTE), 'Collateral repair auction quote is not funded and fresh');
		openingConservativePrice = feed.conservativePrice();
		uint256 required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), 10_000);
		// Fewer, larger lots bound REP-grid rounding while still covering the
		// whole deficit. A single full-deficit lot is the liveness exception.
		while (targetLots > 1 && (Math.ceilDiv(required, repGrid) * repGrid - required) * 100 >= required) {
			(targetLots, lotAttoEth) = _coveringLots(shortfallAttoEth, targetLots / 2, securityPool.minimumCommitmentAttoEth());
			required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), 10_000);
		}
		minimumCollateralAttoRepPerLot = Math.ceilDiv(required, repGrid) * repGrid;
		require(minimumCollateralAttoRepPerLot != 0 && minimumCollateralAttoRepPerLot <= inventoryAttoRep, 'Collateral repair auction inventory cannot back one lot');
		require(_fundedQuote(feed, block.timestamp, REQUIRE_FRESH_QUOTE), 'Collateral repair auction quote does not cover final lots');
		engine.startRepairAuction(block.timestamp, closesAt, lotAttoEth, targetLots, inventoryAttoRep, repGrid, address(this));
		opened = true;
		emit RepairAuctionOpened(openingConservativePrice, minimumCollateralAttoRepPerLot, engine.maximumBidAttoRepPerLot());
	}

	/// @notice Only the collateral purchase amount is paid upfront.
	/// The bid's minimum REP must back the commitment at the protocol floor at the
	/// opening price; a higher closing price raises every winning lot to that
	/// price's floor. Winning lots join the bidder's own capital account, whose
	/// owner chooses any higher health target after the auction.
	function submitBid(uint256 lots, uint256 minimumAttoRepPerLot) external nonReentrant returns (uint256 bidId) {
		require(opened && !finalized, 'Collateral repair auction is not accepting bids');
		require(securityPool.zoltar().getForkTime(universeId) == 0, 'Collateral repair auction universe forked');
		require(lots != 0, 'Invalid collateral repair auction lots');
		require(minimumAttoRepPerLot >= minimumCollateralAttoRepPerLot, 'Auction bid does not back its lots');
		IERC20 collateral = ICollateralConfig(address(securityPool)).collateralToken();
		Collateral.pull(collateral, msg.sender, address(engine), lots * lotAttoEth);
		bidId = engine.submitBid(msg.sender, lots, minimumAttoRepPerLot);
		IRepairAuctionCapitalBidders(address(capital)).registerRepairAuctionBidder(msg.sender);
	}

	/// @notice Closing never requires a bidder transaction. The quote is tested
	/// at the immutable deadline, so a late closer cannot select a later price.
	/// A quote that no longer covers the exposure, or a fork before the deadline, cancels the sale.
	function finalize() external nonReentrant returns (SecurityPoolUniformPriceRepairAuction.Clearing memory result) {
		require(msg.sender == forkAuthority, 'Only collateral repair auction fork authority');
		require(!finalized && block.timestamp >= closesAt, 'Collateral repair auction closing unavailable');
		finalized = true;
		if (opened) {
			ICollateralRepairAuctionPriceFeed feed = ICollateralRepairAuctionPriceFeed(securityPool.priceFeed(universeId));
			uint256 forkTime = securityPool.zoltar().getForkTime(universeId);
			// A final-day observation survives short settlement delays, while an
			// unattended auction cannot silently reuse its week-old opening quote.
			bool eligible =
				(forkTime == 0 || forkTime > closesAt) &&
					_fundedQuote(feed, closesAt, ALLOW_EXPIRED_QUOTE) &&
					closesAt - feed.lastSettlementTimestamp() <= 1 days;
			// A higher closing price does not cancel the sale: one marginally higher
			// report would otherwise void every funded bid and leave the branch
			// impaired for good. Every winning lot instead receives at least the REP
			// that backs it at the closing conservative price, and fewer lots fill
			// when the inventory cannot provide that.
			uint256 floorAttoRepPerLot;
			if (eligible)
				floorAttoRepPerLot =
					Math.ceilDiv(capital.commitmentIndex().requiredRep(lotAttoEth, feed.conservativePrice(), capital.securityMultiplierBps(), 10_000), repGrid) * repGrid;
			result = engine.finalize(eligible ? targetLots : 0, floorAttoRepPerLot);
			engine.withdrawRaised(payable(address(this)));
			// Equal lots round up, so a full fill can exceed the deficit: by less
			// than one raw collateral unit per lot once the deficit spans at least one minimum
			// commitment, and otherwise by up to the minimum lot. The child book
			// accepts at most the deficit, and the surplus has no owner, so it is burned.
			IERC20 collateral = ICollateralConfig(address(securityPool)).collateralToken();
			if (result.raisedAttoEth > shortfallAttoEth) {
				Collateral.send(collateral, Constants.BURN_ADDRESS, result.raisedAttoEth - shortfallAttoEth);
				result.raisedAttoEth = shortfallAttoEth;
			}
			Collateral.send(collateral, forkAuthority, result.raisedAttoEth);
		} else engine.finalizeUnopened();
		// Sold inventory enters capital custody for winning bids. Unsold inventory,
		// including any indivisible remainder, returns to the fork authority.
		if (result.soldAttoRep != 0) repToken.safeTransfer(address(capital), result.soldAttoRep);
		uint256 remaining = inventoryAttoRep - result.soldAttoRep;
		if (remaining != 0) repToken.safeTransfer(forkAuthority, remaining);
		emit RepairAuctionClosed(result.filledLots, result.raisedAttoEth, result.soldAttoRep);
	}

	function bidPosition(uint256 bidId) external view returns (BidPosition memory position) {
		if (!finalized) {
			(address bidder, bool settled, , , ) = engine.bids(bidId);
			// Before closing, a bid can settle only when it is permanently excluded.
			require(settled, 'Auction has not been finalized');
			return BidPosition(bidder, 0);
		}
		SecurityPoolUniformPriceRepairAuction.Fill memory fill = engine.previewBid(bidId);
		return BidPosition(fill.bidder, fill.filledLots);
	}
	function bidderBidCount(address bidder) external view returns (uint256) {
		return engine.bidderBidCount(bidder);
	}
	function bidderBidId(address bidder, uint256 index) external view returns (uint256) {
		return engine.bidderBidId(bidder, index);
	}
	function claimAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external onlyCapital returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		return engine.allocateAndRemoveFees(bidId, addedAttoEth, addedAttoRep);
	}
	function previewBidFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external view returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		return engine.previewBidFees(bidId, addedAttoEth, addedAttoRep);
	}
	/// @notice Anyone may credit refunds, including a provably losing bid before
	/// closing. Only its bidder may withdraw the freely usable collateral.
	/// Refunds and position materialization are independent and never scan bids.
	function settleRefund(uint256 bidId) external nonReentrant {
		require(opened, 'Collateral repair auction has not opened');
		engine.settleBid(bidId);
	}
	function withdrawRefunds(address payable recipient) external nonReentrant {
		require(recipient != address(0), 'Collateral repair auction refund recipient missing');
		engine.withdrawRefundFor(msg.sender, recipient);
	}
	/// @notice One transaction for the bidder: credit its own eligible bid, or skip
	/// a credit someone already made, then withdraw its whole refund credit. The
	/// withdrawal includes credits from the bidder's other bids in this auction.
	function settleAndWithdrawRefund(uint256 bidId, address payable recipient) external nonReentrant returns (uint256 amountAttoEth) {
		require(opened, 'Collateral repair auction has not opened');
		require(recipient != address(0), 'Collateral repair auction refund recipient missing');
		return engine.settleAndWithdrawRefund(bidId, msg.sender, recipient);
	}

	function _fundedQuote(ICollateralRepairAuctionPriceFeed feed, uint256 atTime, bool requireFresh) private view returns (bool) {
		return
			feed.lastSettlementTimestamp() != 0 &&
			feed.lastSettlementTimestamp() <= atTime &&
			(!requireFresh || feed.priceValidUntil() > atTime) &&
			feed.acceptedExposureLimitAttoEth() >= securityPool.oracleExposure(universeId) &&
			feed.acceptedRepExposureLimitAttoRep() >= inventoryAttoRep;
	}
	function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
		while (b != 0) (a, b) = (b, a % b);
		return a;
	}
	/// @dev Equal lots of at least the minimum commitment that together cover the
	/// whole deficit: at most `requestedLots` lots of ceil(deficit / requestedLots),
	/// trimmed so no lot lies entirely beyond the deficit. Divisibility is not required.
	function _coveringLots(uint256 shortfall, uint256 requestedLots, uint256 minimumLot) private pure returns (uint256 lots, uint256 lot) {
		lot = Math.max(minimumLot, Math.ceilDiv(shortfall, requestedLots));
		lots = Math.ceilDiv(shortfall, lot);
	}
}

contract SecurityPoolRepairAuctionDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolRepairAuction).creationCode) {}
	function create(address authority, address securityPool, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address) {
		return _deploy(abi.encode(authority, securityPool, child, close, inventory, shortfall));
	}
}
