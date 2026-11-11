// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolUniformPriceAuction } from './SecurityPoolUniformPriceAuction.sol';
import { SecurityPoolAuctionVault, SecurityPoolAuctionVaultClones } from './SecurityPoolAuctionVault.sol';
import { SecurityPoolCreationCodeDeployer } from './SecurityPoolCreationCode.sol';
import { ISecurityPoolAuctionCapital } from './interfaces/ISecurityPoolAuctionCapital.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface ICollateralRepairAuctionPortfolio {
	function zoltar() external view returns (Zoltar);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function priceFeed(uint248 universeId) external view returns (address);
	function minimumCommitmentAttoEth() external view returns (uint256);
	function oracleExposure(uint248 universeId) external view returns (uint256);
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
contract SecurityPoolPortfolioAuction is ISecurityPoolAuctionCapital {
	using SafeERC20Ops for IERC20;

	address public immutable forkAuthority;
	ICollateralRepairAuctionPortfolio public immutable portfolio;
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
	/// @notice Shared code behind every bid's vault clone; each clone binds its own owner, ledger, auction and bid.
	address public immutable vaultImplementation;
	uint256 public openingConservativePrice;
	uint256 public minimumCollateralAttoRepPerLot;
	bool public opened;
	bool public finalized;
	bool private entered;
	mapping(address => uint256) public bidIdForVault;

	event AuctionOpened(uint256 conservativePrice, uint256 minimumCollateralAttoRepPerLot, uint256 maximumBidAttoRepPerLot);
	event WinningVaultCreated(uint256 indexed bidId, address indexed bidder, address indexed vault);
	event AuctionClosed(uint256 filledLots, uint256 raisedAttoEth, uint256 soldAttoRep);

	constructor(address authority, address root, uint248 child, uint256 deadline, uint256 inventory, uint256 shortfall, address implementation) {
		require(authority != address(0) && root.code.length != 0 && implementation.code.length != 0, 'Collateral repair auction dependencies missing');
		forkAuthority = authority;
		vaultImplementation = implementation;
		portfolio = ICollateralRepairAuctionPortfolio(root);
		capital = portfolio.capitalLedger(child);
		require(address(capital) != address(0), 'Collateral repair auction capital missing');
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
		require(portfolio.zoltar().getForkTime(universeId) == 0, 'Collateral repair auction universe forked');
		require(targetLots != 0 && inventoryAttoRep != 0, 'Collateral repair auction has no saleable lots');
		ICollateralRepairAuctionPriceFeed feed = ICollateralRepairAuctionPriceFeed(portfolio.priceFeed(universeId));
		require(address(feed) != address(0) && _fundedQuote(feed, block.timestamp), 'Collateral repair auction quote is not funded and fresh');
		openingConservativePrice = feed.conservativePrice();
		uint256 required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), 10_000);
		minimumCollateralAttoRepPerLot = Math.ceilDiv(required, repGrid) * repGrid;
		require(minimumCollateralAttoRepPerLot <= inventoryAttoRep, 'Collateral repair auction inventory cannot back one lot');
		engine.startAuction(block.timestamp, closesAt, lotAttoEth, targetLots, inventoryAttoRep, repGrid, address(this));
		opened = true;
		emit AuctionOpened(openingConservativePrice, minimumCollateralAttoRepPerLot, engine.maximumBidAttoRepPerLot());
	}

	/// @notice Only the ETH purchase amount is paid upfront.
	/// Purchased REP must back the commitment at the bidder's chosen health target.
	function submitBid(uint256 lots, uint256 minimumAttoRepPerLot, uint256 targetHealthFactorBps) external payable nonReentrant returns (uint256 bidId, address vault) {
		require(opened && !finalized, 'Collateral repair auction is not accepting bids');
		require(portfolio.zoltar().getForkTime(universeId) == 0, 'Collateral repair auction universe forked');
		require(lots != 0 && targetHealthFactorBps >= 10_000, 'Invalid collateral repair auction lots or health target');
		require(msg.value == lots * lotAttoEth, 'Collateral repair auction ETH funding mismatch');
		uint256 required = capital.commitmentIndex().requiredRep(lotAttoEth, openingConservativePrice, capital.securityMultiplierBps(), targetHealthFactorBps);
		require(minimumAttoRepPerLot >= required, 'Auction bid does not meet chosen health target');
		bidId = engine.bidCount() + 1;
		vault = SecurityPoolAuctionVaultClones.create(vaultImplementation, msg.sender, address(capital), address(this), bidId);
		bidIdForVault[vault] = bidId;
		require(engine.submitBid{value: lots * lotAttoEth}(msg.sender, vault, targetHealthFactorBps, lots, minimumAttoRepPerLot) == bidId, 'Auction bid identity mismatch');
		emit WinningVaultCreated(bidId, msg.sender, vault);
	}

	/// @notice Closing never requires a bidder transaction. The quote is tested
	/// at the immutable deadline, so a late closer cannot select a later price.
	function finalize() external nonReentrant returns (SecurityPoolUniformPriceAuction.Clearing memory result) {
		require(msg.sender == forkAuthority, 'Only collateral repair auction fork authority');
		require(!finalized && block.timestamp >= closesAt, 'Collateral repair auction closing unavailable');
		finalized = true;
		if (opened) {
			ICollateralRepairAuctionPriceFeed feed = ICollateralRepairAuctionPriceFeed(portfolio.priceFeed(universeId));
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

	/// @notice The clone address a bidder's bid receives, computable before bidding.
	function vaultFor(address bidder, uint256 bidId) external view returns (address) {
		return
			SecurityPoolAuctionVaultClones.predict(address(this), vaultImplementation, bidder, address(capital), address(this), bidId);
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
	/// @notice Anyone may credit refunds, including a provably losing bid before
	/// closing. Only its bidder may withdraw the freely usable ETH.
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

	function _fundedQuote(ICollateralRepairAuctionPriceFeed feed, uint256 atTime) private view returns (bool) {
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
	/// @notice One vault implementation serves every auction this deployer creates.
	address public immutable vaultImplementation;
	constructor() SecurityPoolCreationCodeDeployer(type(SecurityPoolPortfolioAuction).creationCode) {
		vaultImplementation = address(new SecurityPoolAuctionVault());
	}
	function create(address authority, address portfolio, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address) {
		return _deploy(abi.encode(authority, portfolio, child, close, inventory, shortfall, vaultImplementation));
	}
}
