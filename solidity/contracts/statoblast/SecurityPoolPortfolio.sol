// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger, ICapitalFeeStreams } from './SecurityPoolCapitalLedger.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolPortfolioPurchase } from './SecurityPoolPortfolioPurchase.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import {
	SecurityPoolCapitalLedgerDeployer,
	SecurityPoolCommitmentIndexDeployer,
	SecurityPoolCapitalFeeStreamsDeployer,
	SecurityPoolSettlementBookDeployer,
	SecurityPoolPortfolioSettlementDeployer,
	SecurityPoolReporterLedgerDeployer
} from './SecurityPoolPortfolioModuleDeployers.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

interface IPortfolioForkCoordinator {
	function initialize(uint248 origin) external;
	function activateOrigin(uint248 origin) external;
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
	function isReady(uint248 universeId) external view returns (bool);
	function logicalTime(uint248 universeId) external view returns (uint48);
	function forkLogicalTime(uint248 universeId) external view returns (uint48);
	function nativeTimeForLogical(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function ensureReady(uint248 universeId) external;
	function freeze(uint248 universeId) external;
	function recapitalizeUniverse(uint248 universeId) external payable;
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
}
interface IPortfolioForkCoordinatorDeployer {
	function create(address authority, Zoltar zoltar) external returns (address);
}
interface IPortfolioReporterIdentity {
	function securityPool() external view returns (ISecurityPool);
}

/// @notice Shared REP custody and aggregate settlement with personal vault commitments.
contract SecurityPoolPortfolio is IPortfolioSettlement {
	using SafeERC20Ops for IERC20;
	struct EconomicsConfig {
		uint256 purchaseFeeBps;
		uint256 annualFeeBps;
		uint256 minimumPurchaseFeeAttoEth;
		uint256 minimumCommitmentAttoEth;
		uint256 minimumExecutionReserveAttoEth;
		uint256 minimumOutcomeRate;
		uint48 rewardVestingSeconds;
	}
	struct Deployers {
		SecurityPoolCapitalLedgerDeployer capital;
		SecurityPoolCommitmentIndexDeployer commitments;
		SecurityPoolCapitalFeeStreamsDeployer fees;
		SecurityPoolSettlementBookDeployer books;
		SecurityPoolPortfolioSettlementDeployer settlement;
		SecurityPoolReporterLedgerDeployer reporters;
		IPortfolioForkCoordinatorDeployer forks;
	}
	ISecurityPoolFactory public immutable factory;
	ISecurityPool public immutable seedPool;
	Zoltar public immutable zoltar;
	uint248 public immutable originUniverseId;
	ISecurityPoolQuestionAdmissionPolicy public immutable questionAdmissionPolicy;
	uint256 public immutable statoblastSecurityMultiplierBps;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	uint256 public immutable purchaseFeeBps;
	uint256 public immutable annualFeeBps;
	uint256 public immutable minimumPurchaseFeeAttoEth;
	uint256 public immutable minimumCommitmentAttoEth;
	uint256 public immutable minimumExecutionReserveAttoEth;
	uint256 public immutable minimumOutcomeRate;
	uint48 public immutable rewardVestingSeconds;
	SecurityPoolPortfolioPurchase public immutable quoteHelper;
	SecurityPoolPortfolioSettlement public settlement;
	SecurityPoolReporterLedger public reporters;
	address public forkController;
	uint8 public setupStage;
	Deployers private deployers;
	mapping(uint248 => SecurityPoolCapitalLedger) public capitalLedger;
	mapping(address => bool) private capitalAddresses;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => bool) public registeredPools;
	mapping(uint248 => bool) private syncingFees;
	mapping(uint248 => bool) public feesEnabled;
	uint256[] private questions;
	bool private entered;
	address private purchasingPool;

	event QuestionRegistered(uint256 indexed questionId, bytes32 indexed originId, ISecurityPool indexed pool);
	event CompleteSetsFunded(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 cashAttoEth, uint256 shares, uint256 purchaseFeeAttoEth);
	event UniversePrepared(uint248 indexed universeId, address capitalLedger);
	event SetupAdvanced(uint8 stage);

	constructor(ISecurityPoolFactory _factory, ISecurityPool seed, uint256 horizon, Deployers memory deployment, ISecurityPoolQuestionAdmissionPolicy admission, EconomicsConfig memory config) {
		require(address(admission).code.length != 0, 'Admission policy has no code');
		require(config.purchaseFeeBps <= 10_000 && config.annualFeeBps <= 10_000 && config.minimumCommitmentAttoEth > 0 && config.minimumExecutionReserveAttoEth > 0, 'Invalid portfolio economics');
		require(config.minimumOutcomeRate > 0 && config.minimumOutcomeRate <= 1e18, 'Invalid minimum exchange rate');
		require(address(deployment.capital).code.length != 0 && address(deployment.commitments).code.length != 0 && address(deployment.fees).code.length != 0 && address(deployment.books).code.length != 0 && address(deployment.settlement).code.length != 0 && address(deployment.reporters).code.length != 0 && address(deployment.forks).code.length != 0, 'Portfolio deployer has no code');
		require(config.rewardVestingSeconds > 0 && horizon > 0 && horizon <= type(uint48).max, 'Invalid portfolio duration');
		require(address(seed.parent()) == address(0) && address(seed.securityPoolFactory()) == address(_factory), 'Invalid portfolio seed');
		bytes32 origin = _factory.getSecurityPoolOriginId(seed);
		require(address(_factory.getSecurityPool(origin, seed.universeId())) == address(seed), 'Seed is not canonical');
		factory = _factory;
		seedPool = seed;
		zoltar = seed.zoltar();
		originUniverseId = seed.universeId();
		questionAdmissionPolicy = admission;
		maximumQuestionHorizonSeconds = horizon;
		statoblastSecurityMultiplierBps = seed.statoblastSecurityMultiplierBps();
		initialReportPriorityFeeAttoEthPerGas = seed.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		purchaseFeeBps = config.purchaseFeeBps;
		annualFeeBps = config.annualFeeBps;
		minimumPurchaseFeeAttoEth = config.minimumPurchaseFeeAttoEth;
		minimumCommitmentAttoEth = config.minimumCommitmentAttoEth;
		minimumExecutionReserveAttoEth = config.minimumExecutionReserveAttoEth;
		minimumOutcomeRate = config.minimumOutcomeRate;
		rewardVestingSeconds = config.rewardVestingSeconds;
		deployers = deployment;
		quoteHelper = new SecurityPoolPortfolioPurchase(address(this));
	}

	modifier nonReentrant() {
		require(!entered, 'Portfolio operation active');
		entered = true;
		_;
		entered = false;
	}
	modifier onlyForkController() {
		require(msg.sender == forkController, 'Only fork coordinator');
		_;
	}
	/// @notice Advance one fixed setup stage without exceeding the transaction gas limit.
	/// No caller can change the constructor configuration or replace an existing module.
	function prepareNext() external nonReentrant {
		if (setupStage == 3) return;
		require(zoltar.getForkTime(originUniverseId) == 0, 'Origin universe forked');
		if (setupStage == 0) {
			settlement = deployers.settlement.create(address(this));
			settlement.initialize(deployers.books.create(address(settlement), minimumOutcomeRate));
			settlement.registerUniverse(originUniverseId, uint48(block.timestamp));
			settlement.setFeesEnabled(originUniverseId, false, uint48(block.timestamp));
		} else if (setupStage == 1) {
			reporters = deployers.reporters.create(address(this), zoltar);
			reporters.registerUniverse(originUniverseId);
			forkController = deployers.forks.create(address(this), zoltar);
			IPortfolioForkCoordinator(forkController).initialize(originUniverseId);
		} else {
			_createCapital(originUniverseId);
			factory.initializePortfolioPriceFeed(seedPool);
			IPortfolioForkCoordinator(forkController).activateOrigin(originUniverseId);
		}
		setupStage++;
		emit SetupAdvanced(setupStage);
	}
	receive() external payable {
		require(msg.sender == address(settlement) || msg.sender == forkController || capitalAddresses[msg.sender], 'Unexpected portfolio ETH');
	}
	function reporterLedger(uint248) external view returns (address) {
		return address(reporters);
	}
	function questionCount() external view returns (uint256) {
		return questions.length;
	}
	function getQuestions(uint256 start, uint256 count) external view returns (uint256[] memory page) {
		require(start <= questions.length, 'Invalid question page');
		count = Math.min(count, questions.length - start);
		page = new uint256[](count);
		for (uint256 i; i < count; i++) page[i] = questions[start + i];
	}
	function getPool(uint256 questionId, uint248 universeId) public view returns (ISecurityPool pool) {
		bytes32 origin = questionOriginIds[questionId];
		require(origin != bytes32(0), 'Question not registered');
		pool = factory.getSecurityPool(origin, universeId);
		require(address(pool) != address(0), 'Question pool unavailable');
	}
	function priceFeed(uint248 universeId) external view returns (address) {
		return factory.sharedPriceFeeds(address(this), universeId);
	}
	function oracleExposure(uint248 universeId) external view returns (uint256) {
		(, uint256 commitment, ) = capitalLedger[universeId].totals();
		return Math.max(commitment, capitalLedger[universeId].demandAttoEth());
	}
	function availableMintCapacity(uint248 universeId) external view returns (uint256) {
		return quoteHelper.availableMintCapacity(universeId);
	}
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool) {
		return IPortfolioForkCoordinator(forkController).clocks(universeId);
	}
	function logicalTime(uint248 universeId) public view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).logicalTime(universeId);
	}
	function _logicalAt(uint248 universeId, uint256 wallTime) private view returns (uint48) {
		require(wallTime <= type(uint48).max, 'Native clock exhausted');
		return IPortfolioForkCoordinator(forkController).logicalTimeForNative(universeId, uint48(wallTime));
	}
	function forkLogicalTime(uint248 universeId) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).forkLogicalTime(universeId);
	}
	function nativeTimeForLogical(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).nativeTimeForLogical(universeId, timestamp);
	}
	function logicalTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).logicalTimeForNative(universeId, timestamp);
	}
	function sourceGame(uint248 universeId, uint256 questionId) external view returns (address) {
		(SecurityPoolReporterLedger.Question memory question, ) = reporters.question(universeId, questionId);
		return question.sourceGame;
	}
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool fixedOutcome, uint256 outcome) {
		return IPortfolioForkCoordinator(forkController).inheritedFixedOutcome(universeId, questionId);
	}
	function prepareForkChild(uint248 parent, uint256 outcome) external onlyForkController returns (SecurityPoolCapitalLedger capital) {
		uint248 child = zoltar.getChildUniverseId(parent, outcome);
		require(address(capitalLedger[child]) == address(0), 'Child already prepared');
		if (address(zoltar.getRepToken(child)) == address(0)) zoltar.deployChild(parent, outcome);
		capital = _createCapital(child);
		capital.beginForkImport();
	}
	function activateForkChild(uint248 child) external onlyForkController {
		factory.initializePortfolioPriceFeedForUniverse(seedPool, child);
	}
	function creditForkFees(uint248 universeId, uint256 amount) external onlyForkController {
		if (amount != 0) capitalLedger[universeId].creditTimedFees{value: amount}();
	}
	function addQuestion(uint256 questionId) public returns (ISecurityPool pool) {
		require(setupStage == 3, 'Portfolio setup incomplete');
		require(questionAdmissionPolicy.isQuestionAllowed(address(this), originUniverseId, questionId), 'Question rejected by admission policy');
		bytes32 origin = questionOriginIds[questionId];
		if (origin != bytes32(0)) return factory.getSecurityPool(origin, originUniverseId);
		require(zoltar.getForkTime(originUniverseId) == 0, 'Origin universe forked');
		origin = factory.getPortfolioOriginId(address(this), originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		pool = factory.deployPortfolioSecurityPool(originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		uint256 end = pool.questionData().getQuestionEndDate(questionId);
		require(end > block.timestamp && end - block.timestamp <= maximumQuestionHorizonSeconds, 'Question outside portfolio horizon');
		questionOriginIds[questionId] = origin;
		questions.push(questionId);
		_registerPool(pool);
		emit QuestionRegistered(questionId, origin, pool);
	}
	function _registerPool(ISecurityPool pool) private {
		require(factory.getSecurityPoolPortfolio(pool) == address(this), 'Pool belongs to another portfolio');
		require(address(getPool(pool.questionId(), pool.universeId())) == address(pool), 'Pool is not canonical');
		if (registeredPools[address(pool)]) return;
		registeredPools[address(pool)] = true;
		settlement.registerQuestion(address(pool), pool.universeId(), pool.questionId());
		pool.setPortfolioCustody(address(capitalLedger[pool.universeId()]));
	}
	function registerChildPool(ISecurityPool pool) external {
		IPortfolioForkCoordinator(forkController).ensureReady(pool.universeId());
		require(IPortfolioForkCoordinator(forkController).isReady(pool.universeId()), 'Child settlement not ready');
		_registerPool(pool);
	}
	function prepareQuestionUniverse(uint248 universeId) external {
		IPortfolioForkCoordinator(forkController).ensureReady(universeId);
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Child settlement not ready');
	}
	function _pool(address caller) private view returns (ISecurityPool pool) {
		require(registeredPools[caller], 'Unknown question callback');
		return ISecurityPool(payable(caller));
	}
	function purchaseFee(uint256 mintAttoEth) public view returns (uint256) {
		return quoteHelper.purchaseFee(mintAttoEth);
	}
	function createCompleteSet(uint248 universeId, uint256 questionId, uint256 mintAttoEth, address recipient, uint256 minimumShares) external payable nonReentrant returns (uint256 minted) {
		require(setupStage == 3, 'Portfolio setup incomplete');
		require(mintAttoEth > 0, 'Purchase amount zero');
		IPortfolioForkCoordinator(forkController).ensureReady(universeId);
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Universe is not ready');
		if (universeId != originUniverseId)
			require(questionAdmissionPolicy.isQuestionAllowed(address(this), originUniverseId, questionId), 'Question rejected by admission policy');
		ISecurityPool pool = universeId == originUniverseId ? addQuestion(questionId) : getPool(questionId, universeId);
		uint256 fee = purchaseFee(mintAttoEth);
		require(msg.value >= mintAttoEth + fee, 'Purchase fee exceeds budget');
		SecurityPoolCapitalLedger capital = capitalLedger[universeId];
		capital.checkpoint();
		purchasingPool = address(pool);
		minted = quoteHelper.buyCompleteSets{value: mintAttoEth}(pool, recipient, minimumShares);
		purchasingPool = address(0);
		if (fee != 0) capital.fundVestedFees{value: fee}(0);
		uint256 refund = msg.value - mintAttoEth - fee;
		if (refund != 0) {
			(bool sent, ) = msg.sender.call{value: refund}('');
			require(sent, 'Purchase refund failed');
		}
		emit CompleteSetsFunded(universeId, questionId, recipient, mintAttoEth, minted, fee);
	}
	/// @notice Donate cash to existing outcome claims. No shares or repayment right are created.
	/// Queued retirement takes priority over the additional backing needed by this donation.
	function recapitalizeUniverse(uint248 universeId) external payable nonReentrant {
		require(setupStage == 3, 'Portfolio setup incomplete');
		IPortfolioForkCoordinator(forkController).recapitalizeUniverse{value: msg.value}(universeId);
	}
	function mintQuestionSettlement()
		external
		payable
		returns (uint256 mintedShares, uint256 totalEconomicShares, uint256 questionCashAttoEth)
	{
		ISecurityPool pool = _pool(msg.sender);
		require(entered && purchasingPool == msg.sender, 'No authorized portfolio purchase');
		SecurityPoolCapitalLedger capital = capitalLedger[pool.universeId()];
		capital.setDemand(capital.demandAttoEth() + msg.value);
		SecurityPoolPortfolioSettlement.Snapshot memory snapshot;
		(mintedShares, snapshot) = settlement.mint{value: msg.value}(msg.sender, 0, logicalTime(pool.universeId()));
		_creditSnapshot(pool.universeId(), snapshot);
		return (mintedShares, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function redeemQuestionSettlement(address recipient, uint256 burnedShares) external returns (uint256 paidCashAttoEth, uint256 totalEconomicShares, uint256 questionCashAttoEth) {
		ISecurityPool pool = _pool(msg.sender);
		capitalLedger[pool.universeId()].checkpoint();
		SecurityPoolPortfolioSettlement.Snapshot memory snapshot;
		(paidCashAttoEth, snapshot) = settlement.redeem(msg.sender, recipient, burnedShares, 0, logicalTime(pool.universeId()));
		_creditSnapshot(pool.universeId(), snapshot);
		if (zoltar.getForkTime(pool.universeId()) == 0) capitalLedger[pool.universeId()].serveRetirement();
		return (paidCashAttoEth, snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth);
	}
	function checkpointQuestionSettlement()
		external
		returns (uint256 totalEconomicShares, uint256 questionCashAttoEth, uint48 timestamp)
	{
		ISecurityPool pool = _pool(msg.sender);
		capitalLedger[pool.universeId()].checkpoint();
		SecurityPoolPortfolioSettlement.Snapshot memory snapshot = settlement.checkpointQuestion(msg.sender, logicalTime(pool.universeId()));
		_creditSnapshot(pool.universeId(), snapshot);
		return (snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth, snapshot.timestamp);
	}
	function refreshQuestionSettlement()
		external
		returns (uint256 totalEconomicShares, uint256 questionCashAttoEth, uint48 timestamp)
	{
		ISecurityPool pool = _pool(msg.sender);
		uint248 universeId = pool.universeId();
		capitalLedger[universeId].checkpoint();
		if (zoltar.getForkTime(universeId) != 0) {
			SecurityPoolPortfolioSettlement.Snapshot memory frozenSnapshot = settlement.checkpointQuestion(msg.sender, logicalTime(universeId));
			_creditSnapshot(universeId, frozenSnapshot);
			return (
				frozenSnapshot.outcomeSupplyAttoShares,
				frozenSnapshot.questionCashAttoEth,
				frozenSnapshot.timestamp
			);
		}
		uint48 nowTime = logicalTime(universeId);
		(uint96 rate, uint48 stop) = quoteHelper.feeStream(pool, nowTime);
		SecurityPoolPortfolioSettlement.Snapshot memory snapshot = settlement.replaceFeeStream(msg.sender, rate, stop, nowTime);
		_creditSnapshot(universeId, snapshot);
		return (snapshot.outcomeSupplyAttoShares, snapshot.questionCashAttoEth, snapshot.timestamp);
	}
	function quoteQuestionSettlement(address pool, uint256 shares) external view returns (uint256) {
		_pool(pool);
		return settlement.quoteRedemption(pool, shares);
	}
	function quoteQuestionMint(address pool, uint256 cash) external view returns (uint256) {
		_pool(pool);
		return settlement.quoteMint(pool, cash);
	}
	function _creditSnapshot(uint248 universeId, SecurityPoolPortfolioSettlement.Snapshot memory snapshot) private {
		_creditUniverse(universeId, snapshot.earnedFeesAttoEth, snapshot.demandAttoEth);
	}
	function onSharedPriceAccepted(uint248 universeId, uint256 price, uint48 validUntil) external {
		require(msg.sender == factory.sharedPriceFeeds(address(this), universeId), 'Only canonical shared feed');
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Universe is not active');
		capitalLedger[universeId].acceptPrice(price, validUntil);
		(uint256 fees, uint256 demand) = settlement.setFeesEnabled(universeId, true, logicalTime(universeId));
		feesEnabled[universeId] = true;
		_creditUniverse(universeId, fees, demand);
	}
	function checkpointCapitalFees(uint248 universeId, uint48 through) external {
		require(msg.sender == address(capitalLedger[universeId]), 'Only universe capital ledger');
		if (syncingFees[universeId]) return;
		syncingFees[universeId] = true;
		uint64 bookId = settlement.bookIds(universeId);
		(, , , uint48 previous, bool isSealed) = settlement.ledger().totals(bookId);
		if (!isSealed) {
			uint48 nowTime = logicalTime(universeId);
			uint48 earnedThrough = uint48(Math.max(previous, Math.min(nowTime, _logicalAt(universeId, through))));
			uint256 fees;
			uint256 demand;
			if (through < capitalLedger[universeId].effectiveTime() && feesEnabled[universeId]) {
				(fees, demand) = settlement.setFeesEnabled(universeId, false, earnedThrough);
				feesEnabled[universeId] = false;
				_creditUniverse(universeId, fees, demand);
			}
			(fees, demand) = settlement.checkpointUniverse(universeId, nowTime);
			_creditUniverse(universeId, fees, demand);
		}
		syncingFees[universeId] = false;
	}
	function _creditUniverse(uint248 universeId, uint256 fees, uint256 demand) private {
		SecurityPoolCapitalLedger capital = capitalLedger[universeId];
		if (fees != 0) capital.creditTimedFees{value: fees}();
		capital.synchronizeDemand(demand);
	}
	function onQuestionRepIncome(uint256 amountAttoRep) external {
		ISecurityPool pool = _pool(msg.sender);
		IERC20 token = IERC20(address(pool.repToken()));
		SecurityPoolCapitalLedger capital = capitalLedger[pool.universeId()];
		token.safeApprove(address(capital), amountAttoRep);
		capital.fundVestedFees(amountAttoRep);
	}
	function registerReporterGame(address game) external {
		ISecurityPool pool = IPortfolioReporterIdentity(game).securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == game, 'Reporter game is not canonical');
		reporters.registerGame(pool.questionId(), game);
	}
	function onQuestionFinalityChanged(uint48 nativeFinalAfter) external {
		ISecurityPool pool = IPortfolioReporterIdentity(msg.sender).securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == msg.sender, 'Finality caller is not canonical');
		uint248 universeId = pool.universeId();
		capitalLedger[universeId].checkpoint();
		uint48 finalAfter = nativeFinalAfter == 0 ? 0 : _logicalAt(universeId, nativeFinalAfter);
		_creditSnapshot(universeId, settlement.scheduleFinality(address(pool), finalAfter, logicalTime(universeId)));
	}
	function onQuestionAccountingChanged() external view {
		_pool(msg.sender);
	}
	function onCompleteSetsReturned() external {
		ISecurityPool pool = _pool(msg.sender);
		if (zoltar.getForkTime(pool.universeId()) == 0) capitalLedger[pool.universeId()].serveRetirement();
	}
	function freezeForFork() external {
		ISecurityPool pool = _pool(msg.sender);
		IPortfolioForkCoordinator(forkController).freeze(pool.universeId());
	}
	function forkWithReporterQuestion(ISecurityPool pool) external {
		_pool(address(pool));
		require(msg.sender == pool.securityPoolForker(), 'Only canonical native forker');
		require(pool.escalationGame().canTriggerOwnFork(), 'Reporter game cannot fork');
		reporters.triggerFork(pool.universeId(), pool.questionId());
		IPortfolioForkCoordinator(forkController).freeze(pool.universeId());
	}
	function _createCapital(uint248 universeId) private returns (SecurityPoolCapitalLedger capital) {
		capital = deployers.capital.create(address(this), zoltar, universeId, statoblastSecurityMultiplierBps, minimumCommitmentAttoEth, minimumExecutionReserveAttoEth, rewardVestingSeconds);
		capital.initialize(deployers.commitments.create(address(capital)), ICapitalFeeStreams(address(deployers.fees.create(address(capital), uint48(block.timestamp)))), forkController);
		capitalLedger[universeId] = capital;
		capitalAddresses[address(capital)] = true;
		emit UniversePrepared(universeId, address(capital));
	}
}
