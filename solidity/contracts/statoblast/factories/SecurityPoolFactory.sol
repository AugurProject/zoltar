// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { ZoltarQuestionData } from '../../ZoltarQuestionData.sol';
import { ISecurityPoolPortfolioNative } from '../interfaces/ISecurityPoolPortfolioNative.sol';
import { SecurityPool } from '../SecurityPool.sol';
import { ISecurityPool, ISecurityPoolFactory, SystemState } from '../interfaces/ISecurityPool.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { Zoltar } from '../../Zoltar.sol';
import { ShareTokenFactory } from './ShareTokenFactory.sol';
import { UniformPriceDualCapBatchAuctionFactory } from './UniformPriceDualCapBatchAuctionFactory.sol';
import { UniformPriceDualCapBatchAuction } from '../UniformPriceDualCapBatchAuction.sol';
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
	UniformPriceDualCapBatchAuctionFactory immutable uniformPriceDualCapBatchAuctionFactory;
	OpenOraclePriceCoordinatorFactory immutable openOraclePriceCoordinatorFactory;
	Zoltar immutable zoltar;
	OpenOracle immutable openOracle;
	EscalationGameFactory immutable escalationGameFactory;
	ZoltarQuestionData immutable questionData;
	ISecurityPoolForker immutable securityPoolForker;
	SecurityPoolDeployer immutable securityPoolDeployer;
	uint256 public immutable override minimumSecurityBondDebtAttoEth;
	uint256 public immutable override minimumVaultRepDepositAttoRep;
	SecurityPoolDeployment[] private securityPoolDeployments;
	// Pool ID from getPoolId(originId, universeId) -> the registered pool.
	mapping(bytes32 => ISecurityPool) private securityPoolsById;
	// The same pool ID -> whether its deployment slot has been reserved.
	mapping(bytes32 => bool) private securityPoolIdClaims;
	mapping(ISecurityPool => bytes32) private securityPoolOriginIds;
	mapping(ISecurityPool => bool) private securityPoolHasInheritedForkOutcome;
	mapping(ISecurityPool => address) private securityPoolPortfolios;
	mapping(address => mapping(uint248 => address)) public sharedPriceFeeds;
	struct ChildPoolDependencies {
		OpenOraclePriceCoordinator coordinator;
		UniformPriceDualCapBatchAuction auction;
	}
	mapping(bytes32 => ChildPoolDependencies) private childPoolDependencies;

	event DeploySecurityPool(ISecurityPool indexed securityPool, UniformPriceDualCapBatchAuction truthAuction, OpenOraclePriceCoordinator openOraclePriceCoordinator, IShareToken shareToken, ISecurityPool indexed parent, uint248 indexed universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth);
	event SecurityPoolRegistered(bytes32 indexed originId, bytes32 indexed poolId, uint248 indexed universeId, ISecurityPool securityPool);

	constructor(ISecurityPoolForker _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOracle _openOracle, Zoltar _zoltar, ShareTokenFactory _shareTokenFactory, UniformPriceDualCapBatchAuctionFactory _uniformPriceDualCapBatchAuctionFactory, OpenOraclePriceCoordinatorFactory _openOraclePriceCoordinatorFactory, uint256 _minimumSecurityBondDebtAttoEth, uint256 _minimumVaultRepDepositAttoRep, address operationsDelegate, SecurityPoolEventEmitter eventEmitter) {
		securityPoolForker = _securityPoolForker;
		shareTokenFactory = _shareTokenFactory;
		uniformPriceDualCapBatchAuctionFactory = _uniformPriceDualCapBatchAuctionFactory;
		openOraclePriceCoordinatorFactory = _openOraclePriceCoordinatorFactory;
		zoltar = _zoltar;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		questionData = _questionData;
		require(_minimumSecurityBondDebtAttoEth > 0, 'Minimum security bond debt zero');
		minimumSecurityBondDebtAttoEth = _minimumSecurityBondDebtAttoEth;
		minimumVaultRepDepositAttoRep = _minimumVaultRepDepositAttoRep;
		require(operationsDelegate != address(0), 'Operations delegate zero');
		require(operationsDelegate.code.length != 0, 'Operations delegate has no code');
		require(address(eventEmitter).code.length != 0, 'Accounting delegate has no code');
		securityPoolDeployer = new SecurityPoolDeployer(operationsDelegate, eventEmitter);
	}

	function securityPoolDeploymentCount() external view returns (uint256) {
		return securityPoolDeployments.length;
	}

	function getSecurityPool(bytes32 originId, uint248 universeId) external view returns (ISecurityPool) {
		return securityPoolsById[getPoolId(originId, universeId)];
	}

	function getSecurityPoolOriginId(ISecurityPool securityPool) external view returns (bytes32) {
		return securityPoolOriginIds[securityPool];
	}

	function getSecurityPoolHasInheritedForkOutcome(ISecurityPool securityPool) external view returns (bool) {
		return securityPoolHasInheritedForkOutcome[securityPool];
	}

	function getOriginId(uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, originUniverseId));
	}

	function getPortfolioOriginId(address portfolio, uint248 originUniverseId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) public pure returns (bytes32) {
		return
			keccak256(abi.encode(keccak256('Statoblast portfolio origin'), portfolio, originUniverseId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas));
	}

	function getSecurityPoolPortfolio(ISecurityPool securityPool) external view returns (address) {
		return securityPoolPortfolios[securityPool];
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

	function deployChildSecurityPool(ISecurityPool parent, IShareToken shareToken, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) external returns (ISecurityPool securityPool, UniformPriceDualCapBatchAuction truthAuction) {
		require(msg.sender == address(securityPoolForker), 'Only security pool forker');
		bytes32 originId = securityPoolOriginIds[parent];
		require(address(securityPoolsById[getPoolId(originId, parent.universeId())]) == address(parent), 'Parent pool is not canonical');
		address portfolio = securityPoolPortfolios[parent];
		if (portfolio != address(0))
			require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		bool hasInheritedForkOutcome =
			securityPoolHasInheritedForkOutcome[parent] || zoltar.forkQuestionMatches(parent.universeId(), questionId);
		if (portfolio != address(0))
			(hasInheritedForkOutcome, ) = ISecurityPoolPortfolioNative(portfolio).inheritedFixedOutcome(universeId, questionId);
		require(address(parent.shareToken()) == address(shareToken), 'Child share token mismatch');
		uint256 initialReportPriorityFeeAttoEthPerGas = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		_reserveSecurityPool(originId, universeId);
		OpenOraclePriceCoordinator openOraclePriceCoordinator;
		(openOraclePriceCoordinator, truthAuction) = _prepareChildPoolDependencies(parent, universeId);
		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);
		securityPool = deploySecurityPool(shareToken, parent, openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps, address(truthAuction));
		_registerSecurityPool(originId, universeId, securityPool, hasInheritedForkOutcome, portfolio);
		_initializeSecurityPool(securityPool, openOraclePriceCoordinator, portfolio, currentRetentionRate, settlementCollateralAttoEth);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, truthAuction, openOraclePriceCoordinator, shareToken, parent, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, currentRetentionRate, settlementCollateralAttoEth));
	}

	function deployOriginSecurityPool(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (ISecurityPool securityPool) {
		return
			_deployOriginSecurityPool(address(0), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	/// @notice Deploy in the caller's own namespace; another caller can never add a ledger to it.
	function deployPortfolioSecurityPool(uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) external returns (ISecurityPool securityPool) {
		return
			_deployOriginSecurityPool(msg.sender, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
	}

	function _deployOriginSecurityPool(address portfolio, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, uint256 initialReportPriorityFeeAttoEthPerGas) private returns (ISecurityPool securityPool) {
		// Origin pool deployment is intentionally public, so first deployers must not be able to
		// lock unsafe economic parameters into the canonical pool for a question/multiplier/
		// priority-fee configuration.
		// Zero-utilization origin pools always start at the protocol retention curve's maximum rate.
		require(statoblastSecurityMultiplierBps > SecurityPoolUtils.BPS_DENOMINATOR + 1, 'Multiplier must exceed 10001 BPS');

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
		bytes32 originId =
			portfolio == address(0)
				? getOriginId(universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas)
				: getPortfolioOriginId(portfolio, universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
		_reserveSecurityPool(originId, universeId);
		bytes32 securityPoolSalt =
			portfolio == address(0)
				? keccak256(abi.encode(address(0x0), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas))
				: originId;
		OpenOraclePriceCoordinator openOraclePriceCoordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, reputationToken, initialReportPriorityFeeAttoEthPerGas, securityPoolSalt);

		_configureSharedPriceFeed(openOraclePriceCoordinator, portfolio, universeId);

		// Each origin lineage has its own share token, which is reused by all migrated children.
		IShareToken shareToken = shareTokenFactory.deployShareToken(originId, questionId);
		uint256 initialRetentionRate = SecurityPoolUtils.calculateRetentionRate(0, 0);
		securityPool = deploySecurityPool(shareToken, ISecurityPool(payable(address(0))), openOraclePriceCoordinator, universeId, questionId, statoblastSecurityMultiplierBps, address(0));

		_registerSecurityPool(originId, universeId, securityPool, false, portfolio);
		_initializeSecurityPool(securityPool, openOraclePriceCoordinator, portfolio, initialRetentionRate, 0);
		shareToken.authorize(securityPool);
		_recordSecurityPoolDeployment(SecurityPoolDeployment(securityPool, UniformPriceDualCapBatchAuction(address(0)), openOraclePriceCoordinator, shareToken, ISecurityPool(payable(address(0))), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas, initialRetentionRate, 0));
	}

	function _reserveSecurityPool(bytes32 originId, uint248 universeId) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(!securityPoolIdClaims[poolId], 'Security pool origin and universe already claimed');
		securityPoolIdClaims[poolId] = true;
	}

	function _registerSecurityPool(bytes32 originId, uint248 universeId, ISecurityPool securityPool, bool hasInheritedForkOutcome, address portfolio) private {
		bytes32 poolId = getPoolId(originId, universeId);
		require(address(securityPoolsById[poolId]) == address(0x0), 'Pool already registered');
		securityPoolsById[poolId] = securityPool;
		securityPoolOriginIds[securityPool] = originId;
		securityPoolHasInheritedForkOutcome[securityPool] = hasInheritedForkOutcome;
		securityPoolPortfolios[securityPool] = portfolio;
		emit SecurityPoolRegistered(originId, poolId, universeId, securityPool);
	}

	function _recordSecurityPoolDeployment(SecurityPoolDeployment memory deployment) private {
		securityPoolDeployments.push(deployment);
		emit DeploySecurityPool(deployment.securityPool, deployment.truthAuction, deployment.openOraclePriceCoordinator, deployment.shareToken, deployment.parent, deployment.universeId, deployment.questionId, deployment.statoblastSecurityMultiplierBps, deployment.initialReportPriorityFeeAttoEthPerGas, deployment.currentRetentionRate, deployment.settlementCollateralAttoEth);
	}

	function deploySecurityPool(IShareToken shareToken, ISecurityPool parent, OpenOraclePriceCoordinator openOraclePriceCoordinator, uint248 universeId, uint256 questionId, uint256 statoblastSecurityMultiplierBps, address truthAuction) private returns (ISecurityPool securityPool) {
		securityPool = securityPoolDeployer.deploy(address(securityPoolForker), questionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps, truthAuction);

		openOraclePriceCoordinatorFactory.configureSecurityPool(openOraclePriceCoordinator, securityPool);
	}

	/// @notice Predeploy the caller's origin feed so pool creation and ledger admission fit separate transactions.
	function initializePortfolioPriceFeed(ISecurityPool configurationSeed) external returns (address) {
		uint248 universeId = configurationSeed.universeId();
		bytes32 originId = securityPoolOriginIds[configurationSeed];
		require(address(securityPoolsById[getPoolId(originId, universeId)]) == address(configurationSeed), 'Seed pool is not canonical');
		require(address(configurationSeed.parent()) == address(0), 'Choose an origin pool');
		return
			address(_getOrCreateSharedPriceFeed(configurationSeed.openOraclePriceCoordinator(), msg.sender, universeId));
	}

	/// @notice Initialize the caller's known branch feed from a canonical configuration seed.
	function initializePortfolioPriceFeedForUniverse(ISecurityPool configurationSeed, uint248 universeId) external returns (address) {
		bytes32 originId = securityPoolOriginIds[configurationSeed];
		require(address(securityPoolsById[getPoolId(originId, configurationSeed.universeId())]) == address(configurationSeed), 'Seed pool is not canonical');
		ISecurityPoolPortfolioNative(msg.sender).logicalTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return
			address(_getOrCreateSharedPriceFeed(configurationSeed.openOraclePriceCoordinator(), msg.sender, universeId));
	}

	/// @notice Prepare child REP and its shared feed independently of the more expensive ledger migration.
	/// @dev Anyone may prepare; the canonical forked parent fixes all namespace and oracle configuration.
	function preparePortfolioChildPriceFeed(ISecurityPool parent, uint256 outcomeIndex) external returns (address) {
		uint248 parentUniverseId = parent.universeId();
		require(address(securityPoolsById[getPoolId(securityPoolOriginIds[parent], parentUniverseId)]) == address(parent), 'Parent pool is not canonical');
		address portfolio = securityPoolPortfolios[parent];
		require(portfolio != address(0), 'Parent has no portfolio');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		return address(_getOrCreateSharedPriceFeed(parent.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare one known portfolio branch without materializing its ancestor questions.
	function preparePortfolioPriceFeed(ISecurityPool source, uint248 universeId) external returns (address) {
		address portfolio = securityPoolPortfolios[source];
		require(portfolio != address(0), 'Source has no portfolio');
		require(address(securityPoolsById[getPoolId(securityPoolOriginIds[source], source.universeId())]) == address(source), 'Source pool is not canonical');
		ISecurityPoolPortfolioNative(portfolio).logicalTime(universeId);
		require(address(zoltar.getRepToken(universeId)) != address(0), 'Branch REP is missing');
		return address(_getOrCreateSharedPriceFeed(source.openOraclePriceCoordinator(), portfolio, universeId));
	}

	/// @notice Prepare canonical coordinator and auction dependencies without exposing a partial child ledger.
	function prepareChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external returns (OpenOraclePriceCoordinator coordinator, UniformPriceDualCapBatchAuction auction) {
		uint248 parentUniverseId = parent.universeId();
		require(address(securityPoolsById[getPoolId(securityPoolOriginIds[parent], parentUniverseId)]) == address(parent), 'Parent pool is not canonical');
		require(parent.systemState() == SystemState.PoolForked, 'Parent not forked');
		uint248 universeId = zoltar.getChildUniverseId(parentUniverseId, outcomeIndex);
		if (address(zoltar.getRepToken(universeId)) == address(0)) zoltar.deployChild(parentUniverseId, outcomeIndex);
		address portfolio = securityPoolPortfolios[parent];
		if (portfolio != address(0))
			require(sharedPriceFeeds[portfolio][universeId] != address(0), 'Prepare shared child price feed');
		return _prepareChildPoolDependencies(parent, universeId);
	}

	function getChildPoolDependencies(ISecurityPool parent, uint256 outcomeIndex) external view returns (OpenOraclePriceCoordinator coordinator, UniformPriceDualCapBatchAuction auction) {
		ChildPoolDependencies storage dependencies = childPoolDependencies[
			getPoolId(securityPoolOriginIds[parent], zoltar.getChildUniverseId(parent.universeId(), outcomeIndex))
		];
		return (dependencies.coordinator, dependencies.auction);
	}

	function _prepareChildPoolDependencies(ISecurityPool parent, uint248 universeId) private returns (OpenOraclePriceCoordinator coordinator, UniformPriceDualCapBatchAuction auction) {
		bytes32 poolId = getPoolId(securityPoolOriginIds[parent], universeId);
		ChildPoolDependencies storage dependencies = childPoolDependencies[poolId];
		if (address(dependencies.coordinator) != address(0)) return (dependencies.coordinator, dependencies.auction);
		uint256 priorityFee = parent.openOraclePriceCoordinator().initialReportPriorityFeeAttoEthPerGas();
		bytes32 salt = keccak256(abi.encode(parent, universeId, parent.questionId(), parent.statoblastSecurityMultiplierBps(), priorityFee));
		coordinator = openOraclePriceCoordinatorFactory.deployOpenOraclePriceCoordinator(openOracle, zoltar.getRepToken(universeId), priorityFee, salt);
		if (securityPoolPortfolios[parent] == address(0))
			auction = uniformPriceDualCapBatchAuctionFactory.deployUniformPriceDualCapBatchAuction(address(securityPoolForker), salt);
		dependencies.coordinator = coordinator;
		dependencies.auction = auction;
	}

	function _getOrCreateSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private returns (SharedPoolPriceFeed feed) {
		feed = SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][universeId]));
		if (address(feed) == address(0)) {
			feed = openOraclePriceCoordinatorFactory.deploySharedPoolPriceFeed(coordinator, portfolio, universeId, zoltar.getRepToken(universeId), keccak256(abi.encode(portfolio, universeId)));
			sharedPriceFeeds[portfolio][universeId] = address(feed);
		}
	}

	function _configureSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address portfolio, uint248 universeId) private {
		if (portfolio == address(0)) return;
		openOraclePriceCoordinatorFactory.configureSharedPriceFeed(coordinator, _getOrCreateSharedPriceFeed(coordinator, portfolio, universeId));
	}

	function _initializeSecurityPool(ISecurityPool securityPool, OpenOraclePriceCoordinator coordinator, address portfolio, uint256 currentRetentionRate, uint256 settlementCollateralAttoEth) private {
		if (portfolio != address(0))
			SharedPoolPriceFeed(payable(sharedPriceFeeds[portfolio][securityPool.universeId()])).registerCoordinator(address(coordinator));
		securityPool.setStartingParams(currentRetentionRate, settlementCollateralAttoEth);
	}

	function _getInitialEscalationDepositAttoRep(uint248 universeId) private view returns (uint256 initialDepositAttoRep) {
		return
			SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(zoltar.getUniverseTheoreticalSupplyAttoRep(universeId));
	}
}
