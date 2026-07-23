// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameEscrow } from './EscalationGameEscrow.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { CarriedDepositProof, Deposit, NonDecisionState } from './EscalationGameTypes.sol';
import { CarryConsumptionReason } from './interfaces/IEscalationGame.sol';

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
		Deposit memory deposit = _consumeLocalDeposit(outcomeIndex, depositIndex, CarryConsumptionReason.Export);
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
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
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
		require(outcome == questionResolution, 'Not winning outcome');
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		_emitCarryDepositConsumed(
			outcomeIndex,
			proof.depositor,
			proof.amount,
			proof.parentDepositIndex,
			proof.sourceNodeId,
			CarryConsumptionReason.WinningClaim
		);
		uint256 burnAmount;
		(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(outcomeIndex, proof.amount, proof.cumulativeAmount);
		if (amountToWithdraw > 0) {
			_safeTransferRep(depositor, amountToWithdraw);
		}
		_burnWinningHaircut(burnAmount, winnerHaircutPaidByFork);
		emit ClaimDeposit(
			depositor,
			outcome,
			proof.parentDepositIndex,
			originalDepositAmount,
			amountToWithdraw,
			burnAmount,
			true
		);
	}

	function exportUnresolvedDeposit(
		CarriedDepositProof calldata proof,
		BinaryOutcomes.BinaryOutcome outcome
	) public onlySecurityPoolOrForker returns (address depositor, uint256 amount, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(!forkCarrySnapshotRequiresForkedEscrow, 'Forked proof unsupported');
		uint8 outcomeIndex = uint8(outcome);
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		_emitCarryDepositConsumed(
			outcomeIndex,
			proof.depositor,
			proof.amount,
			proof.parentDepositIndex,
			proof.sourceNodeId,
			CarryConsumptionReason.Export
		);
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
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		if (outcome == questionResolution) {
			(depositor, amountToWithdraw, originalDepositAmount) = claimDepositForWinning(
				depositIndex,
				questionResolution
			);
			return (depositor, amountToWithdraw, originalDepositAmount);
		}
		Deposit memory deposit = _consumeLocalDeposit(
			uint8(outcome),
			depositIndex,
			CarryConsumptionReason.LosingSettlement
		);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		_consumeEscrowedRepForVault(depositor, originalDepositAmount);
	}

	function sweepResidualRepToSecurityPool() external {
		require(getFinalQuestionResolution() != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		require(_totalUnresolvedPrincipal() == 0, 'Principal remains');
		require(totalEscrowedRep == 0, 'Escrowed REP remains');
		uint256 amount = repToken.balanceOf(address(this));
		require(amount > 0, 'No sweepable REP');
		_safeTransferRep(address(securityPool), amount);
		emit ResidualRepSweptToSecurityPool(amount);
	}

	function drainAllRep(address receiver) external returns (uint256 amount) {
		require(msg.sender == address(securityPool), 'Only pool');
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

	function _getPayoutQuestionResolution() private view returns (BinaryOutcomes.BinaryOutcome questionResolution) {
		questionResolution = getFinalQuestionResolution();
		require(
			questionResolution ==
				ISecurityPoolForker(securityPool.securityPoolForker()).getQuestionOutcome(securityPool),
			'Pool/game outcome mismatch'
		);
	}

	function _claimDepositForWinning(
		uint256 depositIndex,
		BinaryOutcomes.BinaryOutcome outcome,
		bool transferredRep
	) private returns (address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) {
		Deposit memory deposit = _consumeLocalDeposit(
			uint8(outcome),
			depositIndex,
			transferredRep ? CarryConsumptionReason.WinningClaim : CarryConsumptionReason.DirectParentClaim
		);
		depositor = deposit.depositor;
		originalDepositAmount = deposit.amount;
		uint256 burnAmount;
		(amountToWithdraw, burnAmount) = _computeWinningWithdrawal(
			uint8(outcome),
			deposit.amount,
			deposit.cumulativeAmount
		);
		_consumeEscrowedRepForVault(depositor, originalDepositAmount);
		if (transferredRep) _burnWinningHaircut(burnAmount, false);
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

	function _burnWinningHaircut(uint256 burnAmount, bool haircutPaidByFork) private {
		if (burnAmount == 0) return;
		if (haircutPaidByFork) return;
		_safeTransferRep(address(securityPool), burnAmount);
		securityPool.burnEscalationWinnerHaircut(burnAmount);
	}
}
