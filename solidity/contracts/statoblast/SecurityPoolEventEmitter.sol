// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { AccountingReason, ISecurityPool } from './interfaces/ISecurityPool.sol';
import { SecurityPoolPortfolioAccountingDelegate } from './SecurityPoolPortfolioAccountingDelegate.sol';

/// @notice Fixed delegate for native fee accounting, portfolio credits and verbose checkpoint encoding.
contract SecurityPoolEventEmitter is SecurityPoolPortfolioAccountingDelegate {
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementPortfolioTime);

	function setStartingParams(uint256, uint256 initialCollateral) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == address(pool.securityPoolFactory()), 'Only factory');
		// Bootstrap placeholder until portfolio binding checkpoints the central portfolio clock.
		lastSettlementPortfolioTime = block.timestamp;
		feeEpochEndTime = pool.questionData().getQuestionEndDate(pool.questionId());
		settlementCollateralAttoEth = initialCollateral;
		_emitCheckpoint(AccountingReason.PoolInitialization);
	}

	function emitPoolAccountingCheckpoint(AccountingReason reason) external payable {
		_emitCheckpoint(reason);
	}

	function _emitAccountingCheckpoint(AccountingReason reason) internal override {
		_emitCheckpoint(reason);
	}

	function _emitCheckpoint(AccountingReason reason) private {
		// Every capacity/collateral checkpoint also reconciles the shared report security budget.
		ISecurityPool(payable(address(this))).openOraclePriceCoordinator().syncExposure();
		emit QuestionAccountingCheckpoint(reason, settlementCollateralAttoEth, shareTokenSupplyAttoShares, lastSettlementPortfolioTime);
	}
}
