// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { CreationCodeDeployer, CreationCodeStorage } from '../CreationCodeStorage.sol';
import { OraclePriceMath } from '../OraclePriceMath.sol';
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { SecurityPoolBoundClones } from '../SecurityPoolBoundClones.sol';
import { SharedPoolPriceFeed, ISharedPoolPriceFeedConfig } from '../SharedPoolPriceFeed.sol';
import { SecurityPoolUtils } from '../SecurityPoolUtils.sol';

contract SharedPoolPriceFeedDeploymentWorker is CreationCodeDeployer {
	constructor() CreationCodeDeployer(type(SharedPoolPriceFeed).creationCode) {}

	function deployImplementation(ISharedPoolPriceFeedConfig config, OpenOracle oracle, uint256 priorityFee, address securityPoolFactory, address securityPool) external returns (SharedPoolPriceFeed) {
		return
			SharedPoolPriceFeed(_deploy2(abi.encode(config, oracle, priorityFee, securityPoolFactory, securityPool), keccak256(abi.encode(msg.sender, securityPoolFactory, securityPool))));
	}

	function deployClone(SharedPoolPriceFeed implementation, uint248 universeId, ReputationToken reputationToken, bytes32 salt) external returns (SharedPoolPriceFeed) {
		require(address(reputationToken) != address(0), 'REP token missing');
		bytes memory initCode = SecurityPoolBoundClones.initCode(address(implementation), abi.encodePacked(universeId, address(reputationToken)));
		return SharedPoolPriceFeed(CreationCodeStorage.deploy2(initCode, keccak256(abi.encode(msg.sender, salt))));
	}
}

contract SharedPoolPriceFeedFactory {
	SharedPoolPriceFeedDeploymentWorker private immutable sharedPoolPriceFeedDeploymentWorker;
	/// @dev Feed deployers own independent security pool namespaces.
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

	constructor(IWeth9 _weth, uint256 _targetPriceErrorForDispute, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, SharedPoolPriceFeedDeploymentWorker _sharedPoolPriceFeedDeploymentWorker) {
		require(address(_sharedPoolPriceFeedDeploymentWorker).code.length != 0, 'Deployment workers missing');
		sharedPoolPriceFeedDeploymentWorker = _sharedPoolPriceFeedDeploymentWorker;
		require(_targetPriceErrorForDispute < 10_000_000, 'Target price error must be below one hundred percent');
		OraclePriceMath.maximumPriorityFee(_targetPriceErrorForDispute, _protocolFee, _feePercentage, _escalationHaltMultiplierBps, _maxSettlementBaseFeeMultiplierBps);
		require(_settlementTime > _disputeDelay, 'Settlement time must exceed dispute delay');
		require(_multiplier >= 100, 'Oracle dispute multiplier must be at least one hundred percent');
		require(_maxSettlementBaseFeeMultiplierBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'Max settlement base fee multiplier must be at least one hundred percent');
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
	}

	function maximumReportPriorityFeeAttoEthPerGas() external view returns (uint256) {
		return
			OraclePriceMath.maximumPriorityFee(targetPriceErrorForDispute, protocolFee, feePercentage, escalationHaltMultiplierBps, maxSettlementBaseFeeMultiplierBps);
	}

	function deploySharedPoolPriceFeed(OpenOracle oracle, uint256 priorityFee, address securityPool, uint248 universeId, ReputationToken reputationToken, bytes32 salt) external returns (SharedPoolPriceFeed feed) {
		SharedPoolPriceFeed implementation = sharedPriceFeedImplementations[msg.sender][securityPool];
		if (address(implementation) == address(0)) {
			implementation = sharedPoolPriceFeedDeploymentWorker.deployImplementation(ISharedPoolPriceFeedConfig(address(this)), oracle, priorityFee, msg.sender, securityPool);
			sharedPriceFeedImplementations[msg.sender][securityPool] = implementation;
		}
		feed = sharedPoolPriceFeedDeploymentWorker.deployClone(implementation, universeId, reputationToken, keccak256(abi.encode(msg.sender, salt)));
	}
}
