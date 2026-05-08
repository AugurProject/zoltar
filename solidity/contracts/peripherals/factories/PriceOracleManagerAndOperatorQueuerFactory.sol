// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { ShareToken } from '../tokens/ShareToken.sol';
import { ISecurityPool } from '../interfaces/ISecurityPool.sol';
import { Zoltar } from '../../Zoltar.sol';
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { ReputationToken } from '../../ReputationToken.sol';
import { SecurityPoolOracleCoordinator } from '../SecurityPoolOracleCoordinator.sol';

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
	bool public immutable keepFee;
	address public immutable protocolFeeRecipient;
	bool public immutable feeToken;

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
		bool _keepFee,
		address _protocolFeeRecipient,
		bool _feeToken
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
		keepFee = _keepFee;
		protocolFeeRecipient = _protocolFeeRecipient;
		feeToken = _feeToken;
	}

	function deployPriceOracleManagerAndOperatorQueuer(OpenOracle _openOracle, ReputationToken _reputationToken, bytes32 salt) external returns (SecurityPoolOracleCoordinator) {
		return new SecurityPoolOracleCoordinator{ salt: keccak256(abi.encode(msg.sender, salt)) }(
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
			keepFee,
			protocolFeeRecipient,
			feeToken
		);
	}
}
