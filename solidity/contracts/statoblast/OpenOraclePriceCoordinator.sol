// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { OpenOraclePriceSource } from './OpenOraclePriceSource.sol';
import { OpenOracleReportDelegate } from './OpenOracleReportDelegate.sol';

/// @notice Question adapter to its portfolio shared REP/ETH feed.
contract OpenOraclePriceCoordinator is OpenOraclePriceSource {
	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _gasConsumedOpenOracleReportPrice, uint32 _gasConsumedSettlement, uint256 _gasUnitsForOneDispute, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint256 _openOracleSecurityMultiplierBps, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, bool _timeType, bool _trackDisputes, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, OpenOracleReportDelegate _reportDelegate)
		OpenOraclePriceSource(
			_openOracle,
			_reputationToken,
			_weth,
			_gasConsumedOpenOracleReportPrice,
			_gasConsumedSettlement,
			_gasUnitsForOneDispute,
			_initialReportPriorityFeeAttoEthPerGas,
			_targetPriceErrorForDispute,
			_openOracleSecurityMultiplierBps,
			_settlementTime,
			_disputeDelay,
			_protocolFee,
			_feePercentage,
			_multiplier,
			_timeType,
			_trackDisputes,
			_protocolFeeRecipient,
			_escalationHaltMultiplierBps,
			_maxSettlementBaseFeeMultiplierBps,
			_minLiquidationPriceDistanceBps,
			_reportDelegate
		)
	{}
}
