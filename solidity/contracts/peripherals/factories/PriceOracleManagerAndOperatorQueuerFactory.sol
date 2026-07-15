// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { LoggedOpenOracle } from '../openOracle/LoggedOpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { OpenOraclePriceCoordinator } from '../OpenOraclePriceCoordinator.sol';

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
	}

	function deployPriceOracleManagerAndOperatorQueuer(
		LoggedOpenOracle _openOracle,
		ReputationToken _reputationToken,
		bytes32 salt
	) external returns (OpenOraclePriceCoordinator) {
		return
			new OpenOraclePriceCoordinator{ salt: keccak256(abi.encode(msg.sender, salt)) }(
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
	}
}
