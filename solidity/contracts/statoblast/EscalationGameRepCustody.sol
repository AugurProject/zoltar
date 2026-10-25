// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import {
	ISecurityPoolReporterLedger,
	ISecurityPoolReporterPortfolio
} from './interfaces/ISecurityPoolReporterLedger.sol';

/// @dev One adapter for native game logic and portfolio reporter custody. Standalone
/// games (including narrow test pool contexts) keep their existing direct REP custody.
library EscalationGameRepCustody {
	using SafeERC20Ops for IERC20;

	function portfolio(address poolAddress) internal view returns (address authority) {
		ISecurityPool pool = ISecurityPool(payable(poolAddress));
		// Narrow standalone test contexts do not implement portfolio binding.
		try pool.portfolioCustody() returns (address custody) {
			if (custody == address(0)) return address(0);
		} catch {
			return address(0);
		}
		authority = pool.securityPoolFactory().getSecurityPoolPortfolio(pool);
		require(authority != address(0), 'Bound reporter portfolio is missing');
	}

	function ledger(address poolAddress) internal view returns (ISecurityPoolReporterLedger custody) {
		address authority = portfolio(poolAddress);
		if (authority == address(0)) return ISecurityPoolReporterLedger(address(0));
		address ledgerAddress = ISecurityPoolReporterPortfolio(authority).reporterLedger(ISecurityPool(payable(poolAddress)).universeId());
		require(ledgerAddress.code.length != 0, 'Portfolio reporter ledger is missing');
		return ISecurityPoolReporterLedger(ledgerAddress);
	}

	function balance(address poolAddress, address tokenAddress) internal view returns (uint256) {
		ISecurityPoolReporterLedger custody = ledger(poolAddress);
		return
			address(custody) == address(0)
				? IERC20(tokenAddress).balanceOf(address(this))
				: custody.balanceOfGame(address(this));
	}

	function receiveDeposit(address poolAddress, address tokenAddress, uint256 amountAttoRep) internal {
		address authority = portfolio(poolAddress);
		if (authority == address(0)) return;
		ISecurityPoolReporterPortfolio(authority).registerReporterGame(address(this));
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
		address authority = portfolio(poolAddress);
		if (authority == address(0)) return;
		ISecurityPoolReporterPortfolio(authority).registerReporterGame(address(this));
		if (finalAfter != 0 && finalAfter < block.timestamp) finalAfter = uint48(block.timestamp);
		uint48 logicalFinalAfter =
			finalAfter == 0
				? 0
				: ISecurityPoolReporterPortfolio(authority).logicalTimeForNative(ISecurityPool(payable(poolAddress)).universeId(), finalAfter);
		ledger(poolAddress).scheduleFinality(address(this), logicalFinalAfter);
		ISecurityPoolReporterPortfolio(authority).onQuestionFinalityChanged(finalAfter);
	}
	function recordReporter(address poolAddress, address reporter) internal {
		address authority = portfolio(poolAddress);
		if (authority != address(0)) ISecurityPoolReporterPortfolio(authority).onQuestionReporterChanged(reporter);
	}
}
