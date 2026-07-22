// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';
import { OpenOraclePriceCandidateVerifier } from '../OpenOraclePriceCandidateVerifier.sol';

contract PriceOracleManagerAndOperatorQueuerFactory {
	uint256 private constant OPEN_ORACLE_PERCENTAGE_PRECISION = 1e7;
	uint256 private constant BPS_DENOMINATOR = 10_000;
	PriceOracleCoordinatorDeploymentWorker private immutable deploymentWorker;
	OpenOraclePriceCandidateVerifier public immutable candidateVerifier;
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
	uint256 public immutable minLiquidationPriceDistanceBps;
	uint256 public immutable minimumTotalGasPriceWei;
	uint256 public immutable minimumPriorityFeeWei;
	uint256 public immutable absoluteInclusionPremiumWei;
	uint256 public immutable absoluteMinimumWethReport;
	uint256 public immutable economicOpportunityBlockCount;
	uint256 public immutable candidateProofWindowBlocks;
	uint256 public immutable gasUnitsForPriceFinalization;

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
		uint256 _minLiquidationPriceDistanceBps,
		uint256 _minimumTotalGasPriceWei,
		uint256 _minimumPriorityFeeWei,
		uint256 _absoluteInclusionPremiumWei,
		uint256 _absoluteMinimumWethReport,
		uint256 _economicOpportunityBlockCount,
		uint256 _candidateProofWindowBlocks,
		uint256 _gasUnitsForPriceFinalization
	) {
		require(_gasUnitsForOneDispute > 0, 'Dispute gas units must be greater than zero');
		require(
			_targetPriceErrorForDispute <= OPEN_ORACLE_PERCENTAGE_PRECISION,
			'Target price error cannot exceed one hundred percent'
		);
		require(
			_openOracleSecurityMultiplierBps >= BPS_DENOMINATOR,
			'Open Oracle Security multiplier must be at least one hundred percent'
		);
		require(
			uint256(_protocolFee) + uint256(_feePercentage) < _targetPriceErrorForDispute,
			'Oracle fees must be below the target price error'
		);
		require(
			_openOracleSecurityMultiplierBps <=
				type(uint256).max / (OPEN_ORACLE_PERCENTAGE_PRECISION + _targetPriceErrorForDispute),
			'Open Oracle Security multiplier is too large'
		);
		require(_escalationHaltMultiplierBps > 0, 'Escalation halt multiplier must be greater than zero');
		require(
			_minLiquidationPriceDistanceBps <= BPS_DENOMINATOR,
			'Minimum liquidation price distance cannot exceed one hundred percent'
		);
		require(_minimumTotalGasPriceWei > 0, 'Minimum total gas price must be positive');
		require(_minimumPriorityFeeWei > 0, 'Minimum priority fee must be positive');
		require(_absoluteInclusionPremiumWei > 0, 'Absolute inclusion premium must be positive');
		require(_absoluteMinimumWethReport > 0, 'Absolute minimum WETH report must be positive');
		require(
			_economicOpportunityBlockCount > 0 && _economicOpportunityBlockCount <= 16,
			'Economic opportunity block count is invalid'
		);
		require(
			uint256(_settlementTime) > uint256(_disputeDelay) + _economicOpportunityBlockCount,
			'Settlement window is too short for economic proof'
		);
		require(
			_candidateProofWindowBlocks > _economicOpportunityBlockCount && _candidateProofWindowBlocks <= 255,
			'Candidate proof window is invalid'
		);
		require(_gasUnitsForPriceFinalization > 0, 'Price finalization gas units must be positive');
		require(_timeType, 'Coordinator requires timestamp-based OpenOracle games');
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
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
		minimumTotalGasPriceWei = _minimumTotalGasPriceWei;
		minimumPriorityFeeWei = _minimumPriorityFeeWei;
		absoluteInclusionPremiumWei = _absoluteInclusionPremiumWei;
		absoluteMinimumWethReport = _absoluteMinimumWethReport;
		economicOpportunityBlockCount = _economicOpportunityBlockCount;
		candidateProofWindowBlocks = _candidateProofWindowBlocks;
		gasUnitsForPriceFinalization = _gasUnitsForPriceFinalization;
		deploymentWorker = new PriceOracleCoordinatorDeploymentWorker();
		candidateVerifier = new OpenOraclePriceCandidateVerifier();
	}

	function deployPriceOracleManagerAndOperatorQueuer(
		OpenOracle _openOracle,
		ReputationToken _reputationToken,
		bytes32 salt
	) external returns (OpenOraclePriceCoordinator) {
		return
			deploymentWorker.deploy(
				keccak256(abi.encode(msg.sender, salt)),
				abi.encode(
					_openOracle,
					_reputationToken,
					weth,
					candidateVerifier,
					gasConsumedOpenOracleReportPrice,
					gasConsumedSettlement,
					gasUnitsForOneDispute,
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
					minLiquidationPriceDistanceBps,
					minimumTotalGasPriceWei,
					minimumPriorityFeeWei,
					absoluteInclusionPremiumWei,
					absoluteMinimumWethReport,
					economicOpportunityBlockCount,
					candidateProofWindowBlocks,
					gasUnitsForPriceFinalization
				)
			);
	}
}

contract PriceOracleCoordinatorDeploymentWorker {
	address private immutable factory;

	constructor() {
		factory = msg.sender;
	}

	function deploy(
		bytes32 salt,
		bytes calldata constructorArguments
	) external returns (OpenOraclePriceCoordinator coordinator) {
		require(msg.sender == factory, 'Factory only');
		bytes memory initCode = abi.encodePacked(type(OpenOraclePriceCoordinator).creationCode, constructorArguments);
		address deployed;
		assembly {
			deployed := create2(0, add(initCode, 0x20), mload(initCode), salt)
			if iszero(deployed) {
				let revertDataSize := returndatasize()
				if gt(revertDataSize, 0) {
					returndatacopy(0, 0, revertDataSize)
					revert(0, revertDataSize)
				}
			}
		}
		require(deployed != address(0), 'Coordinator deployment failed');
		return OpenOraclePriceCoordinator(deployed);
	}
}
