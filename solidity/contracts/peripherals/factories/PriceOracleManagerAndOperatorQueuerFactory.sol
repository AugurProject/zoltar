// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { LiquidationApprovalRegistry } from '../LiquidationApprovalRegistry.sol';

contract LiquidationApprovalRegistryDeployer {
	address private immutable factory;
	LiquidationApprovalRegistry private immutable implementation;

	constructor() {
		factory = msg.sender;
		implementation = new LiquidationApprovalRegistry();
	}

	function deploy(address coordinator, bytes32 salt) external returns (LiquidationApprovalRegistry) {
		require(msg.sender == factory, 'Only factory');
		bytes memory initCode = abi.encodePacked(
			hex'3d602d80600a3d3981f3',
			hex'363d3d373d3d3d363d73',
			address(implementation),
			hex'5af43d82803e903d91602b57fd5bf3'
		);
		address deployed;
		assembly ('memory-safe') {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
		}
		require(deployed != address(0), 'Registry deployment failed');
		LiquidationApprovalRegistry registry = LiquidationApprovalRegistry(deployed);
		registry.initialize(coordinator);
		return registry;
	}
}

contract PriceCoordinatorDeploymentWorker {
	address private immutable factory;
	bytes private creationCode;

	constructor() {
		factory = msg.sender;
		creationCode = type(OpenOraclePriceCoordinator).creationCode;
	}

	function deploy(bytes calldata constructorArguments, bytes32 salt) external returns (OpenOraclePriceCoordinator) {
		require(msg.sender == factory, 'Only factory');
		bytes memory initCode = abi.encodePacked(creationCode, constructorArguments);
		address deployed;
		assembly ('memory-safe') {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(deployed) {
				returndatacopy(0, 0, returndatasize())
				revert(0, returndatasize())
			}
		}
		return OpenOraclePriceCoordinator(deployed);
	}

	function configureLiquidationApprovalRegistry(
		OpenOraclePriceCoordinator coordinator,
		LiquidationApprovalRegistry registry
	) external {
		require(msg.sender == factory, 'Only factory');
		coordinator.setLiquidationApprovalRegistry(registry);
	}
}

contract PriceOracleManagerAndOperatorQueuerFactory {
	LiquidationApprovalRegistryDeployer private immutable liquidationApprovalRegistryDeployer;
	PriceCoordinatorDeploymentWorker private immutable priceCoordinatorDeploymentWorker;
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable gasUnitsForOneDispute;
	uint256 public immutable targetPriceErrorForDispute;
	uint256 public immutable openOracleSecurityMultiplierBps;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	bool public immutable timeType;
	bool public immutable trackDisputes;
	address public immutable protocolFeeRecipient;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public immutable minLiquidationPriceDistanceBps;

	constructor(
		IWeth9 _weth,
		uint256 _gasConsumedOpenOracleReportPrice,
		uint32 _gasConsumedSettlement,
		uint256 _gasUnitsForOneDispute,
		uint256 _targetPriceErrorForDispute,
		uint256 _openOracleSecurityMultiplierBps,
		uint48 _settlementTime,
		uint24 _disputeDelay,
		uint24 _protocolFee,
		uint24 _feePercentage,
		uint16 _multiplier,
		bool _timeType,
		bool _trackDisputes,
		address _protocolFeeRecipient,
		uint256 _escalationHaltMultiplierBps,
		uint256 _maxSettlementBaseFeeMultiplierBps,
		uint256 _minLiquidationPriceDistanceBps
	) {
		liquidationApprovalRegistryDeployer = new LiquidationApprovalRegistryDeployer();
		priceCoordinatorDeploymentWorker = new PriceCoordinatorDeploymentWorker();
		weth = _weth;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		gasUnitsForOneDispute = _gasUnitsForOneDispute;
		targetPriceErrorForDispute = _targetPriceErrorForDispute;
		openOracleSecurityMultiplierBps = _openOracleSecurityMultiplierBps;
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		timeType = _timeType;
		trackDisputes = _trackDisputes;
		protocolFeeRecipient = _protocolFeeRecipient;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	function deployPriceOracleManagerAndOperatorQueuer(
		OpenOracle _openOracle,
		ReputationToken _reputationToken,
		uint256 _initialReportPriorityFeeAttoEthPerGas,
		bytes32 salt
	) external returns (OpenOraclePriceCoordinator) {
		bytes32 deploymentSalt = keccak256(abi.encode(msg.sender, salt));
		OpenOraclePriceCoordinator coordinator = priceCoordinatorDeploymentWorker.deploy(
			abi.encode(
				_openOracle,
				_reputationToken,
				weth,
				gasConsumedOpenOracleReportPrice,
				gasConsumedSettlement,
				gasUnitsForOneDispute,
				_initialReportPriorityFeeAttoEthPerGas,
				targetPriceErrorForDispute,
				openOracleSecurityMultiplierBps,
				settlementTime,
				disputeDelay,
				protocolFee,
				feePercentage,
				multiplier,
				timeType,
				trackDisputes,
				protocolFeeRecipient,
				escalationHaltMultiplierBps,
				maxSettlementBaseFeeMultiplierBps,
				minLiquidationPriceDistanceBps
			),
			deploymentSalt
		);
		LiquidationApprovalRegistry registry = liquidationApprovalRegistryDeployer.deploy(
			address(coordinator),
			deploymentSalt
		);
		priceCoordinatorDeploymentWorker.configureLiquidationApprovalRegistry(coordinator, registry);
		return coordinator;
	}
}
