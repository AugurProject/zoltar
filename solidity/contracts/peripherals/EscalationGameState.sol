// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { MerkleMountainRange } from './MerkleMountainRange.sol';
import { ForkedEscrowState, Node, NULLIFIER_DEPTH, OutcomeState } from './EscalationGameTypes.sol';

abstract contract EscalationGameState {
	uint256 public constant activationDelay = 3 days;
	uint256 public activationTime;
	ISecurityPool public immutable securityPool;
	ReputationToken public immutable repToken;
	uint256 public nonDecisionThreshold;
	uint256 public startBond;
	uint256 public lnRatioScaled;
	address public immutable owner;
	uint256 public nonDecisionTimestamp;
	bool public forkContinuation;
	uint256 public forkElapsedAtStart;
	uint256 public forkResumedAt;
	bytes32 internal immutable EMPTY_NULLIFIER_ROOT;
	// Outcome-indexed state uses 0 = Invalid, 1 = Yes, 2 = No.
	OutcomeState[3] internal outcomeState;
	uint256 public nextNodeId = 1;
	mapping(uint256 => Node) public nodes;
	mapping(address => uint256) public escrowedRepByVault;
	uint256 public totalEscrowedRep;
	mapping(address => uint256) public unresolvedRepByVault;
	uint256 public totalLocalUnresolvedRep;
	mapping(address => uint256[]) internal unresolvedLocalDepositRefsByVault;
	mapping(address => uint256) internal unresolvedLocalDepositExportCursorByVault;
	mapping(address => mapping(uint8 => ForkedEscrowState)) internal forkedEscrowByVaultAndOutcome;
	bool public forkCarrySnapshotRequiresForkedEscrow;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkCarrySnapshotInitialized(
		uint256[3] snapshotLeafCounts,
		uint256[3] inheritedTotals,
		bytes32[3] inheritedNullifierRoots
	);
	event ForkContinuationResumed(uint256 resumedAt);
	event DepositOnOutcome(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amount,
		uint256 depositIndex,
		uint256 cumulativeAmount
	);
	event WithdrawDeposit(
		address depositor,
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 amountToWithdraw,
		uint256 depositIndex
	);
	event ClaimDeposit(uint256 amountToWithdraw, uint256 burnAmount);
	event LocalDepositAppended(
		uint256 indexed nodeId,
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 cumulativeAmount
	);
	event CarriedDepositClaimed(
		BinaryOutcomes.BinaryOutcome outcome,
		address depositor,
		uint256 amount,
		uint256 parentDepositIndex,
		uint256 sourceNodeId,
		bytes32 leafHash
	);
	event ResidualRepSweptToSecurityPool(uint256 amount);

	constructor(ISecurityPool _securityPool, ReputationToken _repToken) {
		securityPool = _securityPool;
		repToken = _repToken;
		owner = msg.sender;
		EMPTY_NULLIFIER_ROOT = _computeEmptyNullifierRoot();
	}

	modifier onlySecurityPoolOrForker() {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only Security Pool or designated forker'
		);
		_;
	}

	function _sliceEnd(uint256 startIndex, uint256 count, uint256 total) internal pure returns (uint256) {
		if (startIndex >= total || count == 0) return startIndex;
		uint256 availableCount = total - startIndex;
		if (count >= availableCount) return total;
		return startIndex + count;
	}

	function _consumeEscrowedRepForVault(address depositor, uint256 amount) internal {
		if (amount == 0) return;
		uint256 escrowedRep = escrowedRepByVault[depositor];
		require(escrowedRep >= amount, 'ue');
		escrowedRepByVault[depositor] = escrowedRep - amount;
		totalEscrowedRep -= amount;
	}

	function _consumeUnresolvedRepForVault(address depositor, uint256 amount) internal {
		if (amount == 0) return;
		uint256 unresolvedRep = unresolvedRepByVault[depositor];
		require(unresolvedRep >= amount, 'uor');
		require(totalLocalUnresolvedRep >= amount, 'utb');
		unresolvedRepByVault[depositor] = unresolvedRep - amount;
		totalLocalUnresolvedRep -= amount;
	}

	function _computeEmptyNullifierRoot() private pure returns (bytes32 root) {
		root = bytes32(0);
		for (uint256 depth = 0; depth < NULLIFIER_DEPTH; depth++) {
			root = MerkleMountainRange.hashParent(root, root);
		}
	}
}
