// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { CreationCodeStorage } from '../CreationCodeStorage.sol';
import { OraclePriceMath } from '../OraclePriceMath.sol';
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { IQuestionLedger } from '../interfaces/IQuestionLedger.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { Create2Deployment } from './Create2Deployment.sol';
import { SecurityPoolBoundClones } from '../SecurityPoolBoundClones.sol';
import { SharedPoolPriceFeed, ISharedPoolPriceCoordinator } from '../SharedPoolPriceFeed.sol';
import { OpenOracleReportDelegate } from '../OpenOracleReportDelegate.sol';

contract PriceCoordinatorDeploymentWorker {
	OpenOracleReportDelegate public immutable reportDelegate;
	mapping(address => address) private deployers;
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor() {
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(OpenOraclePriceCoordinator).creationCode);
		reportDelegate = new OpenOracleReportDelegate();
	}

	function deploy(bytes calldata constructorArguments, bytes32 salt) external returns (OpenOraclePriceCoordinator) {
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), constructorArguments, abi.encode(reportDelegate));
		address deployed = Create2Deployment.deploy(initCode, keccak256(abi.encode(msg.sender, salt)));
		require(deployed != address(0), 'Price coordinator deployment failed');
		deployers[deployed] = msg.sender;
		return OpenOraclePriceCoordinator(deployed);
	}

	function configureQuestionLedger(OpenOraclePriceCoordinator coordinator, IQuestionLedger pool) external {
		require(deployers[address(coordinator)] == msg.sender, 'Only coordinator factory');
		coordinator.setQuestionLedger(pool);
	}

	function configureSharedPriceFeed(OpenOraclePriceCoordinator coordinator, address feed) external {
		require(deployers[address(coordinator)] == msg.sender, 'Only coordinator factory');
		coordinator.setSharedPriceFeed(SharedPoolPriceFeed(payable(feed)));
	}
}

contract SharedPoolPriceFeedDeploymentWorker {
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor() {
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(SharedPoolPriceFeed).creationCode);
	}

	function deployImplementation(address coordinator, address securityPoolFactory, address securityPool) external returns (SharedPoolPriceFeed) {
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), abi.encode(ISharedPoolPriceCoordinator(coordinator), securityPoolFactory, securityPool));
		address deployed = Create2Deployment.deploy(initCode, keccak256(abi.encode(msg.sender, securityPoolFactory, securityPool)));
		require(deployed != address(0), 'Shared feed implementation deployment failed');
		return SharedPoolPriceFeed(deployed);
	}

	function deployClone(SharedPoolPriceFeed implementation, uint248 universeId, ReputationToken reputationToken, bytes32 salt) external returns (SharedPoolPriceFeed) {
		require(address(reputationToken) != address(0), 'REP token missing');
		bytes memory initCode = SecurityPoolBoundClones.initCode(address(implementation), abi.encodePacked(universeId, address(reputationToken)));
		address deployed = Create2Deployment.deploy(initCode, keccak256(abi.encode(msg.sender, salt)));
		require(deployed != address(0), 'Shared price feed deployment failed');
		return SharedPoolPriceFeed(deployed);
	}
}

contract OpenOraclePriceCoordinatorFactory {
	PriceCoordinatorDeploymentWorker private immutable priceCoordinatorDeploymentWorker;
	SharedPoolPriceFeedDeploymentWorker private immutable sharedPoolPriceFeedDeploymentWorker;
	mapping(address => address) private coordinatorDeployers;
	mapping(address => address) private feedDeployers;
	/// @dev Coordinator deployers own independent security pool namespaces.
	mapping(address => mapping(address => SharedPoolPriceFeed)) public sharedPriceFeedImplementations;
	IWeth9 public immutable weth;
	uint256 public immutable targetPriceErrorForDispute;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public immutable minLiquidationPriceDistanceBps;

	constructor(IWeth9 _weth, uint256 _targetPriceErrorForDispute, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, PriceCoordinatorDeploymentWorker _priceCoordinatorDeploymentWorker, SharedPoolPriceFeedDeploymentWorker _sharedPoolPriceFeedDeploymentWorker) {
		require(address(_priceCoordinatorDeploymentWorker).code.length != 0 && address(_sharedPoolPriceFeedDeploymentWorker).code.length != 0, 'Deployment workers missing');
		priceCoordinatorDeploymentWorker = _priceCoordinatorDeploymentWorker;
		sharedPoolPriceFeedDeploymentWorker = _sharedPoolPriceFeedDeploymentWorker;
		weth = _weth;
		targetPriceErrorForDispute = _targetPriceErrorForDispute;
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	function maximumReportPriorityFeeAttoEthPerGas() external view returns (uint256) {
		return
			OraclePriceMath.maximumPriorityFee(targetPriceErrorForDispute, protocolFee, feePercentage, escalationHaltMultiplierBps);
	}

	function deployOpenOraclePriceCoordinator(OpenOracle _openOracle, ReputationToken _reputationToken, uint256 _initialReportPriorityFeeAttoEthPerGas, bytes32 salt) external returns (OpenOraclePriceCoordinator) {
		bytes32 deploymentSalt = keccak256(abi.encode(msg.sender, salt));
		OpenOraclePriceCoordinator coordinator = priceCoordinatorDeploymentWorker.deploy(abi.encode(_openOracle, _reputationToken, weth, _initialReportPriorityFeeAttoEthPerGas, targetPriceErrorForDispute, settlementTime, disputeDelay, protocolFee, feePercentage, multiplier, protocolFeeRecipient, escalationHaltMultiplierBps, maxSettlementBaseFeeMultiplierBps, minLiquidationPriceDistanceBps), deploymentSalt);
		coordinatorDeployers[address(coordinator)] = msg.sender;
		return coordinator;
	}

	function deploySharedPoolPriceFeed(OpenOraclePriceCoordinator coordinator, address securityPool, uint248 universeId, ReputationToken reputationToken, bytes32 salt) external returns (SharedPoolPriceFeed feed) {
		require(coordinatorDeployers[address(coordinator)] == msg.sender, 'Only coordinator deployer');
		SharedPoolPriceFeed implementation = sharedPriceFeedImplementations[msg.sender][securityPool];
		if (address(implementation) == address(0)) {
			implementation = sharedPoolPriceFeedDeploymentWorker.deployImplementation(address(coordinator), msg.sender, securityPool);
			sharedPriceFeedImplementations[msg.sender][securityPool] = implementation;
		}
		feed = sharedPoolPriceFeedDeploymentWorker.deployClone(implementation, universeId, reputationToken, keccak256(abi.encode(msg.sender, salt)));
		feedDeployers[address(feed)] = msg.sender;
	}

	function configureQuestionLedger(OpenOraclePriceCoordinator coordinator, IQuestionLedger pool) external {
		require(coordinatorDeployers[address(coordinator)] == msg.sender, 'Only coordinator deployer');
		priceCoordinatorDeploymentWorker.configureQuestionLedger(coordinator, pool);
	}

	function configureSharedPriceFeed(OpenOraclePriceCoordinator coordinator, SharedPoolPriceFeed feed) external {
		require(coordinatorDeployers[address(coordinator)] == msg.sender, 'Only coordinator deployer');
		require(feedDeployers[address(feed)] == msg.sender, 'Shared feed deployer mismatch');
		priceCoordinatorDeploymentWorker.configureSharedPriceFeed(coordinator, address(feed));
	}
}
