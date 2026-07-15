// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';

abstract contract EscalationGameState is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;

	uint256 internal constant activationDelay = 3 days;
	ISecurityPool public immutable securityPool;
	ReputationToken public immutable repToken;
	EscalationGameProofVerifier internal immutable proofVerifier;
	address internal immutable owner;
	bytes32 internal immutable EMPTY_NULLIFIER_ROOT;

	event GameStarted(uint256 activationTime, uint256 startBond, uint256 nonDecisionThreshold);
	event GameContinuedFromFork(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork);
	event ForkContinuationResumed(uint256 resumedAt);
	event ClaimDeposit(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 indexed parentDepositIndex,
		uint256 originalDepositAmount,
		uint256 amountToWithdraw,
		uint256 burnAmount,
		bool transferredRep
	);
	event VaultUnresolvedTotalsExported(
		address indexed vault,
		address repReceiver,
		uint256[3] principalByOutcome,
		uint256 principalToTransfer,
		bool transferredRep
	);
	event ForkedEscrowRecorded(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipalTotal,
		uint256 childRepTotal,
		uint256 escrowedRepByVault,
		uint256 totalEscrowedRep,
		uint256 outcomeBalance
	);
	event VaultEscrowUpdated(address indexed vault, uint256 escrowedRepByVault, uint256 totalEscrowedRep);
	event ForkedEscrowClaimed(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipalClaimed,
		uint256 childRepClaimed
	);
	event ForkedEscrowExported(
		address indexed vault,
		address repReceiver,
		uint256[3] sourcePrincipalByOutcome,
		uint256[3] childRepByOutcome,
		uint256 totalChildRepToTransfer,
		bool transferredRep
	);
	event ResidualRepSweptToSecurityPool(uint256 amount);

	constructor(ISecurityPool _securityPool, ReputationToken _repToken, EscalationGameProofVerifier _proofVerifier) {
		securityPool = _securityPool;
		repToken = _repToken;
		proofVerifier = _proofVerifier;
		owner = msg.sender;
		EMPTY_NULLIFIER_ROOT = _readEmptyNullifierRoot(_proofVerifier);
	}

	function _readEmptyNullifierRoot(EscalationGameProofVerifier _proofVerifier) private view returns (bytes32) {
		require(address(_proofVerifier).code.length != 0, 'Proof verifier has no code');
		require(
			address(_proofVerifier).codehash == keccak256(type(EscalationGameProofVerifier).runtimeCode),
			'Proof verifier invalid'
		);
		return _proofVerifier.computeEmptyNullifierRoot();
	}

	modifier onlySecurityPoolOrForker() {
		require(
			msg.sender == address(securityPool) || msg.sender == address(securityPool.securityPoolForker()),
			'Only pool or forker'
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
		require(escrowedRep >= amount, 'Escrowed REP low');
		escrowedRepByVault[depositor] = escrowedRep - amount;
		totalEscrowedRep -= amount;
		emit VaultEscrowUpdated(depositor, escrowedRepByVault[depositor], totalEscrowedRep);
	}

	function _consumeUnresolvedRepForVault(address depositor, uint256 amount) internal {
		if (amount == 0) return;
		uint256 unresolvedRep = unresolvedRepByVault[depositor];
		require(unresolvedRep >= amount, 'Vault unresolved REP low');
		require(totalLocalUnresolvedRep >= amount, 'Local unresolved REP low');
		unresolvedRepByVault[depositor] = unresolvedRep - amount;
		totalLocalUnresolvedRep -= amount;
	}

	function _safeTransferRep(address receiver, uint256 amount) internal {
		if (amount == 0) return;
		IERC20(address(repToken)).safeTransfer(receiver, amount);
	}
}
