// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { ISecurityPoolPortfolioNative } from '../interfaces/ISecurityPoolPortfolioNative.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { IShareToken } from '../interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinatorFactory } from './OpenOraclePriceCoordinatorFactory.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { EscalationGameFactory } from './EscalationGameFactory.sol';
import { ISecurityPoolForker } from '../interfaces/ISecurityPoolForker.sol';
import { SecurityPoolDeployer } from './SecurityPoolDeployer.sol';
import { SecurityPoolUtils } from '../SecurityPoolUtils.sol';
import { SharedPoolPriceFeed } from '../SharedPoolPriceFeed.sol';
import { SecurityPoolEventEmitter } from '../SecurityPoolEventEmitter.sol';

contract SecurityPoolFactory is ISecurityPoolFactory {
	ShareTokenFactory immutable shareTokenFactory;
	OpenOraclePriceCoordinatorFactory immutable openOraclePriceCoordinatorFactory;
	Zoltar public immutable override zoltar;
	OpenOracle immutable openOracle;
	EscalationGameFactory immutable escalationGameFactory;
	ZoltarQuestionData immutable questionData;
	ISecurityPoolForker immutable securityPoolForker;
	SecurityPoolDeployer immutable securityPoolDeployer;
	SecurityPoolDeployment[] private securityPoolDeployments;
	// Every caller that configured a portfolio namespace, in registration order.
	address[] private portfolios;
	struct PoolRegistration {
		ISecurityPool pool;
		bool claimed;
	}
	struct SecurityPoolMetadata {
		bytes32 originId;
		address portfolio;
		bool hasInheritedForkOutcome;
	}
	// Pool ID from getPoolId(originId, universeId) -> reservation and eventual pool.
	mapping(bytes32 => PoolRegistration) private poolRegistrations;
	mapping(ISecurityPool => SecurityPoolMetadata) private poolMetadata;
	mapping(address => mapping(uint248 => address)) public sharedPriceFeeds;
	mapping(address => OpenOraclePriceCoordinator) private portfolioConfigurations;
	mapping(bytes32 => OpenOraclePriceCoordinator) private childPoolCoordinators;

	event DeploySecurityPool(ISecurityPool indexed securityPool, OpenOraclePriceCoordinator openOraclePriceCoordinator, IShareToken shareToken, ISecurityPool indexed parent, uint248 indexed universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas);
	event SecurityPoolRegistered(bytes32 indexed originId, bytes32 indexed poolId, uint248 indexed universeId, ISecurityPool securityPool);
	event PortfolioRegistered(address indexed portfolio, uint248 indexed originUniverseId);

	constructor(ISecurityPoolForker _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, OpenOraclePriceCoordinatorFactory _openOraclePriceCoordinatorFactory, address operationsDelegate, SecurityPoolEventEmitter eventEmitter) {
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		openOraclePriceCoordinatorFactory = _openOraclePriceCoordinatorFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		require(operationsDelegate != address(0), 'Operations delegate zero');
		require(operationsDelegate.code.length != 0, 'Operations delegate has no code');
		require(address(eventEmitter).code.length != 0, 'Accounting delegate has no code');
		securityPoolDeployer = new SecurityPoolDeployer(operationsDelegate, eventEmitter);
	}

	function securityPoolDeploymentCount() external view returns (uint256) {
		return securityPoolDeployments.length;
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

	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool) {
		return poolRegistrations[getPoolId(originId, universeId)].pool;
	}

	function getSecurityPoolOriginId(ISecurityPool securityPool) external view returns (bytes32) {
		return poolMetadata[securityPool].originId;
	}

	function getSecurityPoolHasInheritedForkOutcome(ISecurityPool securityPool) external view returns (bool) {
		return poolMetadata[securityPool].hasInheritedForkOutcome;
	}

	function getPortfolioOriginId(address portfolio, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(keccak256('Statoblast portfolio origin'), portfolio, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function getSecurityPoolPortfolio(ISecurityPool securityPool) external view returns (address) {
		return poolMetadata[securityPool].portfolio;
	}

	function getPoolId(bytes32 originId, uint248 universeId) public pure returns (bytes32) {
		return keccak256(abi.encode(originId, universeId));
	}

	function securityPoolDeploymentsRange(uint256 startIndex, uint256 count) external view returns (SecurityPoolDeployment[] memory deployments) {
		require(startIndex <= securityPoolDeployments.length, 'Pool range start out of bounds');
		require(count <= securityPoolDeployments.length - startIndex, 'Pool range count too large');
		deployments = new SecurityPoolDeployment[](count);
		for (uint256 index = 0; index < count; index++) {
			deployments[index] = securityPoolDeployments[startIndex + index];
		}
	}

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) external returns (ISecurityPool securityPool) {
		require(msg.sender == address(securityPoolForker), 'Only security pool forker');
		bytes32 originId = poolMetadata[parent].originId;
		require(address(poolRegistrations[getPoolId(originId, parent.universeId())].pool) == address(parent), 'Parent pool is not canonical');
		address portfolio = poolMetadata[parent].portfolio;
		require(portfolio != address(0), 'Portfolio missing');
		require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		(bool hasInheritedForkOutcome, ) = ISecurityPoolPortfolioNative(portfolio).inheritedFixedOutcome(universeId, questionId);
		require(address(parent.shareToken()) == address(shareToken), 'Child share token mismatch');
		uint256 initialReportPriorityFeeAttoEthPerGas = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		_reserveSecurityPool(originId, universeId);
		OpenOraclePriceCoordinator openOraclePriceCoordinator = _prepareChildPoolDependencies(parent, universeId);
		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);
		securityPool = deploySecurityPool(shareToken, parent, openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps);
		_registerSecurityPool(originId, universeId, securityPool, hasInheritedForkOutcome, portfolio);
		_initializeSecurityPool(securityPool, openOraclePriceCoordinator, portfolio);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, openOraclePriceCoordinator, shareToken, parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	/// @notice Deploy in the caller's own namespace; another caller can never add a ledger to it.
	function deployPortfolioSecurityPool(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (ISecurityPool securityPool) {
		return
			_deployOriginSecurityPool(msg.sender, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _deployOriginSecurityPool(address portfolio, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) private returns (ISecurityPool securityPool) {
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
		_reserveSecurityPool(originId, universeId);
		bytes32 securityPoolSalt = originId;
		OpenOraclePriceCoordinator openOraclePriceCoordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, reputationToken, initialReportPriorityFeeAttoEthPerGas, securityPoolSalt);

		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);

		// Each origin lineage has its own share token, which is reused by all migrated children.
		IShareToken shareToken = shareTokenFactory.deployShareToken(originId, questionId);
		securityPool = deploySecurityPool(shareToken, ISecurityPool(payable(address(0))), openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps);

		_registerSecurityPool(originId, universeId, securityPool, false, portfolio);
		_initializeSecurityPool(securityPool, openOraclePriceCoordinator, portfolio);
		shareToken.authorize(securityPool);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, openOraclePriceCoordinator, shareToken, ISecurityPool(payable(address(0))), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function _reserveSecurityPool(bytes32 originId, uint248 universeId) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(!poolRegistrations[poolId].claimed, 'Security pool origin and universe already claimed');
		poolRegistrations[poolId].claimed = true;
	}

	function _registerSecurityPool(bytes32 originId, uint248 universeId, ISecurityPool securityPool, bool hasInheritedForkOutcome, address portfolio) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(address(poolRegistrations[poolId].pool) == address(0x0), 'Pool already registered');
		poolRegistrations[poolId].pool = securityPool;
		poolMetadata[securityPool] = SecurityPoolMetadata(originId, portfolio, hasInheritedForkOutcome);
		emit SecurityPoolRegistered(originId, poolId, universeId, securityPool);
	}

	function _recordSecurityPoolDeployment(SecurityPoolDeployment memory deployment) private {
		securityPoolDeployments.push(deployment);
		emit DeploySecurityPool(deployment.securityPool, deployment.openOraclePriceCoordinator, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.statoblastSecurityMultiplierBps, deployment.initialReportPriorityFeeAttoEthPerGas);
	}

	function deploySecurityPool(IShareToken shareToken, ISecurityPool parent, OpenOraclePriceCoordinator openOraclePriceCoordinator, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps) private returns (ISecurityPool securityPool) {
		securityPool = securityPoolDeployer.deploy(address(securityPoolForker), questionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps);

		openOraclePriceCoordinatorFactory.configureSecurityPool(openOraclePriceCoordinator, securityPool);
	}

	/// @notice Initialize a portfolio's oracle configuration without a standalone question pool.
	/// @dev The first call registers the caller for enumeration; registration does not authenticate the portfolio.
	function initializePortfolioPriceFeed(uint248 universeId, uint256 priorityFee) external returns (address) {
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
	function preparePortfolioChildPriceFeed(ISecurityPool parent, uint256 outcomeIndex) external returns (address) {
		uint248 parentUniverseId = parent.universeId();
		require(address(poolRegistrations[getPoolId(poolMetadata[parent].originId, parentUniverseId)].pool) == address(parent), 'Parent pool is not canonical');
		address portfolio = poolMetadata[parent].portfolio;
		require(portfolio != address(0), 'Parent has no portfolio');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		return address(_getOrCreateSharedPriceFeed(parent.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare one known portfolio branch without materializing its ancestor questions.
	function preparePortfolioPriceFeed(ISecurityPool source, uint248 universeId) external returns (address) {
		address portfolio = poolMetadata[source].portfolio;
		require(portfolio != address(0), 'Source has no portfolio');
		require(address(poolRegistrations[getPoolId(poolMetadata[source].originId, source.universeId())].pool) == address(source), 'Source pool is not canonical');
		ISecurityPoolPortfolioNative(portfolio).portfolioTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(source.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare the canonical child coordinator without exposing a partial child ledger.
	function prepareChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external returns (OpenOraclePriceCoordinator coordinator) {
		uint248 parentUniverseId = parent.universeId();
		require(address(poolRegistrations[getPoolId(poolMetadata[parent].originId, parentUniverseId)].pool) == address(parent), 'Parent pool is not canonical');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		address portfolio = poolMetadata[parent].portfolio;
		require(portfolio != address(0), 'Portfolio missing');
		require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		return _prepareChildPoolDependencies(parent, universeId);
	}

	function getChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external view returns (OpenOraclePriceCoordinator coordinator) {
		return
			childPoolCoordinators[
				getPoolId(poolMetadata[parent].originId, zoltar.getChildUniverseId(parent.universeId(), outcomeIndex))
			];
	}

	function _prepareChildPoolDependencies(ISecurityPool parent, uint248 universeId) private returns (OpenOraclePriceCoordinator coordinator) {
		bytes32 poolId = getPoolId(poolMetadata[parent].originId, universeId);
		coordinator = childPoolCoordinators[poolId];
		if (address(coordinator) != address(0)) return coordinator;
		uint256 priorityFee = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		bytes32 salt = keccak256(abi.encode(parent, universeId, parent.questionId(), parent.statoblastSecurityMultiplierBps(), priorityFee));
		coordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, zoltar.getRepToken(universeId), priorityFee, salt);
		childPoolCoordinators[poolId] = coordinator;
	}

	function _getOrCreateSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private returns (SharedPoolPriceFeed feed) {
		feed = SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][universeId]));
		if (address(feed) == address(0)) {
			feed = openOraclePriceCoordinatorFactory.deploySharedPoolPriceFeed(coordinator, portfolio, universeId, zoltar.getRepToken(universeId), keccak256(abi.encode(portfolio, universeId)));
			sharedPriceFeeds[portfolio][universeId] = address(feed);
		}
	}

	function _configureSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private {
		openOraclePriceCoordinatorFactory.configureSharedPriceFeed(coordinator, _getOrCreateSharedPriceFeed(coordinator, portfolio, universeId));
	}

	function _initializeSecurityPool(ISecurityPool securityPool, OpenOraclePriceCoordinator coordinator, address portfolio) private {
		SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][securityPool.universeId()])).registerCoordinator(address(coordinator));
		securityPool.setStartingParams();
	}

	function _getInitialEscalationDepositAttoRep(uint248 universeId) private view returns (uint256 initialDepositAttoRep) {
		return
			SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(zoltar.getUniverseTheoreticalSupplyAttoRep(universeId));
	}
}
