// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { OpenOraclePriceSource } from './OpenOraclePriceSource.sol';
import { OpenOracleReportDelegate } from './OpenOracleReportDelegate.sol';

/// @notice Question adapter to its security pool shared REP/collateral feed.
contract OpenOraclePriceCoordinator is OpenOraclePriceSource {
	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, OpenOracleReportDelegate _reportDelegate)
		OpenOraclePriceSource(
			_openOracle,
			_reputationToken,
			_weth,
			_initialReportPriorityFeeAttoEthPerGas,
			_targetPriceErrorForDispute,
			_settlementTime,
			_disputeDelay,
			_protocolFee,
			_feePercentage,
			_multiplier,
			_protocolFeeRecipient,
			_escalationHaltMultiplierBps,
			_maxSettlementBaseFeeMultiplierBps,
			_minLiquidationPriceDistanceBps,
			_reportDelegate
		)
	{}
}
