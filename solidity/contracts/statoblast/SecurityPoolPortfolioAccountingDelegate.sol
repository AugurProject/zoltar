// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolLinearFees } from './SecurityPoolLinearFees.sol';
import { ISecurityPool, AccountingReason } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioAccounting } from './interfaces/ISecurityPoolPortfolioAccounting.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

/// @dev Delegate targets keep the native pool deployable while sharing its exact storage layout.
abstract contract SecurityPoolPortfolioAccountingDelegate is SecurityPoolLinearFees {
	using SafeERC20Ops for IERC20;

	function _emitAccountingCheckpoint(AccountingReason reason) internal virtual;

	/// @notice Pool delegate target; payable because delegatecall retains the outer call value.
	function accrueSettlementCollateral() external payable {
		uint256 previousTimestamp = lastSettlementPortfolioTime;
		updateLinearFees();
		if (lastSettlementPortfolioTime != previousTimestamp) _emitAccountingCheckpoint(AccountingReason.Accrual);
	}

	/// @notice Refresh the portfolio's linear stream.
	function updateRetentionRate() external payable {
		ISecurityPool(payable(address(this))).refreshPortfolioFees();
	}

	function decodeError(bytes calldata result) external pure returns (string memory reason) {
		if (result.length < 68 || bytes4(result[:4]) != bytes4(keccak256('Error(string)')))
			return 'Delegate call failed';
		return abi.decode(result[4:], (string));
	}

	function setPortfolioCustody(address custody) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == pool.securityPoolFactory().getSecurityPoolPortfolio(pool), 'Only portfolio');
		require(custody != address(0) && portfolioCustody == address(0), 'Custody already bound');
		portfolioCustody = custody;
		portfolioAccounting = ISecurityPoolPortfolioAccounting(msg.sender);
		pool.refreshPortfolioFees();
	}

	function creditEscalationSurplus(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		IERC20(address(ISecurityPool(payable(address(this))).repToken())).safeTransfer(address(portfolioAccounting), amountAttoRep);
		IPortfolioSettlement(address(portfolioAccounting)).onQuestionRepIncome(amountAttoRep);
	}

	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		_burnEscalationRep(amountAttoRep);
	}

	function _burnEscalationRep(uint256 amountAttoRep) private {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		Zoltar zoltar = pool.zoltar();
		IERC20 token = IERC20(address(pool.repToken()));
		if (address(token) == address(zoltar.genesisReputationToken()))
			token.safeApprove(address(zoltar), amountAttoRep);
		zoltar.burnRep(pool.universeId(), amountAttoRep);
	}
}
