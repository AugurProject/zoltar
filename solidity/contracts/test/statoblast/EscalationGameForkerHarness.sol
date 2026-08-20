// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../../statoblast/BinaryOutcomes.sol';
import { EscalationGame } from '../../statoblast/EscalationGame.sol';

contract EscalationGameForkerHarness {
	function exportUnresolvedRepForTest(EscalationGame parentEscalationGame, address vault)
		external
		returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory currentRepByOutcomeAttoRep)
	{
		if (parentEscalationGame.forkContinuation()) {
			(sourcePrincipalByOutcomeAttoRep, currentRepByOutcomeAttoRep) = parentEscalationGame.exportForkedEscrowByOutcomeWithoutTransfer(vault);
		}
		uint256[3] memory localPrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedTotalsWithoutTransfer(vault);
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			sourcePrincipalByOutcomeAttoRep[outcomeIndex] += localPrincipalByOutcome[outcomeIndex];
			currentRepByOutcomeAttoRep[outcomeIndex] += localPrincipalByOutcome[outcomeIndex];
		}
	}

	function migrateForkedEscrowWithoutTransferForTest(EscalationGame parentEscalationGame, EscalationGame childEscalationGame, address vault)
		external
		returns (uint256[3] memory sourcePrincipalByOutcomeAttoRep, uint256[3] memory currentRepByOutcomeAttoRep)
	{
		(sourcePrincipalByOutcomeAttoRep, currentRepByOutcomeAttoRep) = this.exportUnresolvedRepForTest(parentEscalationGame, vault);
		uint256 totalSourcePrincipal = _sumOutcomeAmounts(sourcePrincipalByOutcomeAttoRep);
		if (totalSourcePrincipal == 0) return (sourcePrincipalByOutcomeAttoRep, currentRepByOutcomeAttoRep);
		uint256 totalCurrentAttoRep = _sumOutcomeAmounts(currentRepByOutcomeAttoRep);
		uint256 allocatedChildAttoRep;
		uint256 allocatedCurrentAttoRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 outcomeSourcePrincipal = sourcePrincipalByOutcomeAttoRep[outcomeIndex];
			uint256 outcomeCurrentAttoRep = currentRepByOutcomeAttoRep[outcomeIndex];
			if (outcomeSourcePrincipal == 0 && outcomeCurrentAttoRep == 0) continue;
			allocatedCurrentAttoRep += outcomeCurrentAttoRep;
			uint256 outcomeChildAttoRep =
				allocatedCurrentAttoRep == totalCurrentAttoRep
					? totalCurrentAttoRep - allocatedChildAttoRep
					: (outcomeCurrentAttoRep * totalCurrentAttoRep) / totalCurrentAttoRep;
			allocatedChildAttoRep += outcomeChildAttoRep;
			childEscalationGame.recordForkedEscrowForOutcome(vault, BinaryOutcomes.BinaryOutcome(outcomeIndex), outcomeSourcePrincipal, outcomeChildAttoRep);
		}
	}

	function _sumOutcomeAmounts(uint256[3] memory amounts) private pure returns (uint256 total) {
		return amounts[0] + amounts[1] + amounts[2];
	}
}
