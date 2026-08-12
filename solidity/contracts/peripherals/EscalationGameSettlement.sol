// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameEscrow } from './EscalationGameEscrow.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { CarriedDepositProof, Deposit, Node, NonDecisionState, OutcomeState } from './EscalationGameTypes.sol';
import { CarryConsumptionReason } from './interfaces/IEscalationGame.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';

abstract contract EscalationGameSettlement is EscalationGameEscrow {
	function claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		(depositor, amountToWithdrawAttoRep, originalDepositAmountAttoRep) = _claimDepositForWinning(depositIndex, outcome, true);
		_creditClaimOwners(depositor, amountToWithdrawAttoRep);
	}

	function claimDepositForWinningWithoutTransfer(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep)
	{
		return _claimDepositForWinning(depositIndex, outcome, false);
	}

	function exportUnresolvedDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public onlySecurityPoolOrForker returns (address depositor, uint256 amountAttoRep, uint256 parentDepositIndex) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		uint8 outcomeIndex = uint8(outcome);
		Deposit memory deposit = _consumeLocalDeposit(outcomeIndex, depositIndex, CarryConsumptionReason.Export);
		depositor = deposit.depositor;
		amountAttoRep = deposit.amountAttoRep;
		_consumeEscrowedRepForBundle(depositor, amountAttoRep);
		parentDepositIndex = _getStableLocalParentDepositIndex(outcomeIndex, depositIndex);
	}

	function withdrawDeposit(CarriedDepositProof calldata proof, BinaryOutcomes.BinaryOutcome outcome)
		public
		onlySecurityPoolOrForker
		returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmountAttoRep = proof.amountAttoRep;
		require(!ISecurityPoolForker(securityPool.securityPoolForker()).isEscalationDepositClaimedDirectly(securityPool.parent(), outcome, proof.parentDepositIndex), 'Parent deposit claimed');
		require(outcome == questionResolution, 'Not winning outcome');
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		_emitCarryDepositConsumed(outcomeIndex, proof.depositor, proof.amountAttoRep, proof.parentDepositIndex, proof.sourceNodeId, CarryConsumptionReason.WinningClaim);
		uint256 burnAmountAttoRep;
		(amountToWithdrawAttoRep, burnAmountAttoRep) = _computeCarriedWinningWithdrawal(outcomeIndex, proof.amountAttoRep, proof.cumulativeAmountAttoRep, proof.parentDepositIndex);
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.creditExternalClaimOwners, (forkCarrySourceGame, depositor, proof.parentDepositIndex, amountToWithdrawAttoRep, burnAmountAttoRep)));
		_burnWinningHaircut(burnAmountAttoRep, winnerHaircutPaidByFork);
		emit ClaimDeposit(depositor, outcome, proof.parentDepositIndex, originalDepositAmountAttoRep, amountToWithdrawAttoRep, burnAmountAttoRep, true);
	}

	function withdrawDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		require(msg.sender == address(securityPool), 'Only pool');
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		if (outcome == questionResolution) {
			(depositor, amountToWithdrawAttoRep, originalDepositAmountAttoRep) = claimDepositForWinning(depositIndex, questionResolution);
			return (depositor, amountToWithdrawAttoRep, originalDepositAmountAttoRep);
		}
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex, CarryConsumptionReason.LosingSettlement);
		depositor = deposit.depositor;
		originalDepositAmountAttoRep = deposit.amountAttoRep;
		_consumeEscrowedRepForBundle(depositor, originalDepositAmountAttoRep);
	}

	function sweepResidualRepToSecurityPool() external {
		require(getFinalQuestionResolution() != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		require(_totalUnresolvedPrincipal() == 0, 'Principal remains');
		totalDisputeStakedAttoRep -= forkCarryDisputeStakedAttoRep;
		forkCarryDisputeStakedAttoRep = 0;
		require(totalDisputeStakedAttoRep == 0, 'Escrowed REP remains');
		uint256 amountAttoRep = repToken.balanceOf(address(this));
		require(amountAttoRep > 0, 'No sweepable REP');
		_safeTransferRep(address(securityPool), amountAttoRep);
		emit ResidualRepSweptToSecurityPool(amountAttoRep);
	}

	function drainAllRep(address receiver) external returns (uint256 amountAttoRep) {
		require(msg.sender == address(securityPool), 'Only pool');
		require(receiver != address(0x0), 'REP receiver zero');
		amountAttoRep = repToken.balanceOf(address(this));
		if (amountAttoRep == 0) return 0;
		_safeTransferRep(receiver, amountAttoRep);
	}

	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new Deposit[](0);
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 iterateUntil = _sliceEnd(startIndex, numberOfEntries, state.localNodeIds.length);
		if (iterateUntil <= startIndex) return new Deposit[](0);
		returnDeposits = new Deposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			Node storage node = nodes[state.localNodeIds[index]];
			uint256 amountAttoRep =
				state.consumedParentDepositIndexes[node.parentDepositIndex] ? 0 : node.amountAttoRep;
			returnDeposits[index - startIndex] = Deposit(node.depositor, amountAttoRep, node.cumulativeAmountAttoRep);
		}
	}

	function getDepositsByOutcomeLength(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return 0;
		return outcomeState[uint8(outcome)].localNodeIds.length;
	}

	function _getPayoutQuestionResolution() private view returns (BinaryOutcomes.BinaryOutcome questionResolution) {
		questionResolution = getFinalQuestionResolution();
		require(questionResolution == ISecurityPoolForker(securityPool.securityPoolForker()).getQuestionOutcome(securityPool), 'Pool/game outcome mismatch');
	}

	function _claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome, bool transferredRep) private returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		Deposit memory deposit = _consumeLocalDeposit(uint8(outcome), depositIndex, transferredRep ? CarryConsumptionReason.WinningClaim : CarryConsumptionReason.DirectParentClaim);
		depositor = deposit.depositor;
		originalDepositAmountAttoRep = deposit.amountAttoRep;
		uint256 burnAmountAttoRep;
		(amountToWithdrawAttoRep, burnAmountAttoRep) = _computeWinningWithdrawal(uint8(outcome), deposit.amountAttoRep, deposit.cumulativeAmountAttoRep);
		_consumeEscrowedRepForBundle(depositor, originalDepositAmountAttoRep);
		if (transferredRep) _burnWinningHaircut(burnAmountAttoRep, false);
		emit ClaimDeposit(depositor, outcome, _getStableLocalParentDepositIndex(uint8(outcome), depositIndex), originalDepositAmountAttoRep, amountToWithdrawAttoRep, burnAmountAttoRep, transferredRep);
	}

	function _burnWinningHaircut(uint256 burnAmountAttoRep, bool haircutPaidByFork) private {
		if (burnAmountAttoRep == 0) return;
		if (haircutPaidByFork) return;
		_safeTransferRep(address(securityPool), burnAmountAttoRep);
		securityPool.burnEscalationWinnerHaircut(burnAmountAttoRep);
	}
}
