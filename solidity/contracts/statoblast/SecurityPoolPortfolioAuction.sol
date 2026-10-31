// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolUniformPriceAuction } from './SecurityPoolUniformPriceAuction.sol';
import { SecurityPoolAuctionVault } from './SecurityPoolAuctionVault.sol';
import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';
import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface ITruthAuctionPortfolio {
	function zoltar() external view returns (Zoltar);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function priceFeed(uint248 universeId) external view returns (address);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function oracleExposure(uint248 universeId) external view returns (uint256);
}

interface ITruthAuctionPriceFeed {
	function conservativePrice() external view returns (uint256);
	function priceValidUntil() external view returns (uint256);
	function lastSettlementTimestamp() external view returns (uint256);
	function acceptedExposureLimitAttoEth() external view returns (uint256);
	function acceptedRepExposureLimitAttoRep() external view returns (uint256);
}

/// @notice A fixed-deadline truth auction whose winners are funded underwriters.
/// Only newly forfeited backing is sold. Old recovery REP and chosen capital
/// never enter this custody; missing demand or reports leave claims in runoff.
contract SecurityPoolPortfolioAuction is ISecurityPoolAuctionCapital {
	using SafeERC20Ops for IERC20;

	address public immutable forkAuthority;
	ITruthAuctionPortfolio public immutable portfolio;
	SecurityPoolCapitalLedger public immutable capital;
	SecurityPoolUniformPriceAuction public immutable engine;
	IERC20 public immutable repToken;
	uint248 public immutable universeId;
	uint256 public immutable closesAt;
	uint256 public immutable inventoryAttoRep;
	uint256 public immutable shortfallAttoEth;
	uint256 public immutable lotAttoEth;
	uint256 public immutable targetLots;
	uint256 public immutable repGrid;
	uint256 public openingConservativePrice;
	uint256 public minimumCollateralAttoRepPerLot;
	bool public opened;
	bool public finalized;
	bool private entered;
	mapping(address => uint256) public bidIdForVault;

	event AuctionOpened(uint256 conservativePrice, uint256 minimumCollateralAttoRepPerLot, uint256 maximumBidAttoRepPerLot);
	event WinningVaultCreated(uint256 indexed bidId, address indexed bidder, address indexed vault);
	event AuctionClosed(uint256 filledLots, uint256 raisedAttoEth, uint256 soldAttoRep);

	constructor(address authority, address root, uint248 child, uint256 deadline, uint256 inventory, uint256 shortfall) {
		require(authority != address(0) && root.code.length != 0, 'Truth auction dependencies missing');
		forkAuthority = authority;
		portfolio = ITruthAuctionPortfolio(root);
		capital = portfolio.capitalLedger(child);
		require(address(capital) != address(0), 'Truth auction capital missing');
		repToken = IERC20(address(portfolio.zoltar().getRepToken(child)));
		universeId = child;
		closesAt = deadline;
		inventoryAttoRep = inventory;
		shortfallAttoEth = shortfall;
		lotAttoEth = portfolio.minimumCommitmentAttoEth();
		targetLots = shortfall / lotAttoEth;
		uint256 multiplier = capital.securityMultiplierBps();
		repGrid = multiplier / _gcd(multiplier, 10_000);
		engine = new SecurityPoolUniformPriceAuction(address(this));
	}

	modifier nonReentrant() {
		require(!entered, 'Truth auction operation active');
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
		require(!opened && !finalized && block.timestamp < closesAt, 'Truth auction opening unavailable');
		require(portfolio.zoltar().getForkTime(universeId) == 0, 'Truth auction universe forked');
		require(targetLots != 0 && inventoryAttoRep != 0, 'Truth auction has no saleable lots');
		ITruthAuctionPriceFeed feed = ITruthAuctionPriceFeed(portfolio.priceFeed(universeId));
		require(address(feed) != address(0) && _fundedQuote(feed, block.timestamp), 'Truth auction quote is not funded and fresh');
		openingConservativePrice = feed.conservativePrice();
		uint256 required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), 10_000);
		minimumCollateralAttoRepPerLot = Math.ceilDiv(required, repGrid) * repGrid;
		require(minimumCollateralAttoRepPerLot <= inventoryAttoRep, 'Truth auction inventory cannot back one lot');
		engine.startAuction(block.timestamp, closesAt, lotAttoEth, targetLots, inventoryAttoRep, repGrid, address(this));
		opened = true;
		emit AuctionOpened(openingConservativePrice, minimumCollateralAttoRepPerLot, engine.maximumBidAttoRepPerLot());
	}

	/// @notice Only the ETH purchase amount is paid upfront.
	/// Purchased REP must back the commitment at the bidder's chosen health target.
	function submitBid(uint256 lots, uint256 minimumAttoRepPerLot, uint256 targetHealthFactorBps) external payable nonReentrant returns (uint256 bidId, address vault) {
		require(opened && !finalized, 'Truth auction is not accepting bids');
		require(portfolio.zoltar().getForkTime(universeId) == 0, 'Truth auction universe forked');
		require(lots != 0 && targetHealthFactorBps >= 10_000, 'Invalid truth auction lots or health target');
		require(msg.value == lots * lotAttoEth, 'Truth auction ETH funding mismatch');
		uint256 required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), targetHealthFactorBps);
		require(minimumAttoRepPerLot >= required, 'Auction bid does not meet chosen health target');
		bidId = engine.bidCount() + 1;
		vault = address(new SecurityPoolAuctionVault{salt: bytes32(bidId)}(msg.sender, address(capital), address(this), bidId));
		bidIdForVault[vault] = bidId;
		require(engine.submitBid{value: lots * lotAttoEth}(msg.sender, vault, targetHealthFactorBps, lots, minimumAttoRepPerLot) == bidId, 'Auction bid identity mismatch');
		emit WinningVaultCreated(bidId, msg.sender, vault);
	}

	/// @notice Closing never requires a bidder transaction. The quote is tested
	/// at the immutable deadline, so a late closer cannot select a later price.
	function finalize() external nonReentrant returns (SecurityPoolUniformPriceAuction.Clearing memory result) {
		require(msg.sender == forkAuthority, 'Only truth auction fork authority');
		require(!finalized && block.timestamp >= closesAt, 'Truth auction closing unavailable');
		finalized = true;
		if (opened) {
			ITruthAuctionPriceFeed feed = ITruthAuctionPriceFeed(portfolio.priceFeed(universeId));
			uint256 forkTime = portfolio.zoltar().getForkTime(universeId);
			bool eligible =
				(forkTime == 0 || forkTime > closesAt) &&
					_fundedQuote(feed, closesAt) &&
					feed.conservativePrice() <= openingConservativePrice;
			result = engine.finalize(eligible ? targetLots : 0);
			engine.withdrawRaised(payable(forkAuthority));
		}
		// All sold inventory enters capital custody. Any indivisible remainder is
		// owned only by winning bids through the auction's initial REP fee credits.
		if (result.soldAttoRep != 0) repToken.safeTransfer(address(capital), result.soldAttoRep);
		uint256 remaining = inventoryAttoRep - result.soldAttoRep;
		if (remaining != 0) repToken.safeTransfer(forkAuthority, remaining);
		emit AuctionClosed(result.filledLots, result.raisedAttoEth, result.soldAttoRep);
	}

	function bidPosition(uint256 bidId) external view returns (BidPosition memory position) {
		SecurityPoolUniformPriceAuction.Fill memory fill = engine.previewBid(bidId);
		return BidPosition(fill.vault, fill.targetHealthBps, fill.filledLots);
	}
	function claimAndRemoveFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external onlyCapital returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		return engine.allocateAndRemoveFees(bidId, addedAttoEth, addedAttoRep);
	}
	function previewBidFees(uint256 bidId, uint256 addedAttoEth, uint256 addedAttoRep) external view returns (uint256 ownedAttoEth, uint256 ownedAttoRep) {
		return engine.previewBidFees(bidId, addedAttoEth, addedAttoRep);
	}
	/// @notice Anyone may credit one bid's refunds; only its bidder may withdraw.
	/// Refunds and position materialization are independent and never scan bids.
	function settleRefund(uint256 bidId) external nonReentrant {
		require(finalized, 'Truth auction has not closed');
		engine.settleBid(bidId);
	}
	function withdrawRefunds(address payable recipient) external nonReentrant {
		require(recipient != address(0), 'Truth auction refund recipient missing');
		engine.withdrawRefundFor(msg.sender, recipient);
	}

	function _fundedQuote(ITruthAuctionPriceFeed feed, uint256 atTime) private view returns (bool) {
		return
			feed.lastSettlementTimestamp() != 0 &&
			feed.lastSettlementTimestamp() <= atTime &&
			feed.priceValidUntil() > atTime &&
			feed.acceptedExposureLimitAttoEth() >= portfolio.oracleExposure(universeId) &&
			feed.acceptedRepExposureLimitAttoRep() >= inventoryAttoRep;
	}
	function _gcd(uint256 a, uint256 b) private pure returns (uint256) {
		while (b != 0) (a, b) = (b, a % b);
		return a;
	}
}

contract SecurityPoolPortfolioAuctionDeployer is SecurityPoolCreationCodeDeployer {
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolPortfolioAuction).creationCode) {}
	function create(address authority, address portfolio, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address) {
		return _deploy(abi.encode(authority, portfolio, child, close, inventory, shortfall));
	}
}
