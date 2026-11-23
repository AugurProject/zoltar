// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CheckedCast } from '../CheckedCast.sol';

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { SecurityPoolReporterLedger } from './SecurityPoolReporterLedger.sol';
import { SecurityPoolSettlement } from './SecurityPoolSettlement.sol';
import { SecurityPoolSettlementBook } from './SecurityPoolSettlementBook.sol';
import {
	ISecurityPoolReporterLedger,
	ISecurityPoolReporterHost
} from './interfaces/ISecurityPoolReporterLedger.sol';

/// @dev One adapter for native game logic and security pool reporter custody. Standalone
/// games (including narrow test pool contexts) keep their existing direct REP custody.
library EscalationGameRepCustody {
	using SafeERC20Ops for IERC20;

	function securityPool(address poolAddress) internal view returns (address authority) {
		IQuestionLedger pool = IQuestionLedger(payable(poolAddress));
		// Narrow standalone test contexts do not implement security pool binding.
		try pool.securityPoolCustody() returns (address custody) {
			if (custody == address(0)) return address(0);
		} catch {
			return address(0);
		}
		authority = pool.securityPoolFactory().securityPoolOf(pool);
		require(authority != address(0), 'Bound reporter security pool is missing');
	}

	function ledger(address poolAddress) internal view returns (ISecurityPoolReporterLedger custody) {
		address authority = securityPool(poolAddress);
		if (authority == address(0)) return ISecurityPoolReporterLedger(address(0));
		address ledgerAddress = ISecurityPoolReporterHost(authority).reporterLedger(IQuestionLedger(payable(poolAddress)).universeId());
		require(ledgerAddress.code.length != 0, 'Security pool reporter ledger is missing');
		return ISecurityPoolReporterLedger(ledgerAddress);
	}

	/// @dev Fixed questions retain their inherited cutoff through unrelated forks,
	/// including questions with trader shares but no reporter deposits or game.
	function fixedQuestionFinalAfter(address authority, uint248 universe, uint256 questionId) internal view returns (uint48) {
		ISecurityPoolReporterHost root = ISecurityPoolReporterHost(authority);
		(SecurityPoolReporterLedger.Question memory reporter, ) = SecurityPoolReporterLedger(root.reporterLedger(universe)).question(universe, questionId);
		if (reporter.finalAfter != 0) return reporter.finalAfter;
		// Standalone custody harnesses may have no settlement engine.
		try root.settlement() returns (address engine) {
			if (engine != address(0)) {
				SecurityPoolSettlement settlement = SecurityPoolSettlement(engine);
				uint64 bookId = settlement.bookIds(universe);
				if (bookId != 0) {
					(SecurityPoolSettlementBook.Question memory claim, ) = settlement.ledger().question(bookId, questionId);
					return claim.finalAfter;
				}
			}
		} catch {}
		return 0;
	}

	function balance(address poolAddress, address tokenAddress) internal view returns (uint256) {
		ISecurityPoolReporterLedger custody = ledger(poolAddress);
		return
			address(custody) == address(0)
				? IERC20(tokenAddress).balanceOf(address(this))
				: custody.balanceOfGame(address(this));
	}

	function receiveDeposit(address poolAddress, address tokenAddress, uint256 amountAttoRep) internal {
		address authority = securityPool(poolAddress);
		if (authority == address(0)) return;
		ISecurityPoolReporterHost(authority).registerReporterGame(address(this));
		ISecurityPoolReporterLedger custody = ledger(poolAddress);
		IERC20(tokenAddress).safeTransfer(address(custody), amountAttoRep);
		custody.depositForGame(address(this), amountAttoRep);
	}

	function transfer(address poolAddress, address tokenAddress, address recipient, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		ISecurityPoolReporterLedger custody = ledger(poolAddress);
		if (address(custody) == address(0)) IERC20(tokenAddress).safeTransfer(recipient, amountAttoRep);
		else custody.transferFromGame(address(this), recipient, amountAttoRep);
	}

	function scheduleFinality(address poolAddress, uint48 finalAfter) internal {
		address authority = securityPool(poolAddress);
		if (authority == address(0)) return;
		ISecurityPoolReporterHost(authority).registerReporterGame(address(this));
		if (finalAfter != 0 && finalAfter < block.timestamp) finalAfter = CheckedCast.toUint48(block.timestamp);
		uint48 finalAfterSecurityPoolTime =
			finalAfter == 0
				? 0
				: ISecurityPoolReporterHost(authority).securityPoolTimeForNative(IQuestionLedger(payable(poolAddress)).universeId(), finalAfter);
		ledger(poolAddress).scheduleFinality(address(this), finalAfterSecurityPoolTime);
		ISecurityPoolReporterHost(authority).onQuestionFinalityChanged(finalAfter);
	}
}
