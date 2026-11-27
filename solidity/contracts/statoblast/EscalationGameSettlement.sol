// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Pagination } from '../Pagination.sol';

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCarry } from './EscalationGameCarry.sol';
import { IQuestionForker } from './interfaces/IQuestionForker.sol';
import { CarriedDepositProof, Deposit, Node, NonDecisionState, OutcomeState } from './EscalationGameTypes.sol';
import { CarryConsumptionReason } from './interfaces/IEscalationGame.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';

abstract contract EscalationGameSettlement is EscalationGameCarry {
	/// @notice Actual game inventory, distinct from mutually exclusive nominal reporter principal.
	function getDisputeBackingAttoRep() public view returns (uint256) {
		return _reporterRepBalance();
	}

	function getLocalUnresolvedPrincipalByVaultAndOutcome(address vault, BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		if (_isRetiredOrdinaryOutcome(uint8(outcome))) return 0;
		return localUnresolvedPrincipalByVault[vault][uint8(outcome)];
	}

	function withdrawDeposit(CarriedDepositProof calldata proof, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		require(msg.sender == address(questionLedger), 'Only pool');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		uint8 outcomeIndex = uint8(outcome);
		depositor = proof.depositor;
		originalDepositAmountAttoRep = proof.amountAttoRep;
		require(outcome == questionResolution, 'Not winning outcome');
		_verifyAndConsumeCarriedDepositProof(outcomeIndex, proof);
		_emitCarryDepositConsumed(outcomeIndex, proof.depositor, proof.amountAttoRep, proof.parentDepositIndex, proof.sourceNodeId, CarryConsumptionReason.WinningClaim);
		uint256 burnAmountAttoRep;
		(amountToWithdrawAttoRep, burnAmountAttoRep) = _computeWinningWithdrawal(outcomeIndex, proof.amountAttoRep, proof.cumulativeAmountAttoRep);
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.creditExternalClaimOwners, (depositor, amountToWithdrawAttoRep, burnAmountAttoRep)));
		_burnWinningHaircut(burnAmountAttoRep, winnerHaircutPaidByFork);
		if (winnerHaircutPaidByFork) emit WinningHaircutPrepaid(outcome, proof.parentDepositIndex, burnAmountAttoRep);
		emit ClaimDeposit(depositor, outcome, proof.parentDepositIndex, originalDepositAmountAttoRep, amountToWithdrawAttoRep, winnerHaircutPaidByFork ? 0 : burnAmountAttoRep, true);
	}

	function withdrawDeposit(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) public returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		require(msg.sender == address(questionLedger), 'Only pool');
		require(nonDecisionState == NonDecisionState.None, 'Non-decision done');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionResolution = _getPayoutQuestionResolution();
		require(questionResolution != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		if (!forkContinuation) {
			_settleOrdinaryGame(false);
			require(questionResolution == ordinarySettlementOutcome, 'Not winning ordinary claim');
			if (outcome != questionResolution) {
				OutcomeState storage state = outcomeState[uint8(outcome)];
				require(depositIndex < state.localNodeIds.length, 'Bad deposit index');
				Node storage node = nodes[state.localNodeIds[depositIndex]];
				return (node.depositor, 0, node.amountAttoRep);
			}
		}
		if (outcome == questionResolution) return _claimDepositForWinning(depositIndex, outcome);
		(Deposit memory deposit, ) = _consumeLocalDeposit(uint8(outcome), depositIndex, CarryConsumptionReason.LosingSettlement);
		_consumeEscrowedRepForBundle(deposit.depositor, deposit.amountAttoRep);
		return (deposit.depositor, 0, deposit.amountAttoRep);
	}

	function sweepResidualRepToQuestionLedger() external {
		require(getFinalQuestionResolution() != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		if (!forkContinuation) {
			require(_settleOrdinaryGame(true) > 0, 'No sweepable REP');
			return;
		}
		require(_totalUnresolvedPrincipal() == 0, 'Principal remains');
		uint256 reconciledEscrow = forkCarryDisputeStakedAttoRep;
		totalDisputeStakedAttoRep -= reconciledEscrow;
		forkCarryDisputeStakedAttoRep = 0;
		require(totalDisputeStakedAttoRep == 0, 'Escrowed REP remains');
		uint256 amountAttoRep = _reporterRepBalance();
		require(amountAttoRep > 0 || reconciledEscrow > 0, 'No sweepable REP');
		if (amountAttoRep == 0) return;
		_safeTransferRep(address(questionLedger), amountAttoRep);
		// Continuation backing predates every child-local owner class. Burning its
		// terminal residual prevents both late capture and ownerless stranding.
		questionLedger.burnEscalationWinnerHaircut(amountAttoRep);
		emit ForkContinuationResidualRepBurned(amountAttoRep);
	}

	function settleOrdinaryGame() external {
		_settleOrdinaryGame(true);
	}

	function _settleOrdinaryGame(bool releaseSurplus) private returns (uint256) {
		return
			abi.decode(_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.settleOrdinaryGame, (proofVerifier, releaseSurplus))), (uint256));
	}

	function getDepositsByOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 startIndex, uint256 numberOfEntries) external view returns (Deposit[] memory returnDeposits) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return new Deposit[](0);
		uint8 outcomeIndex = uint8(outcome);
		OutcomeState storage state = outcomeState[outcomeIndex];
		uint256 iterateUntil = Pagination.sliceEnd(startIndex, numberOfEntries, state.localNodeIds.length);
		if (iterateUntil <= startIndex) return new Deposit[](0);
		returnDeposits = new Deposit[](iterateUntil - startIndex);
		for (uint256 index = startIndex; index < iterateUntil; index++) {
			Node storage node = nodes[state.localNodeIds[index]];
			uint256 amountAttoRep =
				_isRetiredOrdinaryOutcome(outcomeIndex) || state.consumedParentDepositIndexes[node.parentDepositIndex]
					? 0
					: node.amountAttoRep;
			returnDeposits[index - startIndex] = Deposit({depositor: node.depositor, amountAttoRep: amountAttoRep, cumulativeAmountAttoRep: node.cumulativeAmountAttoRep});
		}
	}

	function getDepositsByOutcomeLength(BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		if (outcome == BinaryOutcomes.BinaryOutcome.None) return 0;
		return outcomeState[uint8(outcome)].localNodeIds.length;
	}

	function _getPayoutQuestionResolution() private view returns (BinaryOutcomes.BinaryOutcome questionResolution) {
		questionResolution = getFinalQuestionResolution();
		require(questionResolution == IQuestionForker(questionLedger.questionForker()).getQuestionOutcome(questionLedger), 'Pool/game outcome mismatch');
	}

	/// @dev Ordinary games were settled by the caller, so their winning outcome is already fixed.
	function _claimDepositForWinning(uint256 depositIndex, BinaryOutcomes.BinaryOutcome outcome) private returns (address depositor, uint256 amountToWithdrawAttoRep, uint256 originalDepositAmountAttoRep) {
		(Deposit memory deposit, uint256 parentDepositIndex) = _consumeLocalDeposit(uint8(outcome), depositIndex, CarryConsumptionReason.WinningClaim);
		depositor = deposit.depositor;
		originalDepositAmountAttoRep = deposit.amountAttoRep;
		uint256 burnAmountAttoRep;
		(amountToWithdrawAttoRep, burnAmountAttoRep) = _computeWinningWithdrawal(uint8(outcome), deposit.amountAttoRep, deposit.cumulativeAmountAttoRep);
		if (ordinarySettlementInitialized) ordinaryWinningReserveAttoRep -= amountToWithdrawAttoRep + burnAmountAttoRep;
		_consumeEscrowedRepForBundle(depositor, originalDepositAmountAttoRep);
		_burnWinningHaircut(burnAmountAttoRep, false);
		emit ClaimDeposit(depositor, outcome, parentDepositIndex, originalDepositAmountAttoRep, amountToWithdrawAttoRep, burnAmountAttoRep, true);
		_creditClaimOwners(depositor, amountToWithdrawAttoRep);
	}

	function _totalUnresolvedPrincipal() private view returns (uint256 unresolvedPrincipal) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			if (_isRetiredOrdinaryOutcome(outcomeIndex)) continue;
			unresolvedPrincipal +=
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) +
				outcomeState[outcomeIndex].localUnresolvedTotalAttoRep;
		}
	}

	function _burnWinningHaircut(uint256 burnAmountAttoRep, bool haircutPaidByFork) private {
		if (burnAmountAttoRep == 0) return;
		if (haircutPaidByFork) return;
		_safeTransferRep(address(questionLedger), burnAmountAttoRep);
		questionLedger.burnEscalationWinnerHaircut(burnAmountAttoRep);
	}
}
