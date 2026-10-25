// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolCapitalLedger } from './SecurityPoolCapitalLedger.sol';
import { ICapitalFeeStreams } from './interfaces/ICapitalAccounting.sol';
import { SecurityPoolPortfolioSettlement } from './SecurityPoolPortfolioSettlement.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolPortfolioPurchase } from './SecurityPoolPortfolioPurchase.sol';
import { SecurityPoolPortfolioServices } from './SecurityPoolPortfolioServices.sol';
import {
	SecurityPoolCapitalLedgerDeployer,
	SecurityPoolCommitmentIndexDeployer,
	SecurityPoolCapitalFeeStreamsDeployer,
	SecurityPoolSettlementBookDeployer,
	SecurityPoolPortfolioSettlementDeployer,
	SecurityPoolPortfolioServicesDeployer,
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
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
}
interface IPortfolioForkCoordinatorDeployer {
	function create(address authority, Zoltar zoltar) external returns (address);
}
interface IPortfolioReporterIdentity {
	function securityPool() external view returns (ISecurityPool);
	function forkContinuation() external view returns (bool);
	function forkCarrySnapshotInitialized() external view returns (bool);
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
		uint256 reportingFeeAttoEth;
		uint256 serviceFeeBps;
		uint256 maximumOracleRewardAttoEth;
	}
	struct Deployers {
		SecurityPoolCapitalLedgerDeployer capital;
		SecurityPoolCommitmentIndexDeployer commitments;
		SecurityPoolCapitalFeeStreamsDeployer fees;
		SecurityPoolSettlementBookDeployer books;
		SecurityPoolPortfolioSettlementDeployer settlement;
		SecurityPoolReporterLedgerDeployer reporters;
		IPortfolioForkCoordinatorDeployer forks;
		SecurityPoolPortfolioServicesDeployer services;
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
	uint256 public immutable reportingFeeAttoEth;
	uint256 public immutable serviceFeeBps;
	uint256 public immutable maximumOracleRewardAttoEth;
	SecurityPoolPortfolioPurchase public immutable quoteHelper;
	SecurityPoolPortfolioServices public immutable services;
	SecurityPoolPortfolioSettlement public settlement;
	SecurityPoolReporterLedger public reporters;
	address public forkController;
	uint8 public setupStage;
	Deployers private deployers;
	mapping(uint248 => SecurityPoolCapitalLedger) public capitalLedger;
	mapping(address => bool) private capitalAddresses;
	mapping(uint256 => bytes32) public questionOriginIds;
	mapping(address => bool) public registeredPools;
	uint256[] private questions;
	bool private entered;
	address private purchasingPool;

	event QuestionRegistered(uint256 indexed questionId, bytes32 indexed originId, ISecurityPool indexed pool);
	event CompleteSetsFunded(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient, uint256 cashAttoEth, uint256 shares, uint256 purchaseFeeAttoEth);
	event UniversePrepared(uint248 indexed universeId, address capitalLedger);
	event SetupAdvanced(uint8 stage);
	event QuestionReportingRewardPaid(uint248 indexed universeId, uint256 indexed questionId, address indexed recipient);

	constructor(ISecurityPoolFactory _factory, ISecurityPool seed, uint256 horizon, Deployers memory deployment, ISecurityPoolQuestionAdmissionPolicy admission, EconomicsConfig memory config) {
		require(address(admission).code.length != 0, 'Admission policy has no code');
		require(config.purchaseFeeBps <= 10_000 && config.annualFeeBps <= 10_000 && config.minimumCommitmentAttoEth > 0 && config.minimumExecutionReserveAttoEth > 0, 'Invalid portfolio economics');
		require(config.serviceFeeBps <= 10_000, 'Invalid maintenance fee share');
		require(config.minimumOutcomeRate > 0 && config.minimumOutcomeRate <= 1e18, 'Invalid minimum exchange rate');
		require(address(deployment.capital).code.length != 0 && address(deployment.commitments).code.length != 0 && address(deployment.fees).code.length != 0 && address(deployment.books).code.length != 0 && address(deployment.settlement).code.length != 0 && address(deployment.reporters).code.length != 0 && address(deployment.forks).code.length != 0 && address(deployment.services).code.length != 0, 'Portfolio deployer has no code');
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
		reportingFeeAttoEth = config.reportingFeeAttoEth;
		serviceFeeBps = config.serviceFeeBps;
		maximumOracleRewardAttoEth = config.maximumOracleRewardAttoEth;
		deployers = deployment;
		quoteHelper = new SecurityPoolPortfolioPurchase(address(this));
		services = deployment.services.create(address(this), config.maximumOracleRewardAttoEth, initialReportPriorityFeeAttoEthPerGas);
	}

	modifier nonReentrant() {
		require(!entered, 'Portfolio operation active');
		entered = true;
		_;
		entered = false;
	}
	modifier onlyServices() {
		require(msg.sender == address(services), 'Only portfolio services');
		_;
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
			settlement.authorizeServices(address(services));
			settlement.registerUniverse(originUniverseId, uint48(block.timestamp));
			settlement.setFeesEnabled(originUniverseId, false, uint48(block.timestamp));
			services.registerUniverse(originUniverseId);
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
		require(msg.sender == address(settlement) || msg.sender == address(services) || msg.sender == forkController || capitalAddresses[msg.sender], 'Unexpected portfolio ETH');
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
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 mintAttoEth) external view returns (uint256 fee, uint256 premium, uint256 rewardFunding, uint256 maintenance) {
		return quoteHelper.purchaseQuote(universeId, questionId, mintAttoEth);
	}
	function createCompleteSet(uint248 universeId, uint256 questionId, uint256 mintAttoEth, address recipient, uint256 minimumShares) external payable nonReentrant returns (uint256 minted) {
		uint256 fee;
		(minted, fee) = services.purchase{value: msg.value}(msg.sender, universeId, questionId, mintAttoEth, recipient, minimumShares);
		emit CompleteSetsFunded(universeId, questionId, recipient, mintAttoEth, minted, fee);
	}
	function prepareServicePurchase(uint248 universeId, uint256 questionId) external onlyServices returns (ISecurityPool pool) {
		require(setupStage == 3, 'Portfolio setup incomplete');
		IPortfolioForkCoordinator(forkController).ensureReady(universeId);
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Universe is not ready');
		if (universeId != originUniverseId)
			require(questionAdmissionPolicy.isQuestionAllowed(address(this), originUniverseId, questionId), 'Question rejected by admission policy');
		pool = universeId == originUniverseId ? addQuestion(questionId) : getPool(questionId, universeId);
		capitalLedger[universeId].checkpoint();
	}
	function executeServiceMint(ISecurityPool pool, address recipient, uint256 minimumShares) external payable onlyServices returns (uint256 minted) {
		purchasingPool = address(pool);
		minted = quoteHelper.mintCompleteSets{value: msg.value}(pool, recipient, minimumShares);
		purchasingPool = address(0);
	}
	function deliverServiceMint(ISecurityPool pool, address recipient, uint256 shares) external onlyServices {
		quoteHelper.deliverCompleteSets(pool, recipient, shares);
	}
	function mintQuestionSettlement() external payable returns (uint256, uint256, uint256) {
		ISecurityPool pool = _pool(msg.sender);
		require(entered && purchasingPool == msg.sender, 'No authorized portfolio purchase');
		return services.mintQuestionSettlement{value: msg.value}(pool);
	}
	function redeemQuestionSettlement(address recipient, uint256 burnedShares) external returns (uint256, uint256, uint256) {
		return services.redeemQuestionSettlement(_pool(msg.sender), recipient, burnedShares);
	}
	function checkpointQuestionSettlement() external returns (uint256, uint256, uint48) {
		return services.checkpointQuestionSettlement(_pool(msg.sender), false);
	}
	function refreshQuestionSettlement() external returns (uint256, uint256, uint48) {
		return services.checkpointQuestionSettlement(_pool(msg.sender), true);
	}
	function quoteQuestionSettlement(address pool, uint256 shares) external view returns (uint256) {
		_pool(pool);
		return settlement.quoteRedemption(pool, shares);
	}
	function quoteQuestionRecoveryRep(address pool, uint256 shares) external view returns (uint256) {
		_pool(pool);
		return settlement.quoteRecoveryRep(pool, shares);
	}
	function quoteQuestionMint(address pool, uint256 cash) external view returns (uint256) {
		_pool(pool);
		return settlement.quoteMint(pool, cash);
	}
	function feesEnabled(uint248 universeId) external view returns (bool) {
		return services.feesEnabled(universeId);
	}
	function onSharedPriceAccepted(uint248 universeId, uint256 price, uint48 validUntil) external {
		require(msg.sender == factory.sharedPriceFeeds(address(this), universeId), 'Only canonical shared feed');
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Universe is not active');
		capitalLedger[universeId].acceptPrice(price, validUntil);
		services.activateFees(universeId);
	}
	function checkpointCapitalFees(uint248 universeId, uint48 through) external {
		require(msg.sender == address(capitalLedger[universeId]), 'Only universe capital ledger');
		services.checkpointCapitalFees(universeId, through);
	}
	function onQuestionRepIncome(uint256 amountAttoRep) external {
		ISecurityPool pool = _pool(msg.sender);
		IERC20 token = IERC20(address(pool.repToken()));
		SecurityPoolCapitalLedger capital = capitalLedger[pool.universeId()];
		token.safeApprove(address(capital), amountAttoRep);
		capital.fundVestedFees(amountAttoRep);
	}
	function registerReporterGame(address game) external {
		IPortfolioReporterIdentity identity = IPortfolioReporterIdentity(game);
		ISecurityPool pool = identity.securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == game, 'Reporter game is not canonical');
		// Until every carried outcome is installed, the parent's game must remain
		// the authoritative source for the next permissionless materialization step.
		require(!identity.forkContinuation() || identity.forkCarrySnapshotInitialized(), 'Reporter fork snapshot incomplete');
		services.registerGame(game);
		reporters.registerGame(pool.questionId(), game);
	}
	function onQuestionReporterChanged(address reporter) external {
		ISecurityPool pool = IPortfolioReporterIdentity(msg.sender).securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == msg.sender, 'Reporter caller is not canonical');
		services.recordReporter(msg.sender, reporter);
	}
	function onQuestionFinalityChanged(uint48 nativeFinalAfter) external {
		ISecurityPool pool = IPortfolioReporterIdentity(msg.sender).securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == msg.sender, 'Finality caller is not canonical');
		services.onQuestionFinalityChanged(pool, nativeFinalAfter);
	}
	/// @notice Pay the bounded final reporter ETH reward without visiting other questions.
	function claimQuestionReportingReward(address poolAddress) external nonReentrant {
		address recipient = services.claimReportingReward(poolAddress);
		ISecurityPool pool = ISecurityPool(payable(poolAddress));
		emit QuestionReportingRewardPaid(pool.universeId(), pool.questionId(), recipient);
	}
	function creditServiceFees(uint248 universeId) external payable {
		require(msg.sender == address(capitalLedger[universeId]) || msg.sender == forkController, 'Only portfolio service funding');
		services.fundMaintenance{value: msg.value}(universeId);
	}
	function rewardOracleReport(uint248 universeId, address sponsor, uint256 gasUnits, uint256 requestedAt) external {
		require(msg.sender == factory.sharedPriceFeeds(address(this), universeId), 'Only canonical shared feed');
		services.rewardOracleReport(universeId, sponsor, gasUnits, requestedAt);
	}
	function onQuestionAccountingChanged() external view {
		_pool(msg.sender);
	}
	function onCompleteSetsReturned() external {
		ISecurityPool pool = _pool(msg.sender);
		services.cancelUnusedPremium(pool);
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
		capital.initialize(deployers.commitments.create(address(capital)), ICapitalFeeStreams(address(deployers.fees.create(address(capital), uint48(block.timestamp), rewardVestingSeconds))), forkController, address(services));
		capitalLedger[universeId] = capital;
		capitalAddresses[address(capital)] = true;
		emit UniversePrepared(universeId, address(capital));
	}
}
