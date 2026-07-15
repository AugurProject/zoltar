// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCarry } from './EscalationGameCarry.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { ForkedEscrowState, OutcomeState } from './EscalationGameTypes.sol';

abstract contract EscalationGameEscrow is EscalationGameCarry {
	function getLocalUnresolvedPrincipalByVaultAndOutcome(
		address vault,
		BinaryOutcomes.BinaryOutcome outcome
	) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		return localUnresolvedPrincipalByVaultAndOutcome[vault][uint8(outcome)];
	}

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

	function exportVaultUnresolvedTotals(
		address vault,
		address repReceiver
	) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcome) {
		return _exportVaultUnresolvedTotals(vault, repReceiver, true);
	}

	function exportVaultUnresolvedTotalsWithoutTransfer(
		address vault
	) external onlySecurityPoolOrForker returns (uint256[3] memory principalByOutcome) {
		return _exportVaultUnresolvedTotals(vault, address(0x0), false);
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

	function _exportVaultUnresolvedTotals(
		address vault,
		address repReceiver,
		bool transferRep
	) private returns (uint256[3] memory principalByOutcome) {
		require(vault != address(0x0), 'Vault is zero');
		require(!localUnresolvedTotalsExportedByVault[vault], 'Vault totals exported');
		localUnresolvedTotalsExportedByVault[vault] = true;
		uint256 principalToTransfer;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 principal = localUnresolvedPrincipalByVaultAndOutcome[vault][outcomeIndex];
			principalByOutcome[outcomeIndex] = principal;
			principalToTransfer += principal;
			delete localUnresolvedPrincipalByVaultAndOutcome[vault][outcomeIndex];
		}
		emit VaultUnresolvedTotalsExported(vault, repReceiver, principalByOutcome, principalToTransfer, transferRep);
		if (principalToTransfer == 0) return principalByOutcome;
		_consumeUnresolvedRepForVault(vault, principalToTransfer);
		_consumeEscrowedRepForVault(vault, principalToTransfer);
		if (transferRep) _safeTransferRep(repReceiver, principalToTransfer);
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
}
