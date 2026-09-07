// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState, LiquidationExecutionRequest } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolSettlementDelegate } from './SecurityPoolSettlementDelegate.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IERC20PermitAuthorization, IERC3009Authorization } from '../vendor/authorization/IERC20Authorization.sol';
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';
import { AccountingReason } from './interfaces/ISecurityPool.sol';

interface ISecurityPoolRepDepositContext {
	function attoRepToBackingUnits(uint256 attoRepAmount) external view returns (uint256);
	function backingUnitsToAttoRep(uint256 backingUnits) external view returns (uint256);
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
	function isEscalationResolved() external view returns (bool);
	function questionId() external view returns (uint256);
	function questionData() external view returns (address);
	function repToken() external view returns (address);
	function universeId() external view returns (uint248);
	function updateRetentionRate() external;
	function updateVaultFees(address vault) external;
	function zoltar() external view returns (address);
}

interface IZoltarForkState {
	function getForkTime(uint248 universeId) external view returns (uint256);
}

interface IQuestionEndTime {
	function getQuestionEndDate(uint256 questionId) external view returns (uint256);
}

contract SecurityPoolOperationsDelegate is SecurityPoolSettlementDelegate {
	using SafeERC20Ops for IERC20;

	event RepDepositedToVault(address indexed vault, uint256 attoRepAmount, uint256 repBackingUnits, uint256 totalRepBackingUnits);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultBadDebtRecorded(address indexed targetVault, uint256 badDebtAttoEth, uint256 resultingVaultBadDebtAttoEth, uint256 resultingTotalBadDebtAttoEth);
	event VaultDepositTargetHealthFactorRecorded(address indexed vault, uint256 depositTargetHealthFactorBps, uint256 capacityOwnershipAttoRep, uint256 resultingTotalCapacityOwnershipAttoRep);

	function decodeError(bytes calldata result) external pure returns (string memory reason) {
		if (result.length < 68 || bytes4(result[:4]) != bytes4(keccak256('Error(string)')))
			return 'Delegate call failed';
		return abi.decode(result[4:], (string));
	}

	function setVaultCapacity(address vault, uint256 nextCapacityOwnershipAttoRep, uint256 depositTargetHealthFactorBps) external {
		_setVaultCapacity(vault, nextCapacityOwnershipAttoRep, depositTargetHealthFactorBps);
	}

	function _setVaultCapacity(address vault, uint256 nextCapacityOwnershipAttoRep, uint256 depositTargetHealthFactorBps) private {
		uint256 previousCapacityOwnershipAttoRep = securityVaults[vault].capacityOwnershipAttoRep;
		// Reducing the denominator would reallocate live settlement collateral to every remaining vault.
		if (nextCapacityOwnershipAttoRep < previousCapacityOwnershipAttoRep)
			require(settlementCollateralAttoEth == 0, 'Capacity committed');
		feeIndexRemainder = 0;
		totalCapacityOwnershipAttoRep =
			totalCapacityOwnershipAttoRep -
			previousCapacityOwnershipAttoRep +
			nextCapacityOwnershipAttoRep;
		feeEligibleCapacityOwnershipAttoRep =
			feeEligibleCapacityOwnershipAttoRep -
			previousCapacityOwnershipAttoRep +
			nextCapacityOwnershipAttoRep;
		securityVaults[vault].capacityOwnershipAttoRep = nextCapacityOwnershipAttoRep;
		if (depositTargetHealthFactorBps != 0) {
			lastDepositTargetHealthFactorBpsByVault[vault] = depositTargetHealthFactorBps;
			emit VaultDepositTargetHealthFactorRecorded(vault, depositTargetHealthFactorBps, nextCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
		}
	}

	function depositRepToVault(uint256 attoRepAmount, uint256 targetHealthFactorBps) external {
		_depositRepToVault(msg.sender, attoRepAmount, targetHealthFactorBps, true);
	}

	function depositRepToVaultWithPermit(uint256 attoRepAmount, uint256 targetHealthFactorBps, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
		address token = ISecurityPoolRepDepositContext(address(this)).repToken();
		try
			IERC20PermitAuthorization(token).permit(msg.sender, address(this), attoRepAmount, deadline, v, r, s)
		{} catch {
			require(IERC20(token).allowance(msg.sender, address(this)) >= attoRepAmount, 'Vault permit and allowance insufficient');
		}
		_depositRepToVault(msg.sender, attoRepAmount, targetHealthFactorBps, true);
	}

	function depositRepToVaultWithAuthorization(uint256 attoRepAmount, uint256 targetHealthFactorBps, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		bytes32 operationHash = keccak256(abi.encode(this.depositRepToVaultWithAuthorization.selector, pool.universeId(), pool.questionId(), attoRepAmount, targetHealthFactorBps));
		IERC3009Authorization(pool.repToken()).receiveWithAuthorization(msg.sender, address(this), attoRepAmount, validAfter, validBefore, keccak256(abi.encode(nonce, operationHash, msg.sender)), v, r, s);
		_depositRepToVault(msg.sender, attoRepAmount, targetHealthFactorBps, false);
	}

	function _depositRepToVault(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps, bool transferRep) private {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		if (
			systemState != SystemState.Operational ||
			IZoltarForkState(pool.zoltar()).getForkTime(pool.universeId()) != 0
		) revert();
		if (pool.isEscalationResolved()) revert();
		if (
			block.timestamp >= IQuestionEndTime(pool.questionData()).getQuestionEndDate(pool.questionId()) &&
			!postEndVaultAdmissionAllowed
		) revert();
		require(attoRepAmount > 0, 'Zero REP');
		require(targetHealthFactorBps >= SecurityPoolUtils.BPS_DENOMINATOR, 'HF low');
		pool.updateVaultFees(vault);
		uint256 repBackingUnits = pool.attoRepToBackingUnits(attoRepAmount);
		if (transferRep) IERC20(pool.repToken()).safeTransferFrom(vault, address(this), attoRepAmount);
		securityVaults[vault].repBackingUnits += repBackingUnits;
		totalRepBackingUnits += repBackingUnits;
		require(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Vault REP below minimum');
		uint256 capacityOwnershipAddedAttoRep = Math.mulDiv(attoRepAmount, SecurityPoolUtils.BPS_DENOMINATOR, targetHealthFactorBps);
		_setVaultCapacity(vault, securityVaults[vault].capacityOwnershipAttoRep + capacityOwnershipAddedAttoRep, targetHealthFactorBps);
		pool.updateRetentionRate();
		if (!isKnownVault[vault]) {
			isKnownVault[vault] = true;
			vaultAddresses.push(vault);
		}
		emit RepDepositedToVault(vault, attoRepAmount, securityVaults[vault].repBackingUnits, totalRepBackingUnits);
		SecurityPoolEventEmitter emitter = pool.eventEmitter();
		_delegateEvent(address(emitter), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		_delegateEvent(address(emitter), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.CapacityOwnershipChange, vault)));
	}

	function _delegateEvent(address emitter, bytes memory callData) private {
		(bool success, bytes memory result) = emitter.delegatecall(callData);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(result, 0x20), mload(result))
			}
		}
	}

	function resumeForkedEscalationGame() external {
		// This is permissionless for liveness. The immutable carry commitment was
		// installed during child initialization, so resumption does no unbounded work.
		if (!awaitingForkContinuation || systemState != SystemState.Operational) revert();
		escalationGame.resumeFromFork();
		if (escalationGame.forkResumedAt() == 0) return;
		awaitingForkContinuation = false;
		emit AwaitingForkContinuationSet(false);
	}

	function performBundledLiquidation(LiquidationExecutionRequest calldata request) external returns (uint256 debtToMoveAttoEth, uint256 capacityOwnershipToMoveAttoRep, uint256 badDebtAttoEth) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(request.receiverVault != request.targetVault, 'Receiver bad');
		require(securityVaults[request.targetVault].repBackingUnits == request.snapshotTargetBackingUnits, 'Target backingUnits changed');
		require(securityVaults[request.targetVault].capacityOwnershipAttoRep == request.snapshotTargetCapacityOwnershipAttoRep, 'Target commitment changed');
		uint256 targetVaultRepBackingAttoRep = pool.backingUnitsToAttoRep(request.snapshotTargetBackingUnits);
		uint256 targetDisputeStakedAttoRep =
			address(escalationGame) == address(0x0)
				? 0
				: escalationGame.disputeStakedRepByVaultAttoRep(request.targetVault);
		uint256 targetOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(request.targetVault);
		uint256 receiverOpenInterestBeforeAttoEth = pool.getVaultOpenInterestAttoEth(request.receiverVault);
		require(SecurityPoolUtils._isLiquidationBeyondMinPriceDistance(targetVaultRepBackingAttoRep, targetDisputeStakedAttoRep, targetOpenInterestAttoEth, statoblastSecurityMultiplierBps, request.repEthPrice, request.minLiquidationPriceDistanceBps), 'Liquidation distance too low');
		require(!SecurityPoolUtils.isVaultHealthy(targetVaultRepBackingAttoRep, targetDisputeStakedAttoRep, targetOpenInterestAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps), 'Target safe');
		uint256 nominalDebtToMoveAttoEth;
		uint256 maximumBackingUnitsToTransfer;
		uint256 minimumRemainingAttoRep =
			request.requestedDebtAttoEth >= targetOpenInterestAttoEth ? 0 : minimumVaultRepDepositAttoRep;
		(nominalDebtToMoveAttoEth, capacityOwnershipToMoveAttoRep, , maximumBackingUnitsToTransfer) = SecurityPoolUtils.calculateBundledLiquidationTransfer(securityVaults[request.targetVault].repBackingUnits, request.snapshotTargetCapacityOwnershipAttoRep, targetOpenInterestAttoEth, request.requestedDebtAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits, minimumRemainingAttoRep);
		uint256 receiverGrossOpenInterestAfterAttoEth = SecurityPoolUtils.calculateVaultOpenInterestAttoEth(settlementCollateralAttoEth, securityVaults[request.receiverVault].capacityOwnershipAttoRep + capacityOwnershipToMoveAttoRep, totalCapacityOwnershipAttoRep);
		uint256 receiverBadDebtAttoEth = _getVaultBadDebtAttoEth(request.receiverVault);
		uint256 receiverOpenInterestAfterAttoEth =
			receiverGrossOpenInterestAfterAttoEth > receiverBadDebtAttoEth
				? receiverGrossOpenInterestAfterAttoEth - receiverBadDebtAttoEth
				: 0;
		require(receiverOpenInterestAfterAttoEth >= receiverOpenInterestBeforeAttoEth, 'Receiver debt decreased');
		debtToMoveAttoEth = receiverOpenInterestAfterAttoEth - receiverOpenInterestBeforeAttoEth;
		require(debtToMoveAttoEth <= nominalDebtToMoveAttoEth && debtToMoveAttoEth <= request.requestedDebtAttoEth, 'Debt exceeds request');
		if (nominalDebtToMoveAttoEth != 0 && debtToMoveAttoEth == 0) revert('Receiver debt below minimum');
		uint256 backingUnitsToTransfer = SecurityPoolUtils.calculateLiquidationBackingUnitsAward(debtToMoveAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits);
		require(backingUnitsToTransfer <= maximumBackingUnitsToTransfer, 'Award exceeds funded quote');
		if (request.requestedDebtAttoEth >= targetOpenInterestAttoEth) {
			badDebtAttoEth = targetOpenInterestAttoEth - debtToMoveAttoEth;
			if (badDebtAttoEth != 0) {
				totalBadDebtAttoEth += badDebtAttoEth;
				uint256 resultingVaultBadDebtAttoEth = _getVaultBadDebtAttoEth(request.targetVault) + badDebtAttoEth;
				_setVaultBadDebtAttoEth(request.targetVault, resultingVaultBadDebtAttoEth);
				emit VaultBadDebtRecorded(request.targetVault, badDebtAttoEth, resultingVaultBadDebtAttoEth, totalBadDebtAttoEth);
			}
		}
		require(debtToMoveAttoEth > 0 || badDebtAttoEth > 0, 'No liq');

		feeIndexRemainder = 0;
		securityVaults[request.targetVault].capacityOwnershipAttoRep =
			request.snapshotTargetCapacityOwnershipAttoRep - capacityOwnershipToMoveAttoRep;
		securityVaults[request.targetVault].repBackingUnits -= backingUnitsToTransfer;
		if (debtToMoveAttoEth == 0) return (debtToMoveAttoEth, capacityOwnershipToMoveAttoRep, badDebtAttoEth);
		securityVaults[request.receiverVault].capacityOwnershipAttoRep += capacityOwnershipToMoveAttoRep;
		securityVaults[request.receiverVault].repBackingUnits += backingUnitsToTransfer;
		uint256 receiverOpenInterestAttoEth = pool.getVaultOpenInterestAttoEth(request.receiverVault);
		require(receiverOpenInterestAttoEth - receiverOpenInterestBeforeAttoEth == debtToMoveAttoEth, 'Debt settlement mismatch');
		if (receiverOpenInterestAttoEth < minimumSecurityBondDebtAttoEth) revert('Receiver debt below minimum');
		uint256 receiverDisputeStakedAttoRep;
		if (address(escalationGame) != address(0x0)) {
			try escalationGame.disputeStakedRepByVaultAttoRep(request.receiverVault) returns (uint256 claimRep) {
				receiverDisputeStakedAttoRep = claimRep;
			} catch {
				revert('Claim balance failed');
			}
		}
		require(SecurityPoolUtils.isVaultHealthyAtFactor(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits), receiverDisputeStakedAttoRep, receiverOpenInterestAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps, request.minimumReceiverHealthFactorBps), 'Receiver bad');
		uint256 targetOpenInterestAttoEthAfter = pool.getVaultOpenInterestAttoEth(request.targetVault);
		uint256 targetVaultRepBackingAfterAttoRep = pool.backingUnitsToAttoRep(securityVaults[request.targetVault].repBackingUnits);
		require(targetOpenInterestAttoEthAfter == 0 || targetOpenInterestAttoEthAfter >= minimumSecurityBondDebtAttoEth, 'Target debt');
		require(targetOpenInterestAttoEthAfter == 0 || targetVaultRepBackingAfterAttoRep >= minimumVaultRepDepositAttoRep, 'Target REP');
		require(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Receiver REP');
	}
}
