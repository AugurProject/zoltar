// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';
import { Collateral } from '../Collateral.sol';
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
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';

interface IPortfolioForkCoordinator {
	function initialize(uint248 origin) external;
	function activateOrigin(uint248 origin) external;
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool);
	function isReady(uint248 universeId) external view returns (bool);
	function isPriceReportingOpen(uint248 universeId) external view returns (bool);
	function auctionExposure(uint248 universeId) external view returns (uint256 commitment, uint256 rep);
	function portfolioTime(uint248 universeId) external view returns (uint48);
	function forkPortfolioTime(uint248 universeId) external view returns (uint48);
	function nativeTimeForPortfolioTime(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function portfolioTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48);
	function ensureReady(uint248 universeId) external;
	function freeze(uint248 universeId) external;
	function inheritedFixedOutcome(uint248 universeId, uint256 questionId) external view returns (bool, uint256);
}
interface IPortfolioAuctionDeployer {
	function create(address authority, address portfolio, uint248 child, uint256 close, uint256 inventory, uint256 shortfall) external returns (address);
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
	struct OriginConfig {
		IERC20 collateralToken;
		uint256 minimumReportCollateral;
		uint248 universeId;
		uint256 securityMultiplierBps;
		uint256 reportPriorityFeeAttoEthPerGas;
	}
	struct EconomicsConfig {
		uint256 purchaseFeeBps;
		uint256 annualFeeBps;
		uint256 minimumPurchaseFeeAttoEth;
		uint256 minimumCommitmentAttoEth;
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
		SecurityPoolPortfolioServicesDeployer services;
		IPortfolioAuctionDeployer auctions;
	}
	ISecurityPoolFactory public immutable factory;

	Zoltar public immutable zoltar;
	uint248 public immutable originUniverseId;
	ISecurityPoolQuestionAdmissionPolicy public immutable questionAdmissionPolicy;
	uint256 public immutable statoblastSecurityMultiplierBps;
	IERC20 public immutable collateralToken;
	uint256 public immutable minimumReportCollateral;
	uint256 public immutable initialReportPriorityFeeAttoEthPerGas;
	uint256 public immutable maximumQuestionHorizonSeconds;
	uint256 public immutable purchaseFeeBps;
	uint256 public immutable annualFeeBps;
	uint256 public immutable minimumPurchaseFeeAttoEth;
	uint256 public immutable minimumCommitmentAttoEth;
	uint256 public immutable minimumOutcomeRate;
	uint48 public immutable rewardVestingSeconds;
	IPortfolioAuctionDeployer public immutable auctionDeployer;
	SecurityPoolPortfolioPurchase public immutable quoteHelper;
	SecurityPoolPortfolioServices public immutable services;
	SecurityPoolPortfolioSettlement public settlement;
	SecurityPoolReporterLedger public reporters;
	address public forkController;
	// setupStage names the next operation; completion is terminal and idempotent.
	uint8 private constant SETUP_SETTLEMENT = 0;
	uint8 private constant SETUP_REPORTERS_AND_FORKS = 1;
	uint8 private constant SETUP_CAPITAL = 2;
	uint8 private constant SETUP_PRICE_FEED = 3;
	uint8 private constant SETUP_COMPLETE = 4;
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

	constructor(ISecurityPoolFactory _factory, OriginConfig memory origin, uint256 horizon, Deployers memory deployment, ISecurityPoolQuestionAdmissionPolicy admission, EconomicsConfig memory config) {
		require(address(admission).code.length != 0, 'Admission policy has no code');
		require(config.purchaseFeeBps <= 10_000 && config.annualFeeBps <= 10_000 && config.minimumCommitmentAttoEth > 0, 'Invalid portfolio economics');
		require(address(deployment.auctions).code.length != 0, 'Auction deployer has no code');
		require(config.minimumOutcomeRate > 0 && config.minimumOutcomeRate <= 1e18, 'Invalid minimum exchange rate');
		require(address(deployment.capital).code.length != 0 && address(deployment.commitments).code.length != 0 && address(deployment.fees).code.length != 0 && address(deployment.books).code.length != 0 && address(deployment.settlement).code.length != 0 && address(deployment.reporters).code.length != 0 && address(deployment.forks).code.length != 0 && address(deployment.services).code.length != 0, 'Portfolio deployer has no code');
		require(config.rewardVestingSeconds > 0 && horizon > 0 && horizon <= type(uint48).max, 'Invalid portfolio duration');
		require(origin.reportPriorityFeeAttoEthPerGas > 0, 'Initial priority fee zero');
		require(origin.securityMultiplierBps >= SecurityPoolUtils.MINIMUM_SECURITY_MULTIPLIER_BPS, 'Multiplier must be at least 10500 BPS');
		factory = _factory;
		zoltar = _factory.zoltar();
		originUniverseId = origin.universeId;
		require(address(zoltar.getRepToken(origin.universeId)) != address(0), 'Universe REP token missing');
		require(zoltar.getForkTime(origin.universeId) == 0, 'Origin universe forked');
		questionAdmissionPolicy = admission;
		maximumQuestionHorizonSeconds = horizon;
		statoblastSecurityMultiplierBps = origin.securityMultiplierBps;
		address token = address(origin.collateralToken);
		require(token.code.length != 0, 'Collateral token missing');
		// Canonical REP must remain distinct from collateral in every branch's oracle and custody accounting.
		require(token != address(zoltar.getRepToken(0)), 'REP cannot be portfolio collateral');
		(bool hasUniverse, bytes memory encodedUniverse) = token.staticcall{gas: 30_000}(abi.encodeWithSignature('universeId()'));
		if (hasUniverse && encodedUniverse.length == 32) {
			uint256 tokenUniverse = abi.decode(encodedUniverse, (uint256));
			require(tokenUniverse > type(uint248).max || token != address(zoltar.getRepToken(uint248(tokenUniverse))), 'REP cannot be portfolio collateral');
		}
		require(origin.minimumReportCollateral > 0 && origin.minimumReportCollateral <= type(uint128).max, 'Invalid report collateral floor');
		collateralToken = origin.collateralToken;
		minimumReportCollateral = origin.minimumReportCollateral;
		initialReportPriorityFeeAttoEthPerGas = origin.reportPriorityFeeAttoEthPerGas;
		purchaseFeeBps = config.purchaseFeeBps;
		annualFeeBps = config.annualFeeBps;
		minimumPurchaseFeeAttoEth = config.minimumPurchaseFeeAttoEth;
		minimumCommitmentAttoEth = config.minimumCommitmentAttoEth;
		minimumOutcomeRate = config.minimumOutcomeRate;
		rewardVestingSeconds = config.rewardVestingSeconds;
		auctionDeployer = deployment.auctions;
		deployers = deployment;
		quoteHelper = new SecurityPoolPortfolioPurchase(address(this));
		services = deployment.services.create(address(this));
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
		if (setupStage == SETUP_COMPLETE) return;
		require(zoltar.getForkTime(originUniverseId) == 0, 'Origin universe forked');
		if (setupStage == SETUP_SETTLEMENT) {
			settlement = deployers.settlement.create(address(this));
			settlement.initialize(deployers.books.create(address(settlement), minimumOutcomeRate));
			settlement.authorizeServices(address(services));
			settlement.registerUniverse(originUniverseId, uint48(block.timestamp));
			settlement.setFeesEnabled(originUniverseId, false, uint48(block.timestamp));
			services.registerUniverse(originUniverseId);
		} else if (setupStage == SETUP_REPORTERS_AND_FORKS) {
			reporters = deployers.reporters.create(address(this), zoltar);
			reporters.registerUniverse(originUniverseId);
			forkController = deployers.forks.create(address(this), zoltar);
			IPortfolioForkCoordinator(forkController).initialize(originUniverseId);
		} else if (setupStage == SETUP_CAPITAL) {
			_createCapital(originUniverseId);
		} else if (setupStage == SETUP_PRICE_FEED) {
			factory.initializePortfolioPriceFeed(originUniverseId, initialReportPriorityFeeAttoEthPerGas);
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
		(uint256 auctionCommitment, ) = IPortfolioForkCoordinator(forkController).auctionExposure(universeId);
		return Math.max(Math.max(commitment, auctionCommitment), capitalLedger[universeId].demandAttoEth());
	}
	function oracleRepExposure(uint248 universeId) external view returns (uint256 rep) {
		(, rep) = IPortfolioForkCoordinator(forkController).auctionExposure(universeId);
	}
	function availableMintCapacity(uint248 universeId) external view returns (uint256) {
		return quoteHelper.availableMintCapacity(universeId);
	}
	function clocks(uint248 universeId) external view returns (uint48, uint48, bool, bool) {
		return IPortfolioForkCoordinator(forkController).clocks(universeId);
	}
	function isPriceReportingOpen(uint248 universeId) external view returns (bool) {
		return IPortfolioForkCoordinator(forkController).isPriceReportingOpen(universeId);
	}
	function portfolioTime(uint248 universeId) public view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).portfolioTime(universeId);
	}
	function forkPortfolioTime(uint248 universeId) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).forkPortfolioTime(universeId);
	}
	function nativeTimeForPortfolioTime(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).nativeTimeForPortfolioTime(universeId, timestamp);
	}
	function portfolioTimeForNative(uint248 universeId, uint48 timestamp) external view returns (uint48) {
		return IPortfolioForkCoordinator(forkController).portfolioTimeForNative(universeId, timestamp);
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
		factory.initializePortfolioPriceFeedForUniverse(child);
		if (zoltar.getForkTime(child) == 0 && capitalLedger[child].isPriceValid()) services.activateFees(child);
	}
	function creditForkFees(uint248 universeId, uint256 amount) external onlyForkController {
		if (amount != 0) {
			collateralToken.safeApprove(address(capitalLedger[universeId]), amount);
			capitalLedger[universeId].creditTimedFees(amount);
		}
	}
	function addQuestion(uint256 questionId) public returns (ISecurityPool pool) {
		require(setupStage == SETUP_COMPLETE, 'Portfolio setup incomplete');
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
	function purchaseQuote(uint248 universeId, uint256 questionId, uint256 mintAttoEth) external view returns (uint256 fee, uint256 premium) {
		return quoteHelper.purchaseQuote(universeId, questionId, mintAttoEth);
	}
	function createCompleteSet(uint248 universeId, uint256 questionId, uint256 mintAttoEth, address recipient, uint256 minimumShares, uint256 maximumFee) external nonReentrant returns (uint256 minted) {
		uint256 fee;
		(minted, fee) = services.purchase(msg.sender, universeId, questionId, mintAttoEth, recipient, minimumShares, maximumFee);
		purchasingPool = address(0);
		emit CompleteSetsFunded(universeId, questionId, recipient, mintAttoEth, minted, fee);
	}
	function prepareServicePurchase(uint248 universeId, uint256 questionId) external onlyServices returns (ISecurityPool pool) {
		require(setupStage == SETUP_COMPLETE, 'Portfolio setup incomplete');
		IPortfolioForkCoordinator(forkController).ensureReady(universeId);
		require(IPortfolioForkCoordinator(forkController).isReady(universeId), 'Universe is not ready');
		if (universeId != originUniverseId)
			require(questionAdmissionPolicy.isQuestionAllowed(address(this), originUniverseId, questionId), 'Question rejected by admission policy');
		pool = universeId == originUniverseId ? addQuestion(questionId) : getPool(questionId, universeId);
		purchasingPool = address(pool);
		capitalLedger[universeId].checkpoint();
	}

	function mintQuestionSettlement(uint256 cash) external returns (uint256, uint256, uint256) {
		ISecurityPool pool = _pool(msg.sender);
		require(entered && purchasingPool == msg.sender, 'No authorized portfolio purchase');
		return services.mintQuestionSettlement(pool, cash);
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
		require(IPortfolioForkCoordinator(forkController).isPriceReportingOpen(universeId), 'Portfolio reporting window closed');
		capitalLedger[universeId].acceptPrice(price, validUntil);
		if (IPortfolioForkCoordinator(forkController).isReady(universeId)) services.activateFees(universeId);
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
		capital.fundVestedFees(0, amountAttoRep);
	}
	function registerReporterGame(address game) external {
		IPortfolioReporterIdentity identity = IPortfolioReporterIdentity(game);
		ISecurityPool pool = identity.securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == game, 'Reporter game is not canonical');
		// Until every carried outcome is installed, the parent's game must remain
		// the authoritative source for the next permissionless materialization step.
		require(!identity.forkContinuation() || identity.forkCarrySnapshotInitialized(), 'Reporter fork snapshot incomplete');
		reporters.registerGame(pool.questionId(), game);
	}
	function onQuestionFinalityChanged(uint48 nativeFinalAfter) external {
		ISecurityPool pool = IPortfolioReporterIdentity(msg.sender).securityPool();
		_pool(address(pool));
		require(address(pool.escalationGame()) == msg.sender, 'Finality caller is not canonical');
		services.onQuestionFinalityChanged(pool, nativeFinalAfter);
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
		capital = deployers.capital.create(address(this), zoltar, universeId, statoblastSecurityMultiplierBps, minimumCommitmentAttoEth, rewardVestingSeconds);
		capital.initialize(deployers.commitments.create(address(capital)), ICapitalFeeStreams(address(deployers.fees.create(address(capital), uint48(block.timestamp), rewardVestingSeconds))), forkController, address(services));
		capitalLedger[universeId] = capital;
		capitalAddresses[address(capital)] = true;
		emit UniversePrepared(universeId, address(capital));
	}
}
