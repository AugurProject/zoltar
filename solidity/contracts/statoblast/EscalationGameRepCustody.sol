// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../CheckedCast.sol';

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import { ISecurityPoolReporterLedger, ISecurityPoolReporterHost } from './interfaces/ISecurityPoolReporterLedger.sol';

/// @dev One adapter for native game logic and security pool reporter custody. The factory
/// starts games only for question ledgers bound to a security pool, so every game uses it.
library EscalationGameRepCustody {
	using SafeERC20Ops for IERC20;

	function securityPool(address poolAddress) internal view returns (address authority) {
		IQuestionLedger pool = IQuestionLedger(payable(poolAddress));
		if (pool.securityPoolCustody() == address(0)) return address(0);
		authority = pool.securityPoolFactory().securityPoolOf(pool);
		require(authority != address(0), 'Bound reporter security pool is missing');
	}

	function ledger(address poolAddress) internal view returns (ISecurityPoolReporterLedger custody) {
		address ledgerAddress = ISecurityPoolReporterHost(securityPool(poolAddress)).reporterLedger(IQuestionLedger(payable(poolAddress)).universeId());
		require(ledgerAddress.code.length != 0, 'Security pool reporter ledger is missing');
		return ISecurityPoolReporterLedger(ledgerAddress);
	}

	/// @dev Fixed questions retain their inherited cutoff through unrelated forks,
	/// including questions with trader shares but no reporter deposits or game.
	function fixedQuestionFinalAfter(address authority, uint248 universe, uint256 questionId) internal view returns (uint48) {
		ISecurityPoolReporterHost root = ISecurityPoolReporterHost(authority);
		(SecurityPoolReporterLedger.Question memory reporter, ) = SecurityPoolReporterLedger(root.reporterLedger(universe)).question(universe, questionId);
		if (reporter.finalAfter != 0) return reporter.finalAfter;
		// A pool still in staged setup has no settlement engine yet.
		address engine = root.settlement();
		if (engine == address(0)) return 0;
		SecurityPoolSettlement settlement = SecurityPoolSettlement(engine);
		uint64 bookId = settlement.bookIds(universe);
		if (bookId == 0) return 0;
		(SecurityPoolSettlementBook.Question memory claim, ) = settlement.ledger().question(bookId, questionId);
		return claim.finalAfter;
	}

	function balance(address poolAddress) internal view returns (uint256) {
		return ledger(poolAddress).balanceOfGame(address(this));
	}

	function receiveDeposit(address poolAddress, address tokenAddress, uint256 amountAttoRep, uint48 finalAfter) internal {
		address authority = securityPool(poolAddress);
		ISecurityPoolReporterHost(authority).registerReporterGame(address(this));
		ISecurityPoolReporterLedger custody = ledger(poolAddress);
		IERC20(tokenAddress).safeTransfer(address(custody), amountAttoRep);
		custody.depositAndScheduleFinality(address(this), amountAttoRep, _finalityInSecurityPoolTime(authority, poolAddress, finalAfter));
	}

	function transfer(address poolAddress, address recipient, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		ledger(poolAddress).transferFromGame(address(this), recipient, amountAttoRep);
	}

	function scheduleFinality(address poolAddress, uint48 finalAfter) internal {
		address authority = securityPool(poolAddress);
		ISecurityPoolReporterHost(authority).registerReporterGame(address(this));
		ledger(poolAddress).scheduleFinality(address(this), _finalityInSecurityPoolTime(authority, poolAddress, finalAfter));
		ISecurityPoolReporterHost(authority).onQuestionFinalityChanged(normalizeFinalAfter(finalAfter));
	}

	function _finalityInSecurityPoolTime(address authority, address poolAddress, uint48 finalAfter) private view returns (uint48) {
		finalAfter = normalizeFinalAfter(finalAfter);
		return
			finalAfter == 0
				? 0
				: ISecurityPoolReporterHost(authority).securityPoolTimeForNative(IQuestionLedger(payable(poolAddress)).universeId(), finalAfter);
	}
	function normalizeFinalAfter(uint48 finalAfter) internal view returns (uint48) {
		return finalAfter != 0 && finalAfter < block.timestamp ? CheckedCast.toUint48(block.timestamp) : finalAfter;
	}
}
