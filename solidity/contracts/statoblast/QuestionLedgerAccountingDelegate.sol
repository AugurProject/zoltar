// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { QuestionLedgerSettlementSync } from './QuestionLedgerSettlementSync.sol';
import { IQuestionLedger, AccountingReason } from './interfaces/IQuestionLedger.sol';
import { ISecurityPoolAccounting } from './interfaces/ISecurityPoolAccounting.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';

/// @dev Delegate targets keep the native pool deployable while sharing its exact storage layout.
abstract contract QuestionLedgerAccountingDelegate is QuestionLedgerSettlementSync {
	using SafeERC20Ops for IERC20;

	function _emitAccountingCheckpoint(AccountingReason reason) internal virtual;

	/// @notice Pool delegate target; payable because delegatecall retains the outer call value.
	function accrueSettlementCollateral() external payable {
		uint256 previousTimestamp = lastSettlementSecurityPoolTime;
		synchronizeSettlement();
		if (lastSettlementSecurityPoolTime != previousTimestamp) _emitAccountingCheckpoint(AccountingReason.Accrual);
	}

	function setSecurityPoolCustody(address custody) external {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(msg.sender == pool.securityPoolFactory().securityPoolOf(pool), 'Only security pool');
		require(custody != address(0) && securityPoolCustody == address(0), 'Custody already bound');
		securityPoolCustody = custody;
		securityPoolAccounting = ISecurityPoolAccounting(msg.sender);
		pool.refreshSecurityPoolFees();
	}

	function creditEscalationSurplus(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		IERC20(address(IQuestionLedger(payable(address(this))).repToken())).safeTransfer(address(securityPoolAccounting), amountAttoRep);
		ISecurityPoolSettlement(address(securityPoolAccounting)).onQuestionRepIncome(amountAttoRep);
	}

	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		_burnEscalationRep(amountAttoRep);
	}

	function _burnEscalationRep(uint256 amountAttoRep) private {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		Zoltar zoltar = pool.zoltar();
		IERC20 token = IERC20(address(pool.repToken()));
		if (address(token) == address(zoltar.genesisReputationToken()))
			token.safeApprove(address(zoltar), amountAttoRep);
		zoltar.burnRep(pool.universeId(), amountAttoRep);
	}
}
