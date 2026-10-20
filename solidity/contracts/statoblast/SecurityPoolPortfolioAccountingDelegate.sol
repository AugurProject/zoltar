// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolLinearFees } from './SecurityPoolLinearFees.sol';
import { ISecurityPool, AccountingReason, SystemState } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolPortfolioAccounting } from './interfaces/ISecurityPoolPortfolioAccounting.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

/// @dev Delegate targets keep the native pool deployable while sharing its exact storage layout.
abstract contract SecurityPoolPortfolioAccountingDelegate is SecurityPoolLinearFees {
	using SafeERC20Ops for IERC20;

	function _emitAccountingCheckpoint(AccountingReason reason) internal virtual;

	/// @notice Pool delegate target; payable because delegatecall retains the outer call value.
	function accrueSettlementCollateral() external payable {
		if (portfolioCustody != address(0)) {
			uint256 previousTimestamp = lastUpdatedFeeAccumulator;
			updateLinearFees();
			if (lastUpdatedFeeAccumulator != previousTimestamp) _emitAccountingCheckpoint(AccountingReason.Accrual);
			return;
		}
		uint256 feeEndDate = ISecurityPool(payable(address(this))).getFeeEpochEndTime();
		feeEpochEndTime = feeEndDate;
		uint256 clampedCurrentTimestamp = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;
		if (lastUpdatedFeeAccumulator >= clampedCurrentTimestamp) return;
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (feeEligibleUnderwritingLimitAttoEth == 0) {
			feeIndexRemainder = 0;
			lastUpdatedFeeAccumulator = clampedCurrentTimestamp;
			_emitAccountingCheckpoint(AccountingReason.Accrual);
			return;
		}
		uint256 feeIndexDelta;
		uint256 creditedFeesAttoEth;
		(feeIndexDelta, feeIndexRemainder, creditedFeesAttoEth, totalFeesOwedRemainder) = SecurityPoolUtils.calculateFeeAccrual(Math.mulDiv(settlementCollateralAttoEth, feeEligibleUnderwritingLimitAttoEth, totalUnderwritingLimitAttoEth), currentRetentionRate, timeDelta, feeIndexRemainder, feeEligibleUnderwritingLimitAttoEth, totalFeesOwedRemainder);
		feeIndex += feeIndexDelta;
		if (feeIndexDelta > 0) uncheckpointedFeeEligibleUnderwritingLimitAttoEth = feeEligibleUnderwritingLimitAttoEth;
		unallocatedAccruedFeesAttoEth += creditedFeesAttoEth;
		settlementCollateralAttoEth -= creditedFeesAttoEth;
		lastUpdatedFeeAccumulator = clampedCurrentTimestamp;
		_emitAccountingCheckpoint(AccountingReason.Accrual);
	}

	/// @notice Recompute the standalone retention curve or refresh the bound portfolio's linear stream.
	function updateRetentionRate() external payable {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		if (portfolioCustody != address(0)) {
			pool.refreshPortfolioFees();
			return;
		}
		if (systemState != SystemState.Operational) return;
		pool.updateSettlementCollateral();
		uint256 nextRetentionRate = SecurityPoolUtils.calculateRetentionRate(settlementCollateralAttoEth, pool.getCurrentMintingCapacityAttoEth());
		if (nextRetentionRate == currentRetentionRate) return;
		currentRetentionRate = nextRetentionRate;
		_emitAccountingCheckpoint(AccountingReason.RetentionRateChange);
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
		require(totalRepBackingUnits == 0 && totalUnderwritingLimitAttoEth == 0, 'Native backing already initialized');
		pool.updateSettlementCollateral();
		linearFeePrincipalAttoEth = 0;
		accountedPortfolioBackingAttoRep = 0;
		portfolioCustody = custody;
		portfolioAccounting = ISecurityPoolPortfolioAccounting(msg.sender);
		feeIndexRemainder = 0;
		totalFeesOwedRemainder = 0;
		pool.refreshPortfolioFees();
	}

	function creditEscalationSurplus(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		if (portfolioCustody != address(0)) {
			IERC20(address(ISecurityPool(payable(address(this))).repToken())).safeTransfer(address(portfolioAccounting), amountAttoRep);
			IPortfolioSettlement(address(portfolioAccounting)).onQuestionRepIncome(amountAttoRep);
			return;
		}
		if (totalRepBackingUnits == 0) _burnEscalationRep(amountAttoRep);
		else {
			_notifyPortfolioAccounting();
		}
	}

	function creditEscalationAuctionBacking(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		_creditTransferredBacking(amountAttoRep);
	}

	function creditForkBacking(uint256 amountAttoRep) external {
		require(msg.sender == ISecurityPool(payable(address(this))).securityPoolForker(), 'Only forker');
		_creditTransferredBacking(amountAttoRep);
	}

	function _creditTransferredBacking(uint256 amountAttoRep) private {
		if (portfolioCustody == address(0)) return;
		accountedPortfolioBackingAttoRep += amountAttoRep;
		require(accountedPortfolioBackingAttoRep <= ISecurityPool(payable(address(this))).repToken().balanceOf(address(this)), 'Backing transfer missing');
		_notifyPortfolioAccounting();
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
