// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../../peripherals/BinaryOutcomes.sol';
import { EscalationGame } from '../../peripherals/EscalationGame.sol';

contract EscalationGameForkerHarness {
	function exportUnresolvedRepForTest(
		EscalationGame parentEscalationGame,
		address vault
	) external returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) {
		if (parentEscalationGame.forkContinuation()) {
			(sourcePrincipalByOutcome, currentRepByOutcome) = parentEscalationGame
				.exportForkedEscrowByOutcomeWithoutTransfer(vault);
		}
		if (_sumOutcomeAmounts(sourcePrincipalByOutcome) != 0) return (sourcePrincipalByOutcome, currentRepByOutcome);
		sourcePrincipalByOutcome = parentEscalationGame.exportVaultUnresolvedDepositAmountsWithoutTransfer(vault);
		currentRepByOutcome = sourcePrincipalByOutcome;
	}

	function migrateForkedEscrowWithoutTransferForTest(
		EscalationGame parentEscalationGame,
		EscalationGame childEscalationGame,
		address vault
	) external returns (uint256[3] memory sourcePrincipalByOutcome, uint256[3] memory currentRepByOutcome) {
		(sourcePrincipalByOutcome, currentRepByOutcome) = this.exportUnresolvedRepForTest(parentEscalationGame, vault);
		uint256 totalSourcePrincipal = _sumOutcomeAmounts(sourcePrincipalByOutcome);
		if (totalSourcePrincipal == 0) return (sourcePrincipalByOutcome, currentRepByOutcome);
		uint256 totalCurrentRep = _sumOutcomeAmounts(currentRepByOutcome);
		uint256 allocatedChildRep;
		uint256 allocatedCurrentRep;
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			uint256 outcomeSourcePrincipal = sourcePrincipalByOutcome[outcomeIndex];
			uint256 outcomeCurrentRep = currentRepByOutcome[outcomeIndex];
			if (outcomeSourcePrincipal == 0 && outcomeCurrentRep == 0) continue;
			allocatedCurrentRep += outcomeCurrentRep;
			uint256 outcomeChildRep =
				allocatedCurrentRep == totalCurrentRep
					? totalCurrentRep - allocatedChildRep
					: (outcomeCurrentRep * totalCurrentRep) / totalCurrentRep;
			allocatedChildRep += outcomeChildRep;
			childEscalationGame.recordForkedEscrowForOutcome(
				vault,
				BinaryOutcomes.BinaryOutcome(outcomeIndex),
				outcomeSourcePrincipal,
				outcomeChildRep
			);
		}
	}

	function _sumOutcomeAmounts(uint256[3] memory amounts) private pure returns (uint256 total) {
		return amounts[0] + amounts[1] + amounts[2];
	}
}
