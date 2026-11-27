// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ReputationToken } from '../ReputationToken.sol';
import { IQuestionLedger } from './interfaces/IQuestionLedger.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { EscalationGameProofVerifier } from './EscalationGameProofVerifier.sol';
import { IEscalationGameEvents } from './interfaces/IEscalationGame.sol';
import { EscalationGameStorage } from './EscalationGameStorage.sol';
import { EscalationGameDepositDelegate } from './EscalationGameDepositDelegate.sol';
import { DelegateCall } from './DelegateCall.sol';
import { EscalationGameRepCustody } from './EscalationGameRepCustody.sol';

abstract contract EscalationGameState is EscalationGameStorage, IEscalationGameEvents {
	IQuestionLedger public immutable questionLedger;
	ReputationToken public immutable repToken;
	EscalationGameProofVerifier internal immutable proofVerifier;
	address internal immutable owner;

	event GameStarted(uint256 activationTime, uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep);
	event GameContinuedFromFork(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork);
	/// @notice An assessed carried haircut already funded by the native fork; no burn occurs on this claim.
	event WinningHaircutPrepaid(BinaryOutcomes.BinaryOutcome indexed outcome, uint256 indexed parentDepositIndex, uint256 assessedHaircutAttoRep);
	/// @notice burnAmountAttoRep is the REP actually burned by this claim, excluding prepaid haircuts.
	event ClaimDeposit(address indexed depositor, BinaryOutcomes.BinaryOutcome indexed outcome, uint256 indexed parentDepositIndex, uint256 originalDepositAmountAttoRep, uint256 amountToWithdrawAttoRep, uint256 burnAmountAttoRep, bool transferredRep);
	event VaultEscrowUpdated(address indexed vault, uint256 disputeStakedRepByVaultAttoRep, uint256 totalDisputeStakedAttoRep);
	event ForkContinuationResidualRepBurned(uint256 amountAttoRep);

	constructor(IQuestionLedger _questionLedger, ReputationToken _repToken, EscalationGameProofVerifier _proofVerifier) {
		questionLedger = _questionLedger;
		repToken = _repToken;
		proofVerifier = _proofVerifier;
		owner = msg.sender;
		require(address(_proofVerifier).code.length != 0, 'Proof verifier has no code');
		require(address(_proofVerifier).codehash == keccak256(type(EscalationGameProofVerifier).runtimeCode), 'Proof verifier invalid');
	}

	function disputeStakedRepByVaultAttoRep(address vault) public view returns (uint256 amountAttoRep) {
		return _claimEscrowedRepByVault(vault);
	}

	function _consumeEscrowedRepForBundle(address depositor, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		// Local principal was consumed once by consumeUnresolvedRepForClaimOwners.
		// This separate step accounts for global logical escrow and its event.
		totalDisputeStakedAttoRep -= amountAttoRep;
		emit VaultEscrowUpdated(depositor, disputeStakedRepByVaultAttoRep(depositor), totalDisputeStakedAttoRep);
	}

	function _creditClaimOwners(address bundleId, uint256 amountAttoRep) internal {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.creditClaimOwners, (bundleId, amountAttoRep)));
	}

	// This call site keeps its own delegatecall instead of `DelegateCall.invoke`:
	// routing through the library adds 42 bytes to the size-constrained game runtime.
	function _delegateDepositCall(bytes memory callData) internal returns (bytes memory returnData) {
		address delegate = _getDepositDelegate();
		(bool success, bytes memory result) = delegate.delegatecall(callData);
		if (!success) DelegateCall.bubbleRevert(result);
		return result;
	}

	function _getDepositDelegate() internal view virtual returns (address);

	function _consumeUnresolvedRepForClaimOwners(address bundleId, uint8 outcomeIndex, uint256 amountAttoRep) internal {
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.consumeUnresolvedRepForClaimOwners, (bundleId, outcomeIndex, amountAttoRep)));
	}

	function _safeTransferRep(address receiver, uint256 amountAttoRep) internal {
		if (amountAttoRep == 0) return;
		_delegateDepositCall(abi.encodeCall(EscalationGameDepositDelegate.transferReporterRep, (receiver, amountAttoRep)));
	}

	function _reporterRepBalance() internal view returns (uint256) {
		return EscalationGameRepCustody.balance(address(questionLedger));
	}
}
