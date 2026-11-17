// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameCarry } from './EscalationGameCarry.sol';

abstract contract EscalationGameEscrow is EscalationGameCarry {
	/// @notice Actual game inventory, distinct from mutually exclusive nominal reporter principal.
	function getDisputeBackingAttoRep() public view returns (uint256) {
		return _reporterRepBalance();
	}

	/// @notice Ordinary reports count only their retained contribution to escrow as collateral.
	/// @dev Continuation claims receive no collateral credit; nominal payouts remain unchanged.
	function getVaultDisputeBackingAttoRep(address vault) external view returns (uint256) {
		if (forkContinuation || ordinarySettlementInitialized || _usesCentralReporterCustody()) return 0;
		uint256 nominal = disputeStakedRepByVaultAttoRep(vault);
		uint256 backing = vaultAccounting[vault].collateralBackingAttoRep;
		return nominal < backing ? nominal : backing;
	}

	function getLocalUnresolvedPrincipalByVaultAndOutcome(address vault, BinaryOutcomes.BinaryOutcome outcome) external view returns (uint256) {
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		if (_isRetiredOrdinaryOutcome(uint8(outcome))) return 0;
		return vaultAccounting[vault].localUnresolvedPrincipalByOutcome[uint8(outcome)];
	}

	function _totalUnresolvedPrincipal() internal view returns (uint256 unresolvedPrincipal) {
		for (uint8 outcomeIndex = 0; outcomeIndex < 3; outcomeIndex++) {
			if (_isRetiredOrdinaryOutcome(outcomeIndex)) continue;
			unresolvedPrincipal +=
				_getEffectiveInheritedUnresolvedTotalAttoRep(outcomeIndex) +
				outcomeState[outcomeIndex].localUnresolvedTotalAttoRep;
		}
	}
}
