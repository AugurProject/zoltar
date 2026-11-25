// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { CreationCodeStorage } from '../CreationCodeStorage.sol';
import { OraclePriceMath } from '../OraclePriceMath.sol';
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { Create2Deployment } from './Create2Deployment.sol';
import { SecurityPoolBoundClones } from '../SecurityPoolBoundClones.sol';
import { SharedPoolPriceFeed, ISharedPoolPriceFeedConfiguration } from '../SharedPoolPriceFeed.sol';

contract SharedPoolPriceFeedDeploymentWorker {
	address private immutable creationCodeFirstChunk;
	address private immutable creationCodeSecondChunk;

	constructor() {
		(creationCodeFirstChunk, creationCodeSecondChunk) = CreationCodeStorage.store(type(SharedPoolPriceFeed).creationCode);
	}

	function deployImplementation(OpenOracle oracle, uint256 priorityFee, address configuration, address securityPoolFactory, address securityPool) external returns (SharedPoolPriceFeed) {
		bytes memory initCode = abi.encodePacked(CreationCodeStorage.load(creationCodeFirstChunk, creationCodeSecondChunk), abi.encode(ISharedPoolPriceFeedConfiguration(configuration), oracle, priorityFee, securityPoolFactory, securityPool));
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

contract SharedPoolPriceFeedFactory {
	SharedPoolPriceFeedDeploymentWorker private immutable sharedPoolPriceFeedDeploymentWorker;
	/// @dev Root factories own independent security pool namespaces.
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

	constructor(IWeth9 _weth, uint256 _targetPriceErrorForDispute, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, SharedPoolPriceFeedDeploymentWorker _sharedPoolPriceFeedDeploymentWorker) {
		require(address(_sharedPoolPriceFeedDeploymentWorker).code.length != 0, 'Deployment workers missing');
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

	/// @notice Deploy the canonical feed implementation once per caller/pool, then bind a universe clone.
	function deploySharedPoolPriceFeed(OpenOracle oracle, uint256 priorityFee, address securityPool, uint248 universeId, ReputationToken reputationToken, bytes32 salt) external returns (SharedPoolPriceFeed feed) {
		SharedPoolPriceFeed implementation = sharedPriceFeedImplementations[msg.sender][securityPool];
		if (address(implementation) == address(0)) {
			implementation = sharedPoolPriceFeedDeploymentWorker.deployImplementation(oracle, priorityFee, address(this), msg.sender, securityPool);
			sharedPriceFeedImplementations[msg.sender][securityPool] = implementation;
		}
		feed = sharedPoolPriceFeedDeploymentWorker.deployClone(implementation, universeId, reputationToken, keccak256(abi.encode(msg.sender, salt)));
	}
}
