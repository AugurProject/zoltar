// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolResolutionPremiumBook } from './SecurityPoolResolutionPremiumBook.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { EscalationGame } from './EscalationGame.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { Constants } from '../Constants.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { IERC20 } from '../IERC20.sol';
import { SecurityPoolPortfolioPurchase } from './SecurityPoolPortfolioPurchase.sol';

interface IPortfolioServiceRoot {
	function forkController() external view returns (address);
	function settlement() external view returns (SecurityPoolPortfolioSettlement);
	function capitalLedger(uint248 universeId) external view returns (SecurityPoolCapitalLedger);
	function quoteHelper() external view returns (SecurityPoolPortfolioPurchase);
	function prepareServicePurchase(uint248 universeId, uint256 questionId) external returns (ISecurityPool);
	function executeServiceMint(ISecurityPool pool, address recipient, uint256 minimumShares) external payable returns (uint256);
	function deliverServiceMint(ISecurityPool pool, address recipient, uint256 shares) external;
	function registeredPools(address pool) external view returns (bool);
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
	function logicalTime(uint248 universeId) external view returns (uint48);
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
}

/// @notice Funded maintenance and question-specific prepaid reporting risk.
/// @dev Premium roots copy across forks; no call walks questions or ancestors.
/// Oracle rewards are pull liabilities; neutral premium recoveries pay directly.
contract SecurityPoolPortfolioServices {
	address public immutable portfolio;
	uint256 public immutable maximumOracleRewardAttoEth;
	uint256 public immutable priorityFeeAttoEthPerGas;
	uint256 public constant MAXIMUM_ORACLE_SERVICE_GAS = 8_000_000;
	uint256 public constant ORACLE_SERVICE_INTERVAL = 480;
	mapping(uint248 => uint256) public maintenanceReserveAttoEth;
	SecurityPoolResolutionPremiumBook public immutable premiumLedger;
	uint256 public totalPullCreditsAttoEth;
	bool private entered;
	struct MaintenanceFork {
		uint256 atFork;
		uint256 assigned;
		bool exists;
		bool isSealed;
		bool neutralBurned;
	}
	struct PremiumBranch {
		uint256 maintenance;
		bool created;
	}
	struct Reporter {
		address beneficiary;
		BinaryOutcomes.BinaryOutcome leader;
		bool registered;
		uint256 rewardCapAttoEth;
	}
	mapping(uint248 => MaintenanceFork) public maintenanceForks;
	mapping(uint248 => PremiumBranch) public premiumBranches;
	mapping(uint248 => uint256) public lastOracleRewardAt;
	mapping(address => uint256) public pullCreditsAttoEth;
	mapping(address => Reporter) public reportingBeneficiaries;
	mapping(uint248 => bool) private syncingFees;
	mapping(uint248 => bool) public feesEnabled;

	event MaintenanceFunded(uint248 indexed universeId, uint256 amountAttoEth);
	event OracleServiceReward(uint248 indexed universeId, address indexed sponsor, uint256 amountAttoEth);
	event PremiumFunded(uint248 indexed universeId, uint256 indexed questionId, uint256 amountAttoEth, uint256 units);
	event PremiumRecovered(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 amountAttoEth);
	event ServiceCreditClaimed(address indexed owner, address indexed recipient, uint256 amountAttoEth);
	event UnusedMaintenanceBurned(uint248 indexed universeId, uint256 amountAttoEth);

	constructor(address authority, uint256 maximumReward, uint256 priorityFee) {
		portfolio = authority;
		maximumOracleRewardAttoEth = maximumReward;
		priorityFeeAttoEthPerGas = priorityFee;
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
		uint256 rewardFunding;
		uint256 maintenance;
		(fee, premium, rewardFunding, maintenance) = root.quoteHelper().purchaseQuote(universeId, questionId, cash);
		require(msg.value >= cash + fee, 'Purchase fee exceeds budget');
		require(cash + rewardFunding <= root.quoteHelper().availableMintCapacity(universeId), 'Purchase exceeds healthy capacity');
		minted = root.executeServiceMint{value: cash}(pool, recipient, minimumShares);
		if (rewardFunding != 0) {
			SecurityPoolCapitalLedger capital = root.capitalLedger(universeId);
			capital.setDemand(capital.demandAttoEth() + rewardFunding);
			(, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) = root.settlement().fundQuestionReward{value: rewardFunding}(address(pool), 0, root.logicalTime(universeId));
			_creditSnapshot(universeId, snapshot);
			pool.refreshPortfolioFees();
		}
		if (premium != 0) _fundPremium(universeId, questionId, premium);
		if (maintenance != 0) _fundMaintenance(universeId, maintenance);
		uint256 earnings = fee - premium - rewardFunding - maintenance;
		if (earnings != 0) root.capitalLedger(universeId).fundVestedFees{value: earnings}(0);
		root.deliverServiceMint(pool, recipient, minted);
		_send(trader, msg.value - cash - fee);
	}
	function claimReportingReward(address poolAddress) external onlyPortfolio nonReentrant returns (address recipient) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		uint256 reward;
		(recipient, reward) = quoteReportingReward(poolAddress);
		require(recipient != address(0), 'Question not final');
		ISecurityPool pool = ISecurityPool(payable(poolAddress));
		uint256 beforeRep = IERC20(address(pool.repToken())).balanceOf(address(this));
		root.capitalLedger(pool.universeId()).checkpoint();
		(uint256 cash, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) = root.settlement().claimQuestionReward(poolAddress, address(this), root.logicalTime(pool.universeId()));
		_creditSnapshot(pool.universeId(), snapshot);
		pool.refreshPortfolioFees();
		uint256 paid = recipient == address(this) ? 0 : Math.min(cash, reward);
		_fundMaintenance(pool.universeId(), cash - paid);
		uint256 repIncome = IERC20(address(pool.repToken())).balanceOf(address(this)) - beforeRep;
		if (repIncome != 0) pool.zoltar().burnRep(pool.universeId(), repIncome);
		_send(recipient, paid);
	}
	/// @notice Actual final reporter ETH, or the unused cash routed to maintenance.
	/// @dev Neither ordinary claims nor this funded reward require a new price report.
	function quoteReportingReward(address poolAddress) public view returns (address recipient, uint256 cashAttoEth) {
		IPortfolioServiceRoot root = IPortfolioServiceRoot(portfolio);
		require(root.registeredPools(poolAddress), 'Unknown reward question');
		ISecurityPool pool = ISecurityPool(payable(poolAddress));
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(pool.securityPoolForker()).getQuestionOutcome(pool);
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return (address(0), 0);
		(bool fixedOutcome, ) = root.inheritedFixedOutcome(pool.universeId(), pool.questionId());
		Reporter storage reporter = reportingBeneficiaries[address(pool.escalationGame())];
		recipient =
			!fixedOutcome &&
			reporter.leader == outcome &&
			reporter.beneficiary != address(0) &&
			reporter.rewardCapAttoEth != 0
				? reporter.beneficiary
				: address(this);
		SecurityPoolPortfolioSettlement settlement = root.settlement();
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(pool.universeId()), pool.questionId());
		cashAttoEth = settlement.quoteRedemption(poolAddress, question.rewardShares);
		if (recipient != address(this)) cashAttoEth = Math.min(cashAttoEth, reporter.rewardCapAttoEth);
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
		if (capital.zoltar().getForkTime(universeId) == 0) capital.serveRetirement();
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
		if (!isSealed) {
			if (through < root.capitalLedger(universeId).effectiveTime() && feesEnabled[universeId]) {
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
			if (earned != 0) root.capitalLedger(universeId).creditTimedFees{value: earned}();
			if (unused != 0) _fundMaintenance(universeId, unused);
			(uint256 stale, uint256 remainingUnused) = premiumLedger.checkpoint(universeId, nowTime);
			if (stale + remainingUnused != 0) _fundMaintenance(universeId, stale + remainingUnused);
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
		if (question.outcomeSupplyAttoShares == question.rewardShares) {
			uint256 unused = premiumLedger.cancel(pool.universeId(), pool.questionId());
			if (unused != 0) _fundMaintenance(pool.universeId(), unused);
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
		maintenanceForks[universeId].exists = true;
	}
	function fundMaintenance(uint248 universeId) external payable {
		_fundMaintenance(universeId, msg.value);
	}
	function _fundMaintenance(uint248 universeId, uint256 amount) private {
		require(maintenanceForks[universeId].exists, 'Unknown service universe');
		if (maintenanceForks[universeId].isSealed) {
			_send(Constants.BURN_ADDRESS, amount);
			emit UnusedMaintenanceBurned(universeId, amount);
			return;
		}
		maintenanceReserveAttoEth[universeId] += amount;
		emit MaintenanceFunded(universeId, amount);
	}
	function quoteOracleReward(uint248 universeId, uint256 gasUnits, uint256 gasPrice) public view returns (uint256) {
		uint256 price = Math.min(gasPrice, block.basefee + priorityFeeAttoEthPerGas);
		return
			Math.min(maintenanceReserveAttoEth[universeId], Math.min(maximumOracleRewardAttoEth, Math.min(gasUnits, MAXIMUM_ORACLE_SERVICE_GAS) * price));
	}
	function rewardOracleReport(uint248 universeId, address sponsor, uint256 gasUnits, uint256 requestedAt) external onlyPortfolio {
		uint256 previous = lastOracleRewardAt[universeId];
		if (
			sponsor == address(0) ||
			requestedAt > block.timestamp ||
			(previous != 0 && (requestedAt < previous || block.timestamp < previous + ORACLE_SERVICE_INTERVAL))
		) return;
		SecurityPoolCapitalLedger capital = IPortfolioServiceRoot(portfolio).capitalLedger(universeId);
		(, uint256 commitment) = capital.commitmentIndex().totals();
		if (commitment == 0 && capital.demandAttoEth() == 0) return;
		uint256 amount = quoteOracleReward(universeId, gasUnits, tx.gasprice);
		if (amount == 0) return;
		lastOracleRewardAt[universeId] = block.timestamp;
		maintenanceReserveAttoEth[universeId] -= amount;
		_credit(sponsor, amount);
		emit OracleServiceReward(universeId, sponsor, amount);
	}
	function claimServiceCredit(address recipient) external nonReentrant {
		require(recipient != address(0), 'Invalid service recipient');
		uint256 amount = pullCreditsAttoEth[msg.sender];
		pullCreditsAttoEth[msg.sender] = 0;
		totalPullCreditsAttoEth -= amount;
		_send(recipient, amount);
		emit ServiceCreditClaimed(msg.sender, recipient, amount);
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
		MaintenanceFork storage book = maintenanceForks[source];
		if (book.isSealed) return;
		book.isSealed = true;
		book.atFork = maintenanceReserveAttoEth[source];
	}
	function onPremiumChoice(uint248 source, uint248 child, uint256 branchChosenK, uint256 totalSourceK) external onlyForkController {
		premiumLedger.choose(source, child, branchChosenK, totalSourceK);
		MaintenanceFork storage book = maintenanceForks[source];
		PremiumBranch storage branch = premiumBranches[child];
		uint256 maintenance = Math.mulDiv(book.atFork, branchChosenK, totalSourceK);
		book.assigned += maintenance - branch.maintenance;
		branch.maintenance = maintenance;
	}
	function createPremiumChild(uint248 source, uint248 child) external onlyForkController {
		premiumLedger.createChild(source, child);
		PremiumBranch storage branch = premiumBranches[child];
		branch.created = true;
		maintenanceForks[child].exists = true;
		maintenanceReserveAttoEth[source] -= branch.maintenance;
		maintenanceReserveAttoEth[child] = branch.maintenance;
		(, uint256 questionId, , , ) = IPortfolioServiceRoot(portfolio).capitalLedger(source).zoltar().universes(source);
		premiumLedger.schedule(child, questionId, premiumLedger.minimumFinalAfter(child));
	}
	/// @notice Ownerless maintenance cannot subsidize an unrelated fork branch.
	function burnUnusedMaintenance(uint248 source) external nonReentrant {
		MaintenanceFork storage book = maintenanceForks[source];
		require(book.isSealed && !book.neutralBurned, 'Maintenance recovery unavailable');
		require(block.timestamp >= IPortfolioServiceRoot(portfolio).capitalLedger(source).zoltar().getForkChoiceDeadline(source), 'Fork choices still open');
		book.neutralBurned = true;
		uint256 amount = book.atFork - book.assigned;
		maintenanceReserveAttoEth[source] -= amount;
		_send(Constants.BURN_ADDRESS, amount);
		emit UnusedMaintenanceBurned(source, amount);
	}
	function recoverPremiumCash(uint248 source, uint256 questionId, uint256 shares, address recipient) external onlyForkController returns (uint256 cash) {
		SecurityPoolPortfolioSettlement settlement = IPortfolioServiceRoot(portfolio).settlement();
		(SecurityPoolSettlementBook.Question memory question, ) = settlement.ledger().question(settlement.bookIds(source), questionId);
		cash = premiumLedger.recover(source, questionId, shares, question.outcomeSupplyAttoShares);
		if (recipient == address(this)) {
			_send(Constants.BURN_ADDRESS, cash);
			emit UnusedMaintenanceBurned(source, cash);
		} else _send(recipient, cash);
		emit PremiumRecovered(source, questionId, recipient, cash);
	}
	function registerGame(address game) external onlyPortfolio {
		if (reportingBeneficiaries[game].registered) return;
		// An interrupted parent's reporting work cannot earn one bounty per child.
		// Child rewards need a new local report; unclaimed inherited budgets remain funded.
		(reportingBeneficiaries[game].leader, ) = _leader(game);
		reportingBeneficiaries[game].registered = true;
		reportingBeneficiaries[game].rewardCapAttoEth = type(uint256).max;
	}
	function recordReporter(address game, address reporter) external onlyPortfolio {
		Reporter storage record = reportingBeneficiaries[game];
		require(record.registered && reporter != address(0), 'Invalid reporter service');
		(BinaryOutcomes.BinaryOutcome leader, uint256 margin) = _leader(game);
		if (leader != record.leader) {
			SecurityPoolCapitalLedger capital = IPortfolioServiceRoot(portfolio).capitalLedger(EscalationGame(payable(game)).securityPool().universeId());
			// Even a coalition owning all winner rewards and backing income cannot
			// recover the native 2/5 median-stake burn. A round trip raises that median
			// by at least its temporary leader's margin; min-stake surplus alone is
			// recoverable, so the start bond by itself is not a safe economic bound.
			// Sub-bond deposits only fill the threshold: a return then forces a fork.
			uint256 risk = Math.min(EscalationGame(payable(game)).startBondAttoRep(), margin) / 5;
			uint256 cap = capital.isPriceValid() ? Math.mulDiv(risk, 1 ether, capital.conservativePrice()) : 0;
			record.rewardCapAttoEth = Math.min(record.rewardCapAttoEth, cap);
			record.leader = leader;
			record.beneficiary = leader == BinaryOutcomes.BinaryOutcome.None ? address(0) : reporter;
		}
	}
	function _leader(address game) private view returns (BinaryOutcomes.BinaryOutcome leader, uint256 margin) {
		uint256[3] memory balances = EscalationGame(payable(game)).getOutcomeBalancesAttoRep();
		uint256 highest;
		uint256 second;
		leader = BinaryOutcomes.BinaryOutcome.None;
		for (uint8 i; i < 3; i++) {
			if (balances[i] > highest) {
				second = highest;
				highest = balances[i];
				leader = BinaryOutcomes.BinaryOutcome(i);
			} else {
				second = Math.max(second, balances[i]);
				if (balances[i] == highest) leader = BinaryOutcomes.BinaryOutcome.None;
			}
		}
		unchecked {
			margin = highest - second;
		}
	}
	function _credit(address recipient, uint256 amount) private {
		pullCreditsAttoEth[recipient] += amount;
		totalPullCreditsAttoEth += amount;
	}
	function _send(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = recipient.call{value: amount}('');
		require(sent, 'Service ETH transfer failed');
	}
}
