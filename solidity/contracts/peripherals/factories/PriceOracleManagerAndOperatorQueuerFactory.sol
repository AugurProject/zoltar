// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import {
	OpenOracleOperationBountyBoard,
	OpenOracleOperationBountyBoardFactory
} from '../OpenOracleOperationBountyBoard.sol';

contract PriceOracleManagerAndOperatorQueuerFactory {
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable exactToken1Report;
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
	OpenOracleOperationBountyBoardFactory public immutable operationBountyBoardFactory;
	PriceOracleCoordinatorDeploymentWorker private immutable deploymentWorker;

	constructor(
		IWeth9 _weth,
		uint256 _gasConsumedOpenOracleReportPrice,
		uint32 _gasConsumedSettlement,
		uint256 _exactToken1Report,
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
		weth = _weth;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		exactToken1Report = _exactToken1Report;
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
		operationBountyBoardFactory = new OpenOracleOperationBountyBoardFactory();
		PriceOracleCoordinatorCreationCode creationCode = new PriceOracleCoordinatorCreationCode();
		deploymentWorker = new PriceOracleCoordinatorDeploymentWorker(address(creationCode));
	}

	function deployPriceOracleManagerAndOperatorQueuer(
		OpenOracle _openOracle,
		ReputationToken _reputationToken,
		bytes32 salt
	) external returns (OpenOraclePriceCoordinator) {
		bytes32 deploymentSalt = keccak256(abi.encode(msg.sender, salt));
		bytes memory constructorArguments = abi.encode(
			address(this),
			_openOracle,
			_reputationToken,
			weth,
			gasConsumedOpenOracleReportPrice,
			gasConsumedSettlement,
			exactToken1Report,
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
		);
		OpenOraclePriceCoordinator coordinator = deploymentWorker.deploy(deploymentSalt, constructorArguments);
		OpenOracleOperationBountyBoard board = operationBountyBoardFactory.deploy(
			coordinator,
			_reputationToken,
			weth,
			deploymentSalt
		);
		coordinator.setOperationBountyBoard(address(board));
		return coordinator;
	}
}

// Keep the coordinator creation code in contract bytecode so each security-pool
// deployment can copy it cheaply instead of loading hundreds of storage slots.
contract PriceOracleCoordinatorCreationCode {
	constructor() {
		bytes memory creationCode = type(OpenOraclePriceCoordinator).creationCode;
		assembly {
			return(add(creationCode, 0x20), mload(creationCode))
		}
	}
}

contract PriceOracleCoordinatorDeploymentWorker {
	address private immutable factory;
	address private immutable creationCodeStore;

	constructor(address _creationCodeStore) {
		factory = msg.sender;
		creationCodeStore = _creationCodeStore;
	}

	function deploy(
		bytes32 salt,
		bytes calldata constructorArguments
	) external returns (OpenOraclePriceCoordinator coordinator) {
		require(msg.sender == factory, 'Only the price oracle factory can use the deployment worker');
		address codeStore = creationCodeStore;
		uint256 creationCodeSize = codeStore.code.length;
		require(creationCodeSize > 0, 'Price oracle coordinator creation code is unavailable');
		bytes memory initCode = new bytes(creationCodeSize + constructorArguments.length);
		address deployed;
		assembly {
			extcodecopy(codeStore, add(initCode, 0x20), 0, creationCodeSize)
			calldatacopy(
				add(add(initCode, 0x20), creationCodeSize),
				constructorArguments.offset,
				constructorArguments.length
			)
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
		require(deployed != address(0), 'Price oracle coordinator deployment failed');
		return OpenOraclePriceCoordinator(deployed);
	}
}
