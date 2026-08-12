// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCarry } from './EscalationGameCarry.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
import { ForkedEscrowState, OutcomeState } from './EscalationGameTypes.sol';

abstract contract EscalationGameEscrow is EscalationGameCarry {
	function getLocalUnresolvedPrincipalByVaultAndOutcome(address vault, BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		return localUnresolvedPrincipalByVaultAndOutcome[vault][uint8(outcome)];
	}

	function recordForkedEscrowForOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome, uint256 sourcePrincipalAttoRep, uint256 childRepAmountAttoRep) external onlySecurityPoolOrForker {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.recordForkedEscrowForOutcome, (depositor, outcome, sourcePrincipalAttoRep, childRepAmountAttoRep)));
	}

	function getForkedEscrowByVaultAndOutcome(address depositor, BinaryOutcomes.BinaryOutcome outcome)
		external
		view
		returns (
			uint256 sourcePrincipalAttoRep,
			uint256 sourcePrincipalClaimedAttoRep,
			uint256 childAttoRep,
			uint256 childRepClaimedAttoRep
		)
	{
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[depositor][uint8(outcome)];
		return (
			state.sourcePrincipalAttoRep,
			state.sourcePrincipalClaimedAttoRep,
			_applyTruthAuctionRetention(state.childAttoRep),
			_applyTruthAuctionRetention(state.childRepClaimedAttoRep)
		);
	}

	function exportVaultUnresolvedTotals(address vault, address repReceiver) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcomeAttoRep) {
		return _exportVaultUnresolvedTotals(vault, repReceiver, true);
	}

	function exportVaultUnresolvedTotalsWithoutTransfer(address vault) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcomeAttoRep) {
		return _exportVaultUnresolvedTotals(vault, address(0x0), false);
	}

	function exportForkedEscrowByOutcome(address vault, address repReceiver)
		external
		onlySecurityPoolOrForker
		returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory childRepByOutcomeAttoRep)
	{
		require(repReceiver != address(0x0), 'REP receiver zero');
		return _exportForkedEscrowByOutcome(vault, repReceiver, true);
	}

	function exportForkedEscrowByOutcomeWithoutTransfer(address vault)
		external
		onlySecurityPoolOrForker
		returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory childRepByOutcomeAttoRep)
	{
		return _exportForkedEscrowByOutcome(vault, address(0x0), false);
	}

	function _totalUnresolvedPrincipal() internal view returns (uint256 unresolvedPrincipal) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			unresolvedPrincipal +=
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) +
				outcomeState[outcomeIndex].localUnresolvedTotalAttoRep;
		}
	}

	function _exportVaultUnresolvedTotals(address vault, address repReceiver, bool transferRep) private returns (uint256[3] memory principalByOutcomeAttoRep) {
		require(vault != address(0x0), 'Vault is zero');
		require(!localUnresolvedTotalsExportedByVault[vault], 'Vault totals exported');
		localUnresolvedTotalsExportedByVault[vault] = true;
		uint256 principalToTransferAttoRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 principal = localUnresolvedPrincipalByVaultAndOutcome[vault][outcomeIndex];
			principalByOutcomeAttoRep[outcomeIndex] = principal;
			principalToTransferAttoRep += principal;
			delete localUnresolvedPrincipalByVaultAndOutcome[vault][outcomeIndex];
		}
		emit VaultUnresolvedTotalsExported(vault, repReceiver, principalByOutcomeAttoRep, principalToTransferAttoRep, transferRep);
		if (principalToTransferAttoRep == 0) return principalByOutcomeAttoRep;
		_consumeUnresolvedRepForVault(vault, principalToTransferAttoRep);
		_consumeEscrowedRepForOwner(vault, principalToTransferAttoRep);
		if (transferRep) _safeTransferRep(repReceiver, principalToTransferAttoRep);
	}

	function _exportForkedEscrowByOutcome(address vault, address repReceiver, bool transferRep) private returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory childRepByOutcomeAttoRep) {
		require(vault != address(0x0), 'Vault is zero');
		uint256 totalChildRepToTransferAttoRep;
		bool exported;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			ForkedEscrowState storage state = forkedEscrowByVaultAndOutcome[vault][outcomeIndex];
			uint256 sourcePrincipalAttoRep = state.sourcePrincipalAttoRep;
			uint256 childAttoRep = state.childAttoRep;
			uint256 remainingSourcePrincipalAttoRep = sourcePrincipalAttoRep - state.sourcePrincipalClaimedAttoRep;
			uint256 remainingChildAttoRep = _applyTruthAuctionRetention(childAttoRep - state.childRepClaimedAttoRep);
			if (remainingSourcePrincipalAttoRep == 0 && remainingChildAttoRep == 0) continue;
			sourcePrincipalByOutcomeAttoRep[outcomeIndex] = remainingSourcePrincipalAttoRep;
			childRepByOutcomeAttoRep[outcomeIndex] = remainingChildAttoRep;
			state.sourcePrincipalClaimedAttoRep = sourcePrincipalAttoRep;
			state.childRepClaimedAttoRep = childAttoRep;
			totalChildRepToTransferAttoRep += remainingChildAttoRep;
			exported = true;
		}
		if (exported) {
			emit ForkedEscrowExported(vault, repReceiver, sourcePrincipalByOutcomeAttoRep, childRepByOutcomeAttoRep, totalChildRepToTransferAttoRep, transferRep);
		}
		if (totalChildRepToTransferAttoRep == 0) return (sourcePrincipalByOutcomeAttoRep, childRepByOutcomeAttoRep);
		_consumeEscrowedRepForOwner(vault, totalChildRepToTransferAttoRep);
		if (transferRep) {
			if (winnerHaircutPaidByFork && forkResumedAt == 0) {
				unchecked {
					forkCarryBackingExportedBeforeResumeAttoRep += totalChildRepToTransferAttoRep;
					forkCarryDisputeStakedAttoRep -= totalChildRepToTransferAttoRep;
					totalDisputeStakedAttoRep -= totalChildRepToTransferAttoRep;
				}
			}
			_safeTransferRep(repReceiver, totalChildRepToTransferAttoRep);
		}
	}
}
