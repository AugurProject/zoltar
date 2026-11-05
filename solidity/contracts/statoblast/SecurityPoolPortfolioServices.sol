// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolResolutionPremiumBook } from './SecurityPoolResolutionPremiumBook.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { IPortfolioServiceRoot } from './interfaces/IPortfolioServiceRoot.sol';

/// @notice Question-specific prepaid resolution risk compensation.
/// @dev Premium roots copy across forks; no call walks questions or ancestors.
/// No shared pot pays keepers or price sponsors. ETH whose payer is not
/// recorded, or that would otherwise accrue to no one, is burned.
contract SecurityPoolPortfolioServices {
	address public immutable portfolio;
	SecurityPoolResolutionPremiumBook public immutable premiumLedger;
	bool private entered;
	mapping(uint248 => bool) public premiumChildCreated;
	mapping(uint248 => bool) private syncingFees;
	mapping(uint248 => bool) public feesEnabled;

	event PremiumFunded(uint248 indexed universeId, uint256 indexed questionId, uint256 amountAttoEth, uint256 units);
	event PremiumRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 amountAttoEth);
	event UnusedServiceCashBurned(uint248 indexed universeId, uint256 amountAttoEth);

	constructor(address authority) {
		portfolio = authority;
		premiumLedger = new SecurityPoolResolutionPremiumBook(address(this));
	}
	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only service portfolio');
		_;
	}
	modifier onlyForkController() {
		require(msg.sender == IPortfolioServiceRoot(portfolio).forkController(), 'Only service fork controller');
		_;
	}
	modifier nonReentrant() {
		require(!entered, 'Service operation active');
		entered = true;
		_;
		entered = false;
	}
	receive() external payable {
		require(msg.sender == address(IPortfolioServiceRoot(portfolio).settlement()), 'Unexpected service ETH');
	}
	function purchase(address trader, uint248 universeId, uint256 questionId, uint256 cash, address recipient, uint256 minimumShares) external payable onlyPortfolio nonReentrant returns (uint256 minted, uint256 fee) {
		require(cash != 0, 'Purchase amount zero');
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		ISecurityPool pool = root.prepareServicePurchase(universeId, questionId);
		uint256 premium;
		(fee, premium) = root.quoteHelper().purchaseQuote(universeId, questionId, cash);
		require(msg.value >= cash + fee, 'Purchase fee exceeds budget');
		require(cash <= root.quoteHelper().availableMintCapacity(universeId), 'Purchase exceeds healthy capacity');
		minted = root.executeServiceMint{value: cash}(pool, recipient, minimumShares);
		if (premium != 0) _fundPremium(universeId, questionId, premium);
		uint256 earnings = fee - premium;
		if (earnings != 0) root.capitalLedger(universeId).fundVestedFees{value: earnings}(0);
		root.deliverServiceMint(pool, recipient, minted);
		_send(trader, msg.value - cash - fee);
	}
	function mintQuestionSettlement(ISecurityPool pool) external payable onlyPortfolio returns (uint256, uint256, uint256) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.setDemand(capital.demandAttoEth() + msg.value);
		(uint256 minted, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) = root.settlement().mint{value: msg.value}(address(pool), 0, root.logicalTime(universeId));
		_creditSnapshot(universeId, snapshot);
		return (minted, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function redeemQuestionSettlement(ISecurityPool pool, address recipient, uint256 shares) external onlyPortfolio nonReentrant returns (uint256, uint256, uint256) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.checkpoint();
		(uint256 paid, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) = root.settlement().redeem(address(pool), recipient, shares, 0, root.logicalTime(universeId));
		_creditSnapshot(universeId, snapshot);
		_cancelUnusedPremium(pool);
		if (capital.zoltar().getForkTime(universeId) == 0) capital.serveRetirement(0);
		return (paid, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function checkpointQuestionSettlement(ISecurityPool pool, bool refresh) external onlyPortfolio returns (uint256, uint256, uint48) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		SecurityPoolPortfolioSettlement settlement = root.settlement();
		capital.checkpoint();
		uint48 timestamp = root.logicalTime(universeId);
		SecurityPoolPortfolioSettlement.Snapshot memory snapshot;
		if (!refresh || capital.zoltar().getForkTime(universeId) != 0 || settlement.isQuestionFrozen(address(pool)))
			snapshot = settlement.checkpointQuestion(address(pool), timestamp);
		else {
			(uint96 rate, uint48 end) = root.quoteHelper().feeStream(pool, timestamp);
			snapshot = settlement.replaceFeeStream(address(pool), rate, end, timestamp);
		}
		_creditSnapshot(universeId, snapshot);
		return (snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth, snapshot.timestamp);
	}
	function activateFees(uint248 universeId) external onlyPortfolio {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		(uint256 fees, uint256 demand) = root.settlement().setFeesEnabled(universeId, true, root.logicalTime(universeId));
		feesEnabled[universeId] = true;
		_creditUniverse(universeId, fees, demand);
	}
	function checkpointCapitalFees(uint248 universeId, uint48 through) external onlyPortfolio {
		if (syncingFees[universeId]) return;
		syncingFees[universeId] = true;
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		SecurityPoolPortfolioSettlement settlement = root.settlement();
		(, , , uint48 previous, bool isSealed) = settlement.ledger().totals(settlement.bookIds(universeId));
		uint48 nowTime = root.logicalTime(universeId);
		uint48 earnedThrough = uint48(Math.min(nowTime, root.logicalTimeForNative(universeId, through)));
		// A universe's ledger is bound once at preparation; one read serves the checkpoint.
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		if (!isSealed) {
			if (through < capital.effectiveTime() && feesEnabled[universeId]) {
				(uint256 stoppedFees, uint256 stoppedDemand) = settlement.setFeesEnabled(universeId, false, uint48(Math.max(previous, earnedThrough)));
				feesEnabled[universeId] = false;
				_creditUniverse(universeId, stoppedFees, stoppedDemand);
			}
			(uint256 fees, uint256 demand) = settlement.checkpointUniverse(universeId, nowTime);
			_creditUniverse(universeId, fees, demand);
		}
		(, , uint48 premiumTime, bool premiumSealed) = premiumLedger.totals(universeId);
		if (!premiumSealed) {
			(uint256 earned, uint256 unused) = premiumLedger.checkpoint(universeId, uint48(Math.max(premiumTime, earnedThrough)));
			if (earned != 0) capital.creditTimedFees{value: earned}();
			// Premium paid for unhealthy or stale time belongs to no current
			// underwriter, and the book does not record which buyer paid it.
			(uint256 stale, uint256 remainingUnused) = premiumLedger.checkpoint(universeId, nowTime);
			_burn(universeId, unused + stale + remainingUnused);
		}
		syncingFees[universeId] = false;
	}
	function onQuestionFinalityChanged(ISecurityPool pool, uint48 nativeFinalAfter) external onlyPortfolio {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		uint248 universeId = pool.universeId();
		root.capitalLedger(universeId).checkpoint();
		uint48 finalAfter = nativeFinalAfter == 0 ? 0 : root.logicalTimeForNative(universeId, nativeFinalAfter);
		_creditSnapshot(universeId, root.settlement().scheduleFinality(address(pool), finalAfter, root.logicalTime(universeId)));
		premiumLedger.schedule(universeId, pool.questionId(), finalAfter);
	}
	function cancelUnusedPremium(ISecurityPool pool) external onlyPortfolio {
		_cancelUnusedPremium(pool);
	}
	function _cancelUnusedPremium(ISecurityPool pool) private {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		(SecurityPoolSettlementBook.Question memory question, ) = root.settlement().ledger().question(root.settlement().bookIds(pool.universeId()), pool.questionId());
		if (question.outcomeSupplyAttoShares == 0) {
			uint256 unused = premiumLedger.cancel(pool.universeId(), pool.questionId());
			_burn(pool.universeId(), unused);
		}
	}
	function _creditSnapshot(uint248 universeId, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) private {
		_creditUniverse(universeId, snapshot.earnedFeesAttoEth, snapshot.demandAttoEth);
	}
	function _creditUniverse(uint248 universeId, uint256 fees, uint256 demand) private {
		SecurityPoolCapitalLedger capital = IPortfolioServiceRoot(portfolio).capitalLedger(universeId);
		if (fees != 0) capital.creditTimedFees{value: fees}();
		capital.synchronizeDemand(demand);
	}
	function registerUniverse(uint248 universeId) external onlyPortfolio {
		premiumLedger.register(universeId, uint48(block.timestamp));
	}
	function _fundPremium(uint248 universeId, uint256 questionId, uint256 amount) private {
		uint256 units = premiumLedger.fund(universeId, questionId, amount);
		emit PremiumFunded(universeId, questionId, amount, units);
	}
	function questionPremium(uint248 universeId, uint256 questionId) external view returns (uint256 units, uint256 cash) {
		return premiumLedger.question(universeId, questionId);
	}
	function freezePremiumUniverse(uint248 source) external onlyForkController {
		premiumLedger.freeze(source);
	}
	function onPremiumChoice(uint248 source, uint248 child, uint256 branchChosenK, uint256 totalSourceK) external onlyForkController {
		premiumLedger.choose(source, child, branchChosenK, totalSourceK);
	}
	function createPremiumChild(uint248 source, uint248 child) external onlyForkController {
		premiumLedger.createChild(source, child);
		premiumChildCreated[child] = true;
		(, uint256 questionId, , , ) = IPortfolioServiceRoot(portfolio).capitalLedger(source).zoltar().universes(source);
		premiumLedger.schedule(child, questionId, premiumLedger.minimumFinalAfter(child));
	}
	/// @notice Preparation time cannot become retroactive underwriting income.
	/// @dev The child clock follows its fixed native deadline even if activation
	/// is delayed. Burn that elapsed premium before capital becomes operational.
	function checkpointPreparationPremium(uint248 child) external onlyForkController {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		require(premiumChildCreated[child] && root.capitalLedger(child).importing(), 'Premium preparation unavailable');
		(uint256 earned, uint256 unused) = premiumLedger.checkpoint(child, root.logicalTime(child));
		_burn(child, earned + unused);
	}
	function recoverPremiumCash(uint248 source, uint256 questionId, uint256 shares, address recipient) external onlyForkController returns (uint256 cash) {
		SecurityPoolPortfolioSettlement settlement = IPortfolioServiceRoot(portfolio).settlement();
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(source), questionId);
		cash = premiumLedger.recover(source, questionId, shares, question.outcomeSupplyAttoShares);
		_send(recipient, cash);
		emit PremiumRecovered(source, questionId, recipient, cash);
	}

	function _burn(uint248 universeId, uint256 amount) private {
		if (amount == 0) return;
		_send(Constants.BURN_ADDRESS, amount);
		emit UnusedServiceCashBurned(universeId, amount);
	}
	function _send(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = recipient.call{value: amount}('');
		require(sent, 'Service ETH transfer failed');
	}
}
