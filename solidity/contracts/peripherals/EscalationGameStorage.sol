// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ForkedEscrowState, Node, OutcomeState } from './EscalationGameTypes.sol';

abstract contract EscalationGameStorage {
	uint256 public activationTime;
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	uint256 internal lnRatioScaled;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	OutcomeState[3] internal outcomeState;
	uint256 internal nextNodeId = 1;
	mapping(uint256 => Node) public nodes;
	mapping(address => uint256) public escrowedRepByVault;
	uint256 public totalEscrowedRep;
	mapping(address => uint256) internal unresolvedRepByVault;
	uint256 internal totalLocalUnresolvedRep;
	mapping(address => uint256[3]) internal localUnresolvedPrincipalByVaultAndOutcome;
	mapping(address => bool) internal localUnresolvedTotalsExportedByVault;
	mapping(address => mapping(uint8 => ForkedEscrowState)) internal forkedEscrowByVaultAndOutcome;
	bool internal forkCarrySnapshotRequiresForkedEscrow;
}
