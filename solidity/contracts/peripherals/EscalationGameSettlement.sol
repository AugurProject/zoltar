// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameEscrow } from './EscalationGameEscrow.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { CarriedDepositProof, Deposit } from './EscalationGameTypes.sol';

abstract contract EscalationGameSettlement is EscalationGameEscrow {
	function claimDepositForWinning(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		(depositor, amountToWithdraw, originalDepositAmount) = _claimDepositForWinning(depositIndex, outcome, true);
		_safeTransferRep(depositor, amountToWithdraw);
	}

	function claimDepositForWinningWithoutTransfer(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		return _claimDepositForWinning(depositIndex, outcome, false);
	}

	function exportUnresolvedDeposit(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	) public onlySecurityPoolOrForker returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		uint8 outcomeIndex = uint8(outcome);
		Deposit memory deposit = _consumeLocalDeposit(outcomeIndex, depositIndex);
		depositor = deposit.depositor;
		amount = deposit.amount;
		_consumeEscrowedRepForVault(depositor, amount);
		parentDepositIndex = _getStableLocalParentDepositIndex(outcomeIndex, depositIndex);
	}

	function withdrawDeposit(
		CarriedDepositProof calldata proof,
		BinaryOutcomes.BinaryOutcome outcome
	)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmount = proof.amount;
		require(
			!ISecurityPoolForker(securityPool.securityPoolForker()).isEscalationDepositClaimedDirectly(
				securityPool.parent(),
				outcome,
				proof.parentDepositIndex
			),
			'Parent deposit claimed'
		);
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		(
			uint256 forkedEscrowPrincipal,
			uint256 forkedEscrowChildRep,
			uint256 forkedEscrowChildRepToRelease
		) = _consumeForkedEscrow(depositor, outcome, originalDepositAmount);
		if (forkedEscrowPrincipal > 0) {
			_consumeEscrowedRepForVault(depositor, forkedEscrowChildRepToRelease);
			if (outcome == questionResolution) {
				uint256 burnAmount;
				(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(
					outcomeIndex,
					proof.amount,
					proof.cumulativeAmount
				);
				amountToWithdraw = _scaleForkedEscrowAmount(
					amountToWithdraw,
					forkedEscrowChildRep,
					forkedEscrowPrincipal
				);
				_safeTransferRep(depositor, amountToWithdraw);
				emit ClaimDeposit(
					depositor,
					outcome,
					proof.parentDepositIndex,
					originalDepositAmount,
					amountToWithdraw,
					Math.ceilDiv(burnAmount * forkedEscrowChildRep, forkedEscrowPrincipal),
					true
				);
				emit WithdrawDeposit(depositor, outcome, amountToWithdraw, proof.parentDepositIndex);
				return (depositor, amountToWithdraw, originalDepositAmount);
			}
			emit WithdrawDeposit(depositor, outcome, 0, proof.parentDepositIndex);
			return (depositor, 0, originalDepositAmount);
		}
		require(!forkCarrySnapshotRequiresForkedEscrow, 'Forked escrow missing');
		if (outcome == questionResolution) {
			uint256 burnAmount;
			(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(
				outcomeIndex,
				proof.amount,
				proof.cumulativeAmount
			);
			if (amountToWithdraw > 0) {
				_safeTransferRep(depositor, amountToWithdraw);
			}
			emit ClaimDeposit(
				depositor,
				outcome,
				proof.parentDepositIndex,
				originalDepositAmount,
				amountToWithdraw,
				burnAmount,
				true
			);
			emit WithdrawDeposit(depositor, outcome, amountToWithdraw, proof.parentDepositIndex);
			return (depositor, amountToWithdraw, originalDepositAmount);
		}
		emit WithdrawDeposit(depositor, outcome, 0, proof.parentDepositIndex);
	}

	function exportUnresolvedDeposit(
		CarriedDepositProof calldata proof,
		BinaryOutcomes.BinaryOutcome outcome
	) public onlySecurityPoolOrForker returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(!forkCarrySnapshotRequiresForkedEscrow, 'Forked proof unsupported');
		uint8 outcomeIndex = uint8(outcome);
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		depositor = proof.depositor;
		amount = proof.amount;
		parentDepositIndex = proof.parentDepositIndex;
		_consumeEscrowedRepForVault(depositor, amount);
	}

	function withdrawDeposit(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome
	) public returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		require(msg.sender == address(securityPool), 'Only pool');
		require(nonDecisionTimestamp == 0, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = getQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		if (outcome == questionResolution) {
			(depositor, amountToWithdraw, originalDepositAmount) = claimDepositForWinning(
				depositIndex,
				questionResolution
			);
			emit WithdrawDeposit(depositor, questionResolution, amountToWithdraw, depositIndex);
			return (depositor, amountToWithdraw, originalDepositAmount);
		}
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		_consumeEscrowedRepForVault(depositor, originalDepositAmount);
		emit WithdrawDeposit(depositor, outcome, 0, depositIndex);
	}

	function sweepResidualRepToSecurityPool() external {
		require(getQuestionResolution() != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		require(_totalUnresolvedPrincipal() == 0, 'Principal remains');
		require(totalEscrowedRep == 0, 'Escrowed REP remains');
		uint256 amount = repToken.balanceOf(address(this));
		require(amount > 0, 'No sweepable REP');
		_safeTransferRep(address(securityPool), amount);
		emit ResidualRepSweptToSecurityPool(amount);
	}

	function drainAllRep(address receiver) external onlySecurityPoolOrForker returns (uint256 amount) {
		require(receiver != address(0x0), 'REP receiver zero');
		amount = repToken.balanceOf(address(this));
		if (amount == 0) return 0;
		_safeTransferRep(receiver, amount);
	}

	function getDepositsByOutcome(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 startIndex,
		uint256 numberOfEntries
	) external view returns (Deposit[] memory returnDeposits) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new Deposit[](0);
		Deposit[] storage outcomeDeposits = outcomeState[uint8(outcome)].deposits;
		uint256 iterateUntil = _sliceEnd(startIndex, numberOfEntries, outcomeDeposits.length);
		if (iterateUntil <= startIndex) return new Deposit[](0);
		returnDeposits = new Deposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			returnDeposits[index - startIndex] = outcomeDeposits[index];
		}
	}

	function getDepositsByOutcomeLength(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return 0;
		return outcomeState[uint8(outcome)].deposits.length;
	}

	function _claimDepositForWinning(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome,
		bool transferredRep
	) private returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 burnAmount;
		(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(
			uint8(outcome),
			deposit.amount,
			deposit.cumulativeAmount
		);
		_consumeEscrowedRepForVault(depositor, originalDepositAmount);
		emit ClaimDeposit(
			depositor,
			outcome,
			_getStableLocalParentDepositIndex(uint8(outcome), depositIndex),
			originalDepositAmount,
			amountToWithdraw,
			burnAmount,
			transferredRep
		);
	}
}
