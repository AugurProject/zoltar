// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { EscalationGame } from './EscalationGame.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { SecurityPoolPortfolioQuote } from './SecurityPoolPortfolioQuote.sol';
import { VaultOperationsInput, VaultLiquidationInput } from './VaultOperations.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';

/// @notice Immutable custody of one question allocation and its original owners' rights.
/// @dev Only the portfolio can allocate, rebalance, or split rights to an owner's recovery vault.
/// This account cannot stake on an outcome, choose a fork child, or execute arbitrary calls.
contract SecurityPoolPortfolioPosition {
	using SafeERC20Ops for IERC20;

	uint256 private constant MINIMUM_HEALTH_FACTOR_BPS = 12_000;
	address public immutable portfolio;
	ISecurityPool public immutable pool;
	SecurityPoolPortfolioQuote private immutable quoteHelper;

	constructor(address _portfolio, ISecurityPool _pool, SecurityPoolPortfolioQuote _quoteHelper) {
		portfolio = _portfolio;
		pool = _pool;
		quoteHelper = _quoteHelper;
	}

	modifier onlyPortfolio() {
		require(msg.sender == portfolio, 'Only portfolio');
		_;
	}

	/// @notice Deposits REP already transferred by the portfolio and sets this cohort's commitment.
	function allocate(uint256 depositAttoRep, uint256 nextCommitment) external onlyPortfolio {
		if (depositAttoRep > 0) {
			IERC20(address(pool.repToken())).safeApprove(address(pool), depositAttoRep);
			pool.depositRepToVault(depositAttoRep, pool.statoblastSecurityMultiplierBps());
		}
		pool.setUnderwritingLimit(nextCommitment);
	}

	function rebalancePlan() public view returns (uint256 retainedCommitment, uint256 releaseAttoRep) {
		return quoteHelper.rebalancePlan(pool, address(this));
	}

	/// @notice Releases excess backing and fees, retaining them unless the portfolio's owners are unchanged.
	function rebalance(bool returnToReserve) external onlyPortfolio returns (uint256 repReturned, uint256 feesReturned) {
		pool.redeemFees(address(this));
		(uint256 retainedCommitment, uint256 releaseAttoRep) = rebalancePlan();
		(, uint256 commitment, , ) = pool.securityVaults(address(this));
		if (retainedCommitment < commitment) pool.setUnderwritingLimit(retainedCommitment);
		if (releaseAttoRep > 0)
			pool.openOraclePriceCoordinator().vaultOperations().submitVaultOperations(VaultOperationsInput(0, false, 0, new VaultLiquidationInput[](0), releaseAttoRep, MINIMUM_HEALTH_FACTOR_BPS, 300), 0, 0, 0);
		if (!returnToReserve) return (0, 0);
		IERC20 repToken = IERC20(address(pool.repToken()));
		repReturned = repToken.balanceOf(address(this));
		feesReturned = address(this).balance;
		if (repReturned > 0) repToken.safeTransfer(portfolio, repReturned);
		_sendEth(portfolio, feesReturned);
	}

	function release(address recipient, uint256 numerator, uint256 denominator) external onlyPortfolio {
		pool.redeemFees(address(this));
		pool.splitVaultPosition(recipient, numerator, denominator);
		IERC20 repToken = IERC20(address(pool.repToken()));
		uint256 rep = Math.mulDiv(repToken.balanceOf(address(this)), numerator, denominator);
		uint256 fees = Math.mulDiv(address(this).balance, numerator, denominator);
		if (rep > 0) repToken.safeTransfer(recipient, rep);
		_sendEth(recipient, fees);
	}

	/// @notice Collect already liquid proceeds before changing the allocation's ownership weights.
	function collect() external onlyPortfolio returns (uint256 rep, uint256 fees) {
		pool.redeemFees(address(this));
		return _collect();
	}

	/// @notice Release available backing once for all remaining owners, without selecting a fork branch.
	function recover() external onlyPortfolio returns (uint256 rep, uint256 fees, bool complete) {
		pool.redeemFees(address(this));
		(uint256 units, uint256 commitment, , ) = pool.securityVaults(address(this));
		if (pool.systemState() == SystemState.Operational) {
			if (pool.isEscalationResolved()) {
				EscalationGame game = pool.escalationGame();
				bool residualPending =
					address(game) != address(0) && !game.forkContinuation() && game.totalDisputeStakedAttoRep() > 0;
				if (!residualPending) {
					if (
						address(game) != address(0) &&
						!game.forkContinuation() &&
						pool.repToken().balanceOf(address(game)) > 0
					) game.sweepResidualRepToSecurityPool();
					if (commitment > 0) pool.setUnderwritingLimit(0);
					if (units > 0 && pool.backingUnitsToAttoRep(units) > 0) pool.redeemRepFromVault(address(this));
				}
			} else {
				(uint256 retainedCommitment, uint256 releaseAttoRep) = rebalancePlan();
				if (retainedCommitment < commitment) pool.setUnderwritingLimit(retainedCommitment);
				EscalationGame game = pool.escalationGame();
				bool residualPending =
					address(game) != address(0) && !game.forkContinuation() && game.totalDisputeStakedAttoRep() > 0;
				// Preserve backing units that may receive ordinary-game residual after principal claims settle.
				if (releaseAttoRep > 0 && !residualPending)
					pool.openOraclePriceCoordinator().vaultOperations().submitVaultOperations(VaultOperationsInput(0, false, 0, new VaultLiquidationInput[](0), releaseAttoRep, MINIMUM_HEALTH_FACTOR_BPS, 300), 0, 0, 0);
			}
		}
		(rep, fees) = _collect();
		(units, commitment, , ) = pool.securityVaults(address(this));
		complete = units == 0 && commitment == 0;
	}

	function _collect() private returns (uint256 rep, uint256 fees) {
		IERC20 repToken = IERC20(address(pool.repToken()));
		rep = repToken.balanceOf(address(this));
		fees = address(this).balance;
		if (rep > 0) repToken.safeTransfer(portfolio, rep);
		_sendEth(portfolio, fees);
	}

	function _sendEth(address recipient, uint256 amount) private {
		if (amount == 0) return;
		(bool sent, ) = payable(recipient).call{value: amount}('');
		require(sent, 'Position fee transfer failed');
	}

	receive() external payable {}
}
