// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolResolutionPremiumBook } from './SecurityPoolResolutionPremiumBook.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { CheckedCast } from '../CheckedCast.sol';
import { Collateral } from '../Collateral.sol';
import { ICollateralConfig } from './interfaces/ICollateralConfig.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Constants } from '../Constants.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolServiceRoot } from './interfaces/ISecurityPoolServiceRoot.sol';

/// @notice Question-specific prepaid resolution risk compensation.
/// @dev Premium roots copy across forks; no call walks questions or ancestors.
/// No shared pot pays keepers or price sponsors. Collateral whose payer is not
/// recorded, or that would otherwise accrue to no one, is burned.
contract SecurityPoolServices {
	using SafeERC20Ops for IERC20;
	address public immutable securityPool;
	SecurityPoolResolutionPremiumBook public immutable premiumLedger;
	bool private entered;
	// Services alone owns the funded purchase and consumes each callback once.
	struct Purchase {
		address pool;
		address payer;
		uint256 cash;
		uint256 maximumRecoveryAttoRep;
	}
	Purchase private currentPurchase;
	mapping(uint248 => bool) public premiumChildCreated;
	mapping(uint248 => bool) public feesEnabled;
	mapping(address => uint256) public pendingCapitalCash;
	mapping(uint248 => uint256) public pendingBurnCash;

	event PremiumFunded(uint248 indexed universeId, uint256 indexed questionId, uint256 amountAttoEth, uint256 units);
	event PremiumRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 amountAttoEth);
	event UnusedServiceCashBurned(uint248 indexed universeId, uint256 amountAttoEth);

	constructor(address authority) {
		securityPool = authority;
		premiumLedger = new SecurityPoolResolutionPremiumBook(address(this));
	}
	modifier onlySecurityPool() {
		require(msg.sender == securityPool, 'Only service security pool');
		_;
	}
	modifier onlyForkController() {
		require(msg.sender == ISecurityPoolServiceRoot(securityPool).forkController(), 'Only service fork controller');
		_;
	}
	modifier nonReentrant() {
		require(!entered, 'Service operation active');
		entered = true;
		_;
		entered = false;
	}
	function purchase(address trader, uint248 universeId, uint256 questionId, uint256 cash, address recipient, uint256 minimumShares, uint256 maximumFee, uint256 maximumRecoveryAttoRep) external onlySecurityPool nonReentrant returns (uint256 minted, uint256 fee) {
		require(cash != 0, 'Purchase amount zero');
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		IQuestionLedger pool = root.prepareServicePurchase(universeId, questionId);
		root.capitalLedger(universeId).checkpoint();
		uint256 premium;
		(fee, premium) = root.quoteHelper().purchaseQuote(universeId, questionId, cash);
		require(fee <= maximumFee, 'Purchase fee exceeds budget');
		IERC20 collateral = ICollateralConfig(securityPool).collateralToken();
		Collateral.pull(collateral, trader, address(root.settlement()), cash);
		Collateral.pull(collateral, trader, address(this), fee);
		require(cash <= root.quoteHelper().availableMintCapacity(universeId), 'Purchase exceeds healthy capacity');
		require(recipient != address(0) && recipient != address(this), 'Invalid share recipient');
		currentPurchase = Purchase(address(pool), trader, cash, maximumRecoveryAttoRep);
		minted = pool.createCompleteSet(cash, recipient, minimumShares, fee, premium);
		require(currentPurchase.pool == address(0), 'Purchase funding incomplete');
	}
	/// @dev The canonical ledger calls back after its accounting and fee stream are complete,
	/// but before minting shares to an untrusted recipient.
	function completePurchaseFunding(uint256 fee, uint256 premium) external {
		require(msg.sender == currentPurchase.pool && currentPurchase.cash == 0, 'No prepared purchase');
		delete currentPurchase;
		IQuestionLedger pool = IQuestionLedger(payable(msg.sender));
		uint248 universeId = pool.universeId();
		if (premium != 0) _fundPremium(universeId, pool.questionId(), premium);
		uint256 earnings = fee - premium;
		if (earnings != 0) {
			ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
			IERC20 collateral = ICollateralConfig(securityPool).collateralToken();
			collateral.safeApprove(address(root.capitalLedger(universeId)), earnings);
			root.capitalLedger(universeId).fundVestedFees(earnings, 0);
		}
	}

	function mintQuestionSettlement(IQuestionLedger pool, uint256 cash) external onlySecurityPool returns (uint256, uint256, uint256) {
		Purchase memory active = currentPurchase;
		require(address(pool) == active.pool && cash != 0 && cash == active.cash, 'No authorized security pool purchase');
		// Consume mint authorization before calling custody or capital accounting.
		currentPurchase.cash = 0;
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.setDemand(capital.demandAttoEth() + cash);
		(uint256 minted, SecurityPoolSettlement.Snapshot memory snapshot) = root.settlement().mintWithRecoveryRep(address(pool), active.payer, cash, active.maximumRecoveryAttoRep, root.securityPoolTime(universeId));
		_creditSnapshot(universeId, snapshot);
		return (minted, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function redeemQuestionSettlement(IQuestionLedger pool, address recipient, uint256 shares) external onlySecurityPool nonReentrant returns (uint256, uint256, uint256) {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		capital.checkpoint();
		(uint256 paid, SecurityPoolSettlement.Snapshot memory snapshot) = root.settlement().redeem(address(pool), recipient, shares, root.securityPoolTime(universeId));
		_creditSnapshot(universeId, snapshot);
		_cancelUnusedPremium(pool);
		return (paid, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function checkpointQuestionSettlement(IQuestionLedger pool, bool refresh) external onlySecurityPool returns (uint256, uint256, uint48) {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		uint248 universeId = pool.universeId();
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		SecurityPoolSettlement settlement = root.settlement();
		capital.checkpoint();
		uint48 timestamp = root.securityPoolTime(universeId);
		SecurityPoolSettlement.Snapshot memory snapshot;
		if (!refresh || capital.zoltar().getForkTime(universeId) != 0 || settlement.isQuestionScheduled(address(pool)))
			snapshot = settlement.checkpointQuestion(address(pool), timestamp);
		else {
			(uint96 rate, uint48 end) = root.quoteHelper().feeStream(pool);
			snapshot = settlement.replaceFeeStream(address(pool), rate, end, timestamp);
		}
		_creditSnapshot(universeId, snapshot);
		return (snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth, snapshot.timestamp);
	}
	function activateFees(uint248 universeId) external onlySecurityPool {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		(uint256 fees, uint256 demand) = root.settlement().setFeesEnabled(universeId, true, root.securityPoolTime(universeId));
		feesEnabled[universeId] = true;
		_creditUniverse(universeId, fees, demand);
	}
	/// @dev Capital owns checkpoint recursion and calls Services before changing weights.
	function checkpointCapitalFees(uint248 universeId, uint48 through) external {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
		require(msg.sender == address(capital), 'Only universe capital ledger');
		SecurityPoolSettlement settlement = root.settlement();
		(, , , uint48 previous, bool isSealed) = settlement.ledger().totals(settlement.bookIds(universeId));
		uint48 nowTime = root.securityPoolTime(universeId);
		uint48 earnedThrough = uint48(Math.min(nowTime, root.securityPoolTimeForNative(universeId, through)));
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
			(uint256 earned, uint256 unused) = premiumLedger.checkpoint(universeId, uint48(Math.max(premiumTime, capital.acceptedPrice() == 0 ? earnedThrough : nowTime)));
			if (earned != 0) _creditTimedFees(capital, earned);
			// Only income without an accepted underwriting price is unassigned.
			// Stale prices still retain their checkpointed commitment weights.
			(uint256 stale, uint256 remainingUnused) = premiumLedger.checkpoint(universeId, nowTime);
			_burn(universeId, unused + stale + remainingUnused);
		}
	}
	function onQuestionFinalityChanged(IQuestionLedger pool, uint48 nativeFinalAfter) external onlySecurityPool {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		uint248 universeId = pool.universeId();
		root.capitalLedger(universeId).checkpoint();
		uint48 finalAfter = nativeFinalAfter == 0 ? 0 : root.securityPoolTimeForNative(universeId, nativeFinalAfter);
		_creditSnapshot(universeId, root.settlement().scheduleFinality(address(pool), finalAfter, root.securityPoolTime(universeId)));
		premiumLedger.schedule(universeId, pool.questionId(), finalAfter);
	}

	function _cancelUnusedPremium(IQuestionLedger pool) private {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		(SecurityPoolSettlementBook.Question memory question, ) = root.settlement().ledger().question(root.settlement().bookIds(pool.universeId()), pool.questionId());
		if (question.outcomeSupplyAttoShares == 0) {
			uint256 unused = premiumLedger.cancel(pool.universeId(), pool.questionId());
			_burn(pool.universeId(), unused);
		}
	}
	function _creditSnapshot(uint248 universeId, SecurityPoolSettlement.Snapshot memory snapshot) private {
		_creditUniverse(universeId, snapshot.earnedFeesAttoEth, snapshot.demandAttoEth);
	}
	function _creditUniverse(uint248 universeId, uint256 fees, uint256 demand) private {
		SecurityPoolCapitalLedger capital = ISecurityPoolServiceRoot(securityPool).capitalLedger(universeId);
		if (fees != 0) _creditTimedFees(capital, fees);
		capital.synchronizeDemand(demand);
	}
	function registerUniverse(uint248 universeId) external onlySecurityPool {
		premiumLedger.register(universeId, CheckedCast.toUint48(block.timestamp));
	}
	function _fundPremium(uint248 universeId, uint256 questionId, uint256 amount) private {
		uint256 units = premiumLedger.fund(universeId, questionId, amount);
		emit PremiumFunded(universeId, questionId, amount, units);
	}
	function freezePremiumUniverse(uint248 source) external onlyForkController {
		premiumLedger.freeze(source);
	}
	function onPremiumChoice(uint248 source, uint248 child, uint256 branchChosenK, uint256 totalSourceK) external onlyForkController {
		premiumLedger.choose(source, child, branchChosenK, totalSourceK);
	}
	function createPremiumChild(uint248 source, uint248 child) external onlyForkController {
		_burn(child, premiumLedger.createChild(source, child));
		premiumChildCreated[child] = true;
		(, uint256 questionId, , , ) = ISecurityPoolServiceRoot(securityPool).capitalLedger(source).zoltar().universes(source);
		premiumLedger.schedule(child, questionId, premiumLedger.minimumFinalAfter(child) + Constants.FORK_RESPONSE_DELAY);
	}
	/// @notice Preparation time cannot become retroactive underwriting income.
	/// @dev The child reporting clock remains paused until branch activation.
	/// Checkpoint inherited accounting before capital becomes operational.
	function checkpointPreparationPremium(uint248 child) external onlyForkController {
		ISecurityPoolServiceRoot root = ISecurityPoolServiceRoot(securityPool);
		require(premiumChildCreated[child] && root.capitalLedger(child).importing(), 'Premium preparation unavailable');
		(uint256 earned, uint256 unused) = premiumLedger.checkpoint(child, root.securityPoolTime(child));
		_burn(child, earned + unused);
	}
	function recoverPremiumCash(uint248 source, uint256 questionId, uint256 shares, address recipient) external onlyForkController returns (uint256 cash) {
		SecurityPoolSettlement settlement = ISecurityPoolServiceRoot(securityPool).settlement();
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(source), questionId);
		cash = premiumLedger.recover(source, questionId, shares, question.outcomeSupplyAttoShares);
		_send(recipient, cash);
		emit PremiumRecovered(source, questionId, recipient, cash);
	}

	function _creditTimedFees(SecurityPoolCapitalLedger capital, uint256 amount) private {
		pendingCapitalCash[address(capital)] += amount;
		capital.creditDeferredTimedFees(amount);
	}

	function _burn(uint248 universeId, uint256 amount) private {
		if (amount == 0) return;
		pendingBurnCash[universeId] += amount;
	}
	/// @notice Pay only income already assigned to the calling capital ledger.
	function withdrawCapitalCash() external nonReentrant {
		uint256 amount = pendingCapitalCash[msg.sender];
		require(amount != 0, 'No assigned capital cash');
		pendingCapitalCash[msg.sender] = 0;
		ISecurityPoolServiceRoot(securityPool).settlement().withdrawServiceFees();
		_send(msg.sender, amount);
	}
	/// @notice A failing collateral burn cannot block accounting or REP actions.
	function flushBurn(uint248 universeId) external nonReentrant {
		uint256 amount = pendingBurnCash[universeId];
		pendingBurnCash[universeId] = 0;
		if (amount == 0) return;
		ISecurityPoolServiceRoot(securityPool).settlement().withdrawServiceFees();
		_send(Constants.BURN_ADDRESS, amount);
		emit UnusedServiceCashBurned(universeId, amount);
	}

	function _send(address recipient, uint256 amount) private {
		if (amount == 0) return;
		Collateral.send(ICollateralConfig(securityPool).collateralToken(), recipient, amount);
	}
}
