// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { ISecurityPoolPortfolioNative } from '../interfaces/ISecurityPoolPortfolioNative.sol';
import { IQuestionLedger, ISecurityPoolFactory, SystemState } from '../interfaces/IQuestionLedger.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinatorFactory } from './OpenOraclePriceCoordinatorFactory.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { IQuestionForker } from '../interfaces/IQuestionForker.sol';
import { QuestionLedgerDeployer } from './QuestionLedgerDeployer.sol';
import { SecurityPoolUtils } from '../SecurityPoolUtils.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';
import { QuestionLedgerEventEmitter } from '../QuestionLedgerEventEmitter.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory immutable shareTokenFactory;
	OpenOraclePriceCoordinatorFactory immutable openOraclePriceCoordinatorFactory;
	Zoltar public immutable override zoltar;
	OpenOracle immutable openOracle;
	EscalationGameFactory immutable escalationGameFactory;
	ZoltarQuestionData immutable questionData;
	IQuestionForker immutable questionForker;
	QuestionLedgerDeployer immutable questionLedgerDeployer;
	QuestionLedgerDeployment[] private questionLedgerDeployments;
	// Every caller that configured a portfolio namespace, in registration order.
	address[] private portfolios;
	struct QuestionLedgerRegistration {
		IQuestionLedger pool;
		bool claimed;
	}
	struct QuestionLedgerMetadata {
		bytes32 originId;
		address portfolio;
		bool hasInheritedForkOutcome;
	}
	// Pool ID from getQuestionLedgerId(originId, universeId) -> reservation and eventual pool.
	mapping(bytes32 => QuestionLedgerRegistration) private questionLedgerRegistrations;
	mapping(IQuestionLedger => QuestionLedgerMetadata) private questionLedgerMetadata;
	mapping(address => mapping(uint248 => address)) public sharedPriceFeeds;
	mapping(address => OpenOraclePriceCoordinator) private portfolioConfigurations;
	mapping(bytes32 => OpenOraclePriceCoordinator) private childQuestionLedgerCoordinators;
	/// @notice Hash of the only portfolio creation code this factory deploys.
	bytes32 public immutable portfolioCreationCodeHash;
	// Module deployers every portfolio uses for its origin and for each fork child.
	address private immutable capitalLedgerDeployer;
	address private immutable commitmentIndexDeployer;
	address private immutable capitalFeeStreamsDeployer;
	address private immutable settlementBookDeployer;
	address private immutable portfolioSettlementDeployer;
	address private immutable reporterLedgerDeployer;
	address private immutable forkCoordinatorDeployer;
	address private immutable portfolioServicesDeployer;
	address private immutable portfolioAuctionDeployer;
	uint256 private constant PORTFOLIO_CONFIGURATION_BYTES = 13 * 32;
	/// @notice Portfolios this factory deployed from the canonical creation code.
	/// Only they can open a pool namespace, so every registered pool belongs to one.
	mapping(address => bool) public isPortfolio;
	mapping(address => uint256) private portfolioCreationCount;

	event DeployQuestionLedger(IQuestionLedger indexed questionLedger, OpenOraclePriceCoordinator openOraclePriceCoordinator, IShareToken shareToken, IQuestionLedger indexed parent, uint248 indexed universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas);
	event QuestionLedgerRegistered(bytes32 indexed originId, bytes32 indexed poolId, uint248 indexed universeId, IQuestionLedger questionLedger);
	event PortfolioRegistered(address indexed portfolio, uint248 indexed originUniverseId);
	event SharedPriceFeedRegistered(address indexed portfolio, uint248 indexed universeId, address indexed priceFeed);
	event PortfolioDeployed(address indexed portfolio, address indexed creator);

	constructor(IQuestionForker _questionForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, OpenOraclePriceCoordinatorFactory _openOraclePriceCoordinatorFactory, address operationsDelegate, QuestionLedgerEventEmitter eventEmitter, bytes32 _portfolioCreationCodeHash, address[9] memory portfolioModuleDeployers) {
		require(_portfolioCreationCodeHash != bytes32(0), 'Portfolio creation code hash missing');
		// The deployers are deterministic addresses that may be deployed after this
		// factory. Every portfolio constructor requires each of them to hold code.
		portfolioCreationCodeHash = _portfolioCreationCodeHash;
		capitalLedgerDeployer = portfolioModuleDeployers[0];
		commitmentIndexDeployer = portfolioModuleDeployers[1];
		capitalFeeStreamsDeployer = portfolioModuleDeployers[2];
		settlementBookDeployer = portfolioModuleDeployers[3];
		portfolioSettlementDeployer = portfolioModuleDeployers[4];
		reporterLedgerDeployer = portfolioModuleDeployers[5];
		forkCoordinatorDeployer = portfolioModuleDeployers[6];
		portfolioServicesDeployer = portfolioModuleDeployers[7];
		portfolioAuctionDeployer = portfolioModuleDeployers[8];
		questionForker = _questionForker;
		shareTokenFactory = _shareTokenFactory;
		openOraclePriceCoordinatorFactory = _openOraclePriceCoordinatorFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		require(operationsDelegate != address(0), 'Operations delegate zero');
		require(operationsDelegate.code.length != 0, 'Operations delegate has no code');
		require(address(eventEmitter).code.length != 0, 'Accounting delegate has no code');
		questionLedgerDeployer = new QuestionLedgerDeployer(operationsDelegate, eventEmitter);
	}

	function questionLedgerDeploymentCount() external view returns (uint256) {
		return questionLedgerDeployments.length;
	}

	function portfolioCount() external view returns (uint256) {
		return portfolios.length;
	}

	function portfoliosRange(uint256 startIndex, uint256 count) external view returns (address[] memory page) {
		require(startIndex <= portfolios.length, 'Portfolio range start out of bounds');
		require(count <= portfolios.length - startIndex, 'Portfolio range count too large');
		page = new address[](count);
		for (uint256 index = 0; index < count; index++) {
			page[index] = portfolios[startIndex + index];
		}
	}

	function getQuestionLedger(bytes32 originId, uint248 universeId) external view returns (IQuestionLedger) {
		return questionLedgerRegistrations[getQuestionLedgerId(originId, universeId)].pool;
	}

	function getQuestionLedgerOriginId(IQuestionLedger questionLedger) external view returns (bytes32) {
		return questionLedgerMetadata[questionLedger].originId;
	}

	function getQuestionLedgerHasInheritedForkOutcome(IQuestionLedger questionLedger) external view returns (bool) {
		return questionLedgerMetadata[questionLedger].hasInheritedForkOutcome;
	}

	function getPortfolioOriginId(address portfolio, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(keccak256('Statoblast portfolio origin'), portfolio, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function getSecurityPoolPortfolio(IQuestionLedger questionLedger) external view returns (address) {
		return questionLedgerMetadata[questionLedger].portfolio;
	}

	function getQuestionLedgerId(bytes32 originId, uint248 universeId) public pure returns (bytes32) {
		return keccak256(abi.encode(originId, universeId));
	}

	function questionLedgerDeploymentsRange(uint256 startIndex, uint256 count) external view returns (QuestionLedgerDeployment[] memory deployments) {
		require(startIndex <= questionLedgerDeployments.length, 'Pool range start out of bounds');
		require(count <= questionLedgerDeployments.length - startIndex, 'Pool range count too large');
		deployments = new QuestionLedgerDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = questionLedgerDeployments[startIndex + index];
		}
	}

	function deployChildQuestionLedger(IQuestionLedger parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (IQuestionLedger questionLedger) {
		require(msg.sender == address(questionForker), 'Only question forker');
		bytes32 originId = questionLedgerMetadata[parent].originId;
		require(address(questionLedgerRegistrations[getQuestionLedgerId(originId, parent.universeId())].pool) == address(parent), 'Parent pool is not canonical');
		address portfolio = questionLedgerMetadata[parent].portfolio;
		require(portfolio != address(0), 'Portfolio missing');
		require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		(bool hasInheritedForkOutcome, ) = ISecurityPoolPortfolioNative(portfolio).inheritedFixedOutcome(universeId, questionId);
		require(address(parent.shareToken()) == address(shareToken), 'Child share token mismatch');
		uint256 initialReportPriorityFeeAttoEthPerGas = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		_reserveQuestionLedger(originId, universeId);
		OpenOraclePriceCoordinator openOraclePriceCoordinator = _prepareChildQuestionLedgerCoordinator(parent, universeId);
		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);
		questionLedger = deployQuestionLedger(shareToken, parent, openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps);
		_registerQuestionLedger(originId, universeId, questionLedger, hasInheritedForkOutcome, portfolio);
		_initializeQuestionLedger(questionLedger, openOraclePriceCoordinator, portfolio);
		_recordQuestionLedgerDeployment(QuestionLedgerDeployment(questionLedger, openOraclePriceCoordinator, shareToken, parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	/// @notice Deploys a portfolio from the canonical creation code with this factory and
	/// its pinned module deployers. `configuration` is the ABI encoding of the origin
	/// configuration, question horizon, admission policy and economics, in that order.
	/// @dev A portfolio's modules hold provider REP and trader collateral, and each fork
	/// child gets fresh ones from the same deployers. Fixing the code and the deployers
	/// here is what lets pools, the forker and exchanges trust a registered portfolio.
	function maximumReportPriorityFeeAttoEthPerGas() external view override returns (uint256) {
		return openOraclePriceCoordinatorFactory.maximumReportPriorityFeeAttoEthPerGas();
	}

	function deployPortfolio(bytes calldata creationCode, bytes calldata configuration) external returns (address portfolio) {
		require(keccak256(creationCode) == portfolioCreationCodeHash, 'Portfolio creation code is not canonical');
		require(configuration.length == PORTFOLIO_CONFIGURATION_BYTES, 'Portfolio configuration length invalid');
		bytes memory initCode = abi.encodePacked(creationCode, abi.encode(address(this), capitalLedgerDeployer, commitmentIndexDeployer, capitalFeeStreamsDeployer, settlementBookDeployer, portfolioSettlementDeployer, reporterLedgerDeployer, forkCoordinatorDeployer, portfolioServicesDeployer, portfolioAuctionDeployer), configuration);
		// The address depends on the creator, so no other deployment can take it.
		bytes32 salt = keccak256(abi.encode(msg.sender, portfolioCreationCount[msg.sender]++));
		assembly ('memory-safe') {
			portfolio := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(portfolio) {
				let size := returndatasize()
				let data := mload(0x40)
				returndatacopy(data, 0, size)
				revert(data, size)
			}
		}
		isPortfolio[portfolio] = true;
		emit PortfolioDeployed(portfolio, msg.sender);
	}

	/// @notice Deploy in the caller's own namespace; another caller can never add a ledger to it.
	function deployPortfolioQuestionLedger(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (IQuestionLedger questionLedger) {
		return
			_deployOriginQuestionLedger(msg.sender, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _deployOriginQuestionLedger(address portfolio, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) private returns (IQuestionLedger questionLedger) {
		// The caller's portfolio namespace prevents another creator from reserving its question identity.
		require(address(portfolioConfigurations[portfolio]) != address(0), 'Portfolio configuration missing');
		require(statoblastSecurityMultiplierBps >= SecurityPoolUtils.MINIMUM_SECURITY_MULTIPLIER_BPS, 'Multiplier must be at least 10500 BPS');

		// Validate that the question exists
		require(questionData.questionCreatedTimestamp(questionId) > 0, 'Question does not exist');
		require(block.timestamp < questionData.getQuestionEndDate(questionId), 'Question has already ended');

		// Validate that it's a yes-no question (exactly 2 outcomes: Yes and No)
		string[] memory outcomes = questionData.getOutcomeLabels(questionId, 0, 3);
		require(outcomes.length == 2, 'Question must have two outcomes');
		require(keccak256(bytes(outcomes[0])) == keccak256(bytes('Yes')), 'First outcome must be Yes');
		require(keccak256(bytes(outcomes[1])) == keccak256(bytes('No')), 'Second outcome must be No');
		require(zoltar.getForkTime(universeId) == 0, 'Universe already forked');

		ReputationToken reputationToken = zoltar.getRepToken(universeId);
		require(address(reputationToken) != address(0x0), 'Universe REP token missing');
		require(zoltar.getNonDecisionThresholdAttoRep(universeId) > _getInitialEscalationDepositAttoRep(universeId), 'Escalation threshold too low');
		bytes32 originId = getPortfolioOriginId(portfolio, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		_reserveQuestionLedger(originId, universeId);
		bytes32 questionLedgerSalt = originId;
		OpenOraclePriceCoordinator openOraclePriceCoordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, reputationToken, initialReportPriorityFeeAttoEthPerGas, questionLedgerSalt);

		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);

		// Each origin lineage has its own share token, which is reused by all migrated children.
		IShareToken shareToken = shareTokenFactory.deployShareToken(originId, questionId);
		questionLedger = deployQuestionLedger(shareToken, IQuestionLedger(payable(address(0))), openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps);

		_registerQuestionLedger(originId, universeId, questionLedger, false, portfolio);
		_initializeQuestionLedger(questionLedger, openOraclePriceCoordinator, portfolio);
		shareToken.authorize(questionLedger);
		_recordQuestionLedgerDeployment(QuestionLedgerDeployment(questionLedger, openOraclePriceCoordinator, shareToken, IQuestionLedger(payable(address(0))), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function _reserveQuestionLedger(bytes32 originId, uint248 universeId) private {
		bytes32 poolId = getQuestionLedgerId(originId, universeId);
		require(!questionLedgerRegistrations[poolId].claimed, 'Question ledger origin and universe already claimed');
		questionLedgerRegistrations[poolId].claimed = true;
	}

	function _registerQuestionLedger(bytes32 originId, uint248 universeId, IQuestionLedger questionLedger, bool hasInheritedForkOutcome, address portfolio) private {
		bytes32 poolId = getQuestionLedgerId(originId, universeId);
		require(address(questionLedgerRegistrations[poolId].pool) == address(0x0), 'Pool already registered');
		questionLedgerRegistrations[poolId].pool = questionLedger;
		questionLedgerMetadata[questionLedger] = QuestionLedgerMetadata(originId, portfolio, hasInheritedForkOutcome);
		emit QuestionLedgerRegistered(originId, poolId, universeId, questionLedger);
	}

	function _recordQuestionLedgerDeployment(QuestionLedgerDeployment memory deployment) private {
		questionLedgerDeployments.push(deployment);
		emit DeployQuestionLedger(deployment.questionLedger, deployment.openOraclePriceCoordinator, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.statoblastSecurityMultiplierBps, deployment.initialReportPriorityFeeAttoEthPerGas);
	}

	function deployQuestionLedger(IShareToken shareToken, IQuestionLedger parent, OpenOraclePriceCoordinator openOraclePriceCoordinator, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) private returns (IQuestionLedger questionLedger) {
		questionLedger = questionLedgerDeployer.deploy(address(questionForker), questionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps);

		openOraclePriceCoordinatorFactory.configureQuestionLedger(openOraclePriceCoordinator, questionLedger);
	}

	/// @notice Initialize a portfolio's oracle configuration without a standalone question pool.
	/// @dev Only a portfolio this factory deployed can open a namespace. The first call registers it for enumeration.
	function initializePortfolioPriceFeed(uint248 universeId, uint256 priorityFee) external returns (address) {
		require(isPortfolio[msg.sender], 'Portfolio is not canonical');
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Universe REP token missing');
		require(zoltar.getForkTime(universeId) == 0, 'Origin universe forked');
		OpenOraclePriceCoordinator coordinator = portfolioConfigurations[msg.sender];
		if (address(coordinator) == address(0)) {
			coordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, zoltar.getRepToken(universeId), priorityFee, keccak256(abi.encode('Portfolio configuration', msg.sender)));
			portfolioConfigurations[msg.sender] = coordinator;
			portfolios.push(msg.sender);
			emit PortfolioRegistered(msg.sender, universeId);
		} else {
			require(coordinator.initialReportPriorityFeeAttoEthPerGas() == priorityFee && address(coordinator.reputationToken()) == address(zoltar.getRepToken(universeId)), 'Portfolio configuration mismatch');
		}
		return address(_getOrCreateSharedPriceFeed(coordinator, msg.sender, universeId));
	}

	/// @notice Initialize a known branch from the caller's immutable origin configuration.
	function initializePortfolioPriceFeedForUniverse(uint248 universeId) external returns (address) {
		OpenOraclePriceCoordinator coordinator = portfolioConfigurations[msg.sender];
		require(address(coordinator) != address(0), 'Portfolio configuration missing');
		ISecurityPoolPortfolioNative(msg.sender).portfolioTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(coordinator, msg.sender, universeId));
	}

	/// @notice Prepare child REP and its shared feed independently of the more expensive ledger migration.
	/// @dev Anyone may prepare; the canonical forked parent fixes all namespace and oracle configuration.
	function preparePortfolioChildPriceFeed(IQuestionLedger parent, uint256 outcomeIndex) external returns (address) {
		uint248 parentUniverseId = parent.universeId();
		require(address(questionLedgerRegistrations[getQuestionLedgerId(questionLedgerMetadata[parent].originId, parentUniverseId)].pool) == address(parent), 'Parent pool is not canonical');
		address portfolio = questionLedgerMetadata[parent].portfolio;
		require(portfolio != address(0), 'Parent has no portfolio');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		return address(_getOrCreateSharedPriceFeed(parent.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare one known portfolio branch without materializing its ancestor questions.
	function preparePortfolioPriceFeed(IQuestionLedger source, uint248 universeId) external returns (address) {
		address portfolio = questionLedgerMetadata[source].portfolio;
		require(portfolio != address(0), 'Source has no portfolio');
		require(address(questionLedgerRegistrations[getQuestionLedgerId(questionLedgerMetadata[source].originId, source.universeId())].pool) == address(source), 'Source pool is not canonical');
		ISecurityPoolPortfolioNative(portfolio).portfolioTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(source.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare the canonical child coordinator without exposing a partial child ledger.
	function prepareChildQuestionLedgerCoordinator(IQuestionLedger parent, uint256 outcomeIndex) external returns (OpenOraclePriceCoordinator coordinator) {
		uint248 parentUniverseId = parent.universeId();
		require(address(questionLedgerRegistrations[getQuestionLedgerId(questionLedgerMetadata[parent].originId, parentUniverseId)].pool) == address(parent), 'Parent pool is not canonical');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		address portfolio = questionLedgerMetadata[parent].portfolio;
		require(portfolio != address(0), 'Portfolio missing');
		require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		return _prepareChildQuestionLedgerCoordinator(parent, universeId);
	}

	function getChildQuestionLedgerCoordinator(IQuestionLedger parent, uint256 outcomeIndex) external view returns (OpenOraclePriceCoordinator coordinator) {
		return
			childQuestionLedgerCoordinators[
				getQuestionLedgerId(questionLedgerMetadata[parent].originId, zoltar.getChildUniverseId(parent.universeId(), outcomeIndex))
			];
	}

	function _prepareChildQuestionLedgerCoordinator(IQuestionLedger parent, uint248 universeId) private returns (OpenOraclePriceCoordinator coordinator) {
		bytes32 poolId = getQuestionLedgerId(questionLedgerMetadata[parent].originId, universeId);
		coordinator = childQuestionLedgerCoordinators[poolId];
		if (address(coordinator) != address(0)) return coordinator;
		uint256 priorityFee = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		bytes32 salt = keccak256(abi.encode(parent, universeId, parent.questionId(), parent.statoblastSecurityMultiplierBps(), priorityFee));
		coordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, zoltar.getRepToken(universeId), priorityFee, salt);
		childQuestionLedgerCoordinators[poolId] = coordinator;
	}

	function _getOrCreateSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private returns (SharedPoolPriceFeed feed) {
		feed = SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][universeId]));
		if (address(feed) == address(0)) {
			feed = openOraclePriceCoordinatorFactory.deploySharedPoolPriceFeed(coordinator, portfolio, universeId, zoltar.getRepToken(universeId), keccak256(abi.encode(portfolio, universeId)));
			sharedPriceFeeds[portfolio][universeId] = address(feed);
			emit SharedPriceFeedRegistered(portfolio, universeId, address(feed));
		}
	}

	function _configureSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private {
		openOraclePriceCoordinatorFactory.configureSharedPriceFeed(coordinator, _getOrCreateSharedPriceFeed(coordinator, portfolio, universeId));
	}

	function _initializeQuestionLedger(IQuestionLedger questionLedger, OpenOraclePriceCoordinator coordinator, address portfolio) private {
		SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][questionLedger.universeId()])).registerCoordinator(address(coordinator));
		questionLedger.setStartingParams();
	}

	function _getInitialEscalationDepositAttoRep(uint248 universeId) private view returns (uint256 initialDepositAttoRep) {
		return
			SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(zoltar.getUniverseTheoreticalSupplyAttoRep(universeId));
	}
}
