// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCarry } from './EscalationGameCarry.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import {
	Deposit,
	ForkedEscrowState,
	LOCAL_DEPOSIT_REF_INDEX_MASK,
	LOCAL_DEPOSIT_REF_OUTCOME_SHIFT,
	MAX_UNRESOLVED_EXPORT_REFS,
	OutcomeState
} from './EscalationGameTypes.sol';

abstract contract EscalationGameEscrow is EscalationGameCarry {
	function recordForkedEscrowForOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipal,
		uint256 childRepAmount
	) external onlySecurityPoolOrForker {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		require(depositor != address(0x0), 'Depositor is zero');
		if (sourcePrincipal == 0 && childRepAmount == 0) return;
		require(sourcePrincipal > 0, 'Escrow principal missing');
		ForkedEscrowState storage state = _recordForkedEscrow(depositor, outcome, sourcePrincipal, childRepAmount);
		OutcomeState storage outcomeStateForEscrow = outcomeState[uint8(outcome)];
		if (forkCarrySnapshotRequiresForkedEscrow) {
			if (
				outcomeStateForEscrow.forkedEscrowSourcePrincipalTotal == outcomeStateForEscrow.inheritedUnresolvedTotal
			) {
				outcomeStateForEscrow.balance += sourcePrincipal;
				outcomeStateForEscrow.inheritedUnresolvedTotal += sourcePrincipal;
			}
			outcomeStateForEscrow.forkedEscrowSourcePrincipalTotal += sourcePrincipal;
		}
		uint256 outcomeBalance = outcomeStateForEscrow.balance;
		emit ForkedEscrowRecorded(
			depositor,
			outcome,
			state.sourcePrincipal,
			state.childRep,
			escrowedRepByVault[depositor],
			totalEscrowedRep,
			outcomeBalance
		);
	}

	function getForkedEscrowByVaultAndOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome
	)
		external
		view
		returns (uint256 sourcePrincipal, uint256 sourcePrincipalClaimed, uint256 childRep, uint256 childRepClaimed)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		return (state.sourcePrincipal, state.sourcePrincipalClaimed, state.childRep, state.childRepClaimed);
	}

	function exportVaultUnresolvedDepositAmounts(
		address vault,
		address repReceiver
	) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcome) {
		(, principalByOutcome) = _exportVaultUnresolvedDepositBatchDetailed(vault, repReceiver, true);
	}

	function exportVaultUnresolvedDepositAmountsWithoutTransfer(
		address vault
	) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcome) {
		(, principalByOutcome) = _exportVaultUnresolvedDepositBatchDetailed(vault, address(0x0), false);
	}

	function exportForkedEscrowByOutcome(
		address vault,
		address repReceiver
	)
		external
		onlySecurityPoolOrForker
		returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory childRepByOutcome)
	{
		require(repReceiver != address(0x0), 'REP receiver zero');
		return _exportForkedEscrowByOutcome(vault, repReceiver, true);
	}

	function exportForkedEscrowByOutcomeWithoutTransfer(
		address vault
	)
		external
		onlySecurityPoolOrForker
		returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory childRepByOutcome)
	{
		return _exportForkedEscrowByOutcome(vault, address(0x0), false);
	}

	function hasUnexportedLocalDepositRefs(address vault) external view returns (bool) {
		return unresolvedLocalDepositExportCursorByVault[vault] < unresolvedLocalDepositRefsByVault[vault].length;
	}

	function hasUnexportedForkedEscrow(address vault) external view returns (bool) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[vault][outcomeIndex];
			if (state.sourcePrincipal > state.sourcePrincipalClaimed || state.childRep > state.childRepClaimed) {
				return true;
			}
		}
		return false;
	}

	function _encodeLocalDepositRef(uint8 outcomeIndex, uint256 depositIndex) internal pure returns (uint256) {
		require(depositIndex <= LOCAL_DEPOSIT_REF_INDEX_MASK, 'Deposit index too large');
		return (uint256(outcomeIndex) << LOCAL_DEPOSIT_REF_OUTCOME_SHIFT) | depositIndex;
	}

	function _consumeForkedEscrow(
		address vault,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipalToClaim
	) internal returns (uint256 forkedEscrowPrincipal, uint256 forkedEscrowChildRep, uint256 childRepToRelease) {
		if (sourcePrincipalToClaim == 0) return (0, 0, 0);
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[vault][uint8(outcome)];
		forkedEscrowPrincipal = state.sourcePrincipal;
		if (forkedEscrowPrincipal == 0) return (0, 0, 0);
		forkedEscrowChildRep = state.childRep;
		uint256 nextSourcePrincipalClaimed = state.sourcePrincipalClaimed + sourcePrincipalToClaim;
		require(nextSourcePrincipalClaimed <= forkedEscrowPrincipal, 'Escrow claim exceeds principal');
		uint256 nextChildRepClaimed = Math.ceilDiv(
			nextSourcePrincipalClaimed * forkedEscrowChildRep,
			forkedEscrowPrincipal
		);
		childRepToRelease = nextChildRepClaimed - state.childRepClaimed;
		state.sourcePrincipalClaimed = nextSourcePrincipalClaimed;
		state.childRepClaimed = nextChildRepClaimed;
		emit ForkedEscrowClaimed(vault, outcome, state.sourcePrincipalClaimed, state.childRepClaimed);
	}

	function _scaleForkedEscrowAmount(
		uint256 sourceAmount,
		uint256 forkedEscrowChildRep,
		uint256 forkedEscrowPrincipal
	) internal pure returns (uint256) {
		if (sourceAmount == 0) return 0;
		return Math.ceilDiv(sourceAmount * forkedEscrowChildRep, forkedEscrowPrincipal);
	}

	function _totalUnresolvedPrincipal() internal view returns (uint256 unresolvedPrincipal) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			unresolvedPrincipal +=
				outcomeState[outcomeIndex].inheritedUnresolvedTotal + outcomeState[outcomeIndex].localUnresolvedTotal;
		}
	}

	function _recordForkedEscrow(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 sourcePrincipal,
		uint256 childRepAmount
	) private returns (ForkedEscrowState storage state) {
		state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		state.sourcePrincipal += sourcePrincipal;
		state.childRep += childRepAmount;
		escrowedRepByVault[depositor] += childRepAmount;
		totalEscrowedRep += childRepAmount;
	}

	function _exportVaultUnresolvedDepositBatchDetailed(
		address vault,
		address repReceiver,
		bool transferRep
	) private returns (uint256 principalToTransfer, uint256[3] memory principalByOutcome) {
		uint256[] storage depositRefs = unresolvedLocalDepositRefsByVault[vault];
		uint256 cursor = unresolvedLocalDepositExportCursorByVault[vault];
		uint256 maxRefIndex = cursor + MAX_UNRESOLVED_EXPORT_REFS;
		if (maxRefIndex > depositRefs.length) maxRefIndex = depositRefs.length;
		for (uint256 refIndex = cursor; refIndex < maxRefIndex; refIndex++) {
			(uint8 outcomeIndex, uint256 depositIndex) = _decodeLocalDepositRef(depositRefs[refIndex]);
			OutcomeState storage state = outcomeState[outcomeIndex];
			if (depositIndex >= state.deposits.length) continue;
			Deposit memory deposit = state.deposits[depositIndex];
			if (deposit.amount == 0 || deposit.depositor != vault) continue;
			Deposit memory consumedDeposit = _consumeLocalDeposit(outcomeIndex, depositIndex);
			state.balance -= consumedDeposit.amount;
			principalToTransfer += consumedDeposit.amount;
			principalByOutcome[outcomeIndex] += consumedDeposit.amount;
		}
		unresolvedLocalDepositExportCursorByVault[vault] = maxRefIndex;
		emit LocalDepositsExported(
			vault,
			repReceiver,
			principalByOutcome,
			principalToTransfer,
			maxRefIndex,
			transferRep
		);
		if (principalToTransfer == 0) return (0, principalByOutcome);
		_consumeEscrowedRepForVault(vault, principalToTransfer);
		if (transferRep) {
			_safeTransferRep(repReceiver, principalToTransfer);
		}
	}

	function _exportForkedEscrowByOutcome(
		address vault,
		address repReceiver,
		bool transferRep
	) private returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory childRepByOutcome) {
		require(vault != address(0x0), 'Vault is zero');
		uint256 totalChildRepToTransfer;
		bool exported;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[vault][outcomeIndex];
			uint256 sourcePrincipal = state.sourcePrincipal;
			uint256 childRep = state.childRep;
			uint256 remainingSourcePrincipal = sourcePrincipal - state.sourcePrincipalClaimed;
			uint256 remainingChildRep = childRep - state.childRepClaimed;
			if (remainingSourcePrincipal == 0 && remainingChildRep == 0) continue;
			sourcePrincipalByOutcome[outcomeIndex] = remainingSourcePrincipal;
			childRepByOutcome[outcomeIndex] = remainingChildRep;
			state.sourcePrincipalClaimed = sourcePrincipal;
			state.childRepClaimed = childRep;
			totalChildRepToTransfer += remainingChildRep;
			exported = true;
		}
		if (exported) {
			emit ForkedEscrowExported(
				vault,
				repReceiver,
				sourcePrincipalByOutcome,
				childRepByOutcome,
				totalChildRepToTransfer,
				transferRep
			);
		}
		if (totalChildRepToTransfer == 0) return (sourcePrincipalByOutcome, childRepByOutcome);
		_consumeEscrowedRepForVault(vault, totalChildRepToTransfer);
		if (transferRep) {
			_safeTransferRep(repReceiver, totalChildRepToTransfer);
		}
	}

	function _decodeLocalDepositRef(
		uint256 depositRef
	) private pure returns (uint8 outcomeIndex, uint256 depositIndex) {
		outcomeIndex = uint8(depositRef >> LOCAL_DEPOSIT_REF_OUTCOME_SHIFT);
		require(outcomeIndex < 3, 'Bad deposit ref outcome');
		depositIndex = depositRef & LOCAL_DEPOSIT_REF_INDEX_MASK;
	}
}
