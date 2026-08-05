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
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
import { EscalationGameClaimDelegate } from './EscalationGameClaimDelegate.sol';
import { EscalationClaimBundle } from './EscalationGameTypes.sol';

abstract contract EscalationGameState is EscalationGameStorage, IEscalationGameEvents {
	using SafeERC20Ops for IERC20;

	uint256 internal constant activationDelay = 3 days;
	ISecurityPool public immutable securityPool;
	ReputationToken public immutable repToken;
	EscalationGameProofVerifier internal immutable proofVerifier;
	EscalationGameClaimDelegate internal immutable claimDelegate;
	address internal immutable owner;
	bytes32 internal immutable EMPTY_NULLIFIER_ROOT;

	event GameStarted(uint256 activationTime, uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep);
	event GameContinuedFromFork(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, uint256 elapsedAtFork);
	event ForkContinuationResumed(uint256 resumedAt);
	event ClaimDeposit(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 indexed parentDepositIndex,
		uint256 originalDepositAmountAttoRep,
		uint256 amountToWithdrawAttoRep,
		uint256 burnAmountAttoRep,
		bool transferredRep
	);
	event VaultUnresolvedTotalsExported(
		address indexed vault,
		address repReceiver,
		uint256[3] principalByOutcomeAttoRep,
		uint256 principalToTransferAttoRep,
		bool transferredRep
	);
	event ForkedEscrowRecorded(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipalTotalAttoRep,
		uint256 childRepTotalAttoRep,
		uint256 disputeStakedRepByVaultAttoRep,
		uint256 totalDisputeStakedAttoRep,
		uint256 outcomeBalanceAttoRep
	);
	event VaultEscrowUpdated(
		address indexed vault,
		uint256 disputeStakedRepByVaultAttoRep,
		uint256 totalDisputeStakedAttoRep
	);
	event ForkedEscrowClaimed(
		address indexed depositor,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 sourcePrincipalClaimedAttoRep,
		uint256 childRepClaimedAttoRep
	);
	event ForkedEscrowExported(
		address indexed vault,
		address repReceiver,
		uint256[3] sourcePrincipalByOutcomeAttoRep,
		uint256[3] childRepByOutcomeAttoRep,
		uint256 totalChildRepToTransferAttoRep,
		bool transferredRep
	);
	event ResidualRepSweptToSecurityPool(uint256 amountAttoRep);
	event TruthAuctionHaircutApplied(
		uint256 repBeforeAttoRep,
		uint256 repRemovedAttoRep,
		uint256 repRemainingAttoRep,
		uint256 rebasedElapsed
	);

	constructor(
		ISecurityPool _securityPool,
		ReputationToken _repToken,
		EscalationGameProofVerifier _proofVerifier,
		EscalationGameClaimDelegate _claimDelegate
	) {
		securityPool = _securityPool;
		repToken = _repToken;
		proofVerifier = _proofVerifier;
		claimDelegate = _claimDelegate;
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
		// This guard is repeated across the size-constrained escalation runtime. A
		// data-free revert keeps the deployed game below EIP-170's code-size limit.
		if (msg.sender != address(securityPool) && msg.sender != address(securityPool.securityPoolForker())) {
			revert();
		}
		_;
	}

	function _sliceEnd(uint256 startIndex, uint256 count, uint256 total) internal pure returns (uint256) {
		if (startIndex >= total || count == 0) return startIndex;
		uint256 availableCount = total - startIndex;
		if (count >= availableCount) return total;
		return startIndex + count;
	}

	function disputeStakedRepByVaultAttoRep(address vault) public view returns (uint256 amountAttoRep) {
		return _claimEscrowedRepByVault(vault);
	}

	function _consumeEscrowedRepForBundle(address depositor, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		EscalationClaimBundle storage bundle = escalationClaimBundles[depositor];
		uint256 claimUnits = _repToClaimUnits(amountAttoRep);
		require(bundle.disputeStakedRepClaimUnits >= claimUnits, 'Escrowed REP low');
		bundle.disputeStakedRepClaimUnits -= claimUnits;
		totalDisputeStakedAttoRep -= amountAttoRep;
		emit VaultEscrowUpdated(depositor, disputeStakedRepByVaultAttoRep(depositor), totalDisputeStakedAttoRep);
	}

	function _consumeEscrowedRepForOwner(address ownerAddress, uint256 amountAttoRep) internal {
		_delegateDepositCall(
			abi.encodeCall(EscalationGameDepositDelegate.consumeEscrowedRepForOwner, (ownerAddress, amountAttoRep))
		);
	}

	function _creditClaimOwners(address bundleId, uint256 amountAttoRep) internal {
		_delegateDepositCall(
			abi.encodeCall(EscalationGameDepositDelegate.creditClaimOwners, (bundleId, amountAttoRep))
		);
	}

	function _delegateDepositCall(bytes memory callData) internal returns (bytes memory returnData) {
		address delegate = _getDepositDelegate();
		(bool success, bytes memory result) = delegate.delegatecall(callData);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 0x20), mload(result))
			}
		}
		return result;
	}

	function _delegateClaimCall(bytes memory callData) internal returns (bytes memory returnData) {
		(bool success, bytes memory result) = address(claimDelegate).delegatecall(callData);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 0x20), mload(result))
			}
		}
		return result;
	}

	function _getDepositDelegate() internal view virtual returns (address);

	function _consumeUnresolvedRepForVault(address depositor, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		uint256 unresolvedAttoRep = unresolvedRepByVaultAttoRep[depositor];
		require(unresolvedAttoRep >= amountAttoRep, 'Vault unresolved REP low');
		require(totalLocalUnresolvedAttoRep >= amountAttoRep, 'Local unresolved REP low');
		unresolvedRepByVaultAttoRep[depositor] = unresolvedAttoRep - amountAttoRep;
		totalLocalUnresolvedAttoRep -= amountAttoRep;
	}

	function _consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amountAttoRep) internal {
		_delegateDepositCall(
			abi.encodeCall(
				EscalationGameDepositDelegate.consumeUnresolvedRepForClaimOwners,
				(bundleId, outcomeIndex, amountAttoRep)
			)
		);
	}

	function _safeTransferRep(address receiver, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		IERC20(address(repToken)).safeTransfer(receiver, amountAttoRep);
	}
}
