// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { AccountingReason, IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { QuestionLedgerAccountingDelegate } from './QuestionLedgerAccountingDelegate.sol';

/// @notice Fixed delegate for native fee accounting, portfolio credits and verbose checkpoint encoding.
contract QuestionLedgerEventEmitter is QuestionLedgerAccountingDelegate {
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementPortfolioTime);

	function setStartingParams() external {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(msg.sender == address(pool.securityPoolFactory()), 'Only factory');
		// Bootstrap placeholder until portfolio binding checkpoints the central portfolio clock.
		lastSettlementPortfolioTime = block.timestamp;
		feeEpochEndTime = pool.questionData().getQuestionEndDate(pool.questionId());
		_emitCheckpoint(AccountingReason.PoolInitialization);
	}

	function emitQuestionLedgerAccountingCheckpoint(AccountingReason reason) external payable {
		_emitCheckpoint(reason);
	}

	function _emitAccountingCheckpoint(AccountingReason reason) internal override {
		_emitCheckpoint(reason);
	}

	function _emitCheckpoint(AccountingReason reason) private {
		// Every capacity/collateral checkpoint also reconciles the shared report security budget.
		IQuestionLedger(payable(address(this))).openOraclePriceCoordinator().syncExposure();
		emit QuestionAccountingCheckpoint(reason, settlementCollateralAttoEth, shareTokenSupplyAttoShares, lastSettlementPortfolioTime);
	}
}
