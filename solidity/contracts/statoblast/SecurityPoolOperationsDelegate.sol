// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { CoverageObligationMath } from './CoverageObligationMath.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { ISecurityPool, SystemState, LiquidationExecutionRequest } from './interfaces/ISecurityPool.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolLiquidationDelegate } from './SecurityPoolLiquidationDelegate.sol';
import { SecurityPoolSettlementDelegate } from './SecurityPoolSettlementDelegate.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { IERC20PermitAuthorization, IERC3009Authorization } from '../vendor/authorization/IERC20Authorization.sol';
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';
import { AccountingReason } from './interfaces/ISecurityPool.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { EscalationGame } from './EscalationGame.sol';
import { IShareToken } from './interfaces/IShareToken.sol';

interface ISecurityPoolRepDepositContext {
	function attoRepToBackingUnits(uint256 attoRepAmount) external view returns (uint256);
	function backingUnitsToAttoRep(uint256 backingUnits) external view returns (uint256);
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
	function isEscalationResolved() external view returns (bool);
	function questionId() external view returns (uint256);
	function questionData() external view returns (address);
	function escalationGame() external view returns (EscalationGame);
	function repToken() external view returns (address);
	function universeId() external view returns (uint248);
	function updateRetentionRate() external;
	function updateSettlementCollateral() external;

	function updateVaultFees(address vault) external;
	function zoltar() external view returns (address);
}

interface IZoltarForkState {
	function getForkTime(uint248 universeId) external view returns (uint256);
}

interface IQuestionEndTime {
	function getQuestionEndDate(uint256 questionId) external view returns (uint256);
}

contract SecurityPoolOperationsDelegate is SecurityPoolSettlementDelegate, SecurityPoolLiquidationDelegate {
	using SafeERC20Ops for IERC20;

	event RepDepositedToVault(address indexed vault, uint256 attoRepAmount, uint256 repBackingUnits, uint256 totalRepBackingUnits);
	event RepWithdrawnFromVault(address indexed vault, uint256 amountAttoRep, uint256 repBackingUnits, uint256 totalRepBackingUnits);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event VaultDepositTargetHealthFactorRecorded(address indexed vault, uint256 depositTargetHealthFactorBps, uint256 capacityOwnershipAttoRep, uint256 resultingTotalCapacityOwnershipAttoRep);

	event RepRedeemedFromVault(address indexed caller, address indexed vault, uint256 attoRepAmount, uint256 repBackingUnits, uint256 totalRepBackingUnits);

	function redeemRepFromVault(address vault) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == vault, 'Unauthorized');
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(ISecurityPoolForker(pool.securityPoolForker()).getQuestionOutcome(ISecurityPool(payable(address(this)))) != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		uint256 disputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		require(disputeStakedAttoRep == 0, 'Escrow locked');
		pool.updateVaultFees(vault);
		uint256 backingUnitsToRedeem = securityVaults[vault].repBackingUnits;
		uint256 attoRepAmount = pool.backingUnitsToAttoRep(backingUnitsToRedeem);
		require(attoRepAmount > 0, 'No redeemable REP');
		securityVaults[vault].repBackingUnits = 0;
		totalRepBackingUnits -= backingUnitsToRedeem;
		// A positive claim was registered when its backing units were created or transferred.
		IERC20(address(pool.repToken())).safeTransfer(vault, attoRepAmount);
		emit RepRedeemedFromVault(msg.sender, vault, attoRepAmount, 0, totalRepBackingUnits);
		_delegateEvent(address(ISecurityPoolRepDepositContext(address(this)).eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
	}

	function withdrawRepFromVault(address vault, uint256 attoRepAmount) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		if (pool.isEscalationResolved()) revert('Escalation resolved');
		pool.updateVaultFees(vault);
		if (address(escalationGame) != address(0x0)) {
			require(escalationGame.disputeStakedRepByVaultAttoRep(vault) == 0, 'Escrow');
		}
		uint256 backingUnitsToWithdraw = pool.attoRepToBackingUnits(attoRepAmount);
		uint256 withdrawBackingUnits =
			backingUnitsToWithdraw + pool.attoRepToBackingUnits(minimumVaultRepDepositAttoRep) >
				securityVaults[vault].repBackingUnits
				? securityVaults[vault].repBackingUnits
				: backingUnitsToWithdraw;
		uint256 withdrawRepAmountAttoRep = pool.backingUnitsToAttoRep(withdrawBackingUnits);

		uint256 previousVaultRepBackingAttoRep = pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits);
		require(previousVaultRepBackingAttoRep >= withdrawRepAmountAttoRep, 'Withdraw REP');
		uint256 repEthPrice = pool.priceOracleManagerAndOperatorQueuer().lastPrice();
		uint256 vaultDisputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		securityVaults[vault].repBackingUnits -= withdrawBackingUnits;
		totalRepBackingUnits -= withdrawBackingUnits;
		uint256 previousAssociatedRepAttoRep = previousVaultRepBackingAttoRep + vaultDisputeStakedAttoRep;
		uint256 nextCapacityOwnershipAttoRep = Math.mulDiv(securityVaults[vault].capacityOwnershipAttoRep, previousAssociatedRepAttoRep - withdrawRepAmountAttoRep, previousAssociatedRepAttoRep);
		_setVaultCapacity(vault, nextCapacityOwnershipAttoRep, 0);
		pool.updateRetentionRate();
		require(SecurityPoolUtils.isVaultHealthy(previousVaultRepBackingAttoRep - withdrawRepAmountAttoRep, vaultDisputeStakedAttoRep, pool.getVaultOpenInterestAttoEth(vault), repEthPrice, statoblastSecurityMultiplierBps), 'Vault backing insufficient');
		IERC20(address(pool.repToken())).safeTransfer(vault, withdrawRepAmountAttoRep);
		emit RepWithdrawnFromVault(vault, withdrawRepAmountAttoRep, securityVaults[vault].repBackingUnits, totalRepBackingUnits);
		_delegateEvent(address(ISecurityPoolRepDepositContext(address(this)).eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
	}

	function updateVaultFees(address vault) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		pool.updateSettlementCollateral();
		uint256 previousVaultFeeIndex = securityVaults[vault].feeIndex;
		uint256 previousVaultFeeRemainder = vaultFeeRemainders[coveragePositions[vault].epoch][vault];
		(uint256 fees, uint256 nextRemainder) = SecurityPoolUtils.calculateVaultFee(coveragePositions[vault].units, (coveragePositions[vault].epoch == badDebtGeneration ? feeIndex : finalFeeIndexByEpoch[coveragePositions[vault].epoch]) - securityVaults[vault].feeIndex, previousVaultFeeRemainder);
		bool vaultAccountingChanged =
			previousVaultFeeIndex != feeIndex || previousVaultFeeRemainder != nextRemainder || fees != 0;
		bool poolAccountingChanged = fees != 0;
		vaultFeeRemainders[coveragePositions[vault].epoch][vault] = nextRemainder;
		securityVaults[vault].feeIndex = feeIndex;
		if (previousVaultFeeIndex != feeIndex && coveragePositions[vault].epoch == badDebtGeneration) {
			uint256 capacityOwnershipAttoRep = getVaultObligationUnits(vault);
			uncheckpointedActiveObligationUnits -= capacityOwnershipAttoRep;
			if (capacityOwnershipAttoRep != 0) poolAccountingChanged = true;
		}
		if (coveragePositions[vault].epoch != badDebtGeneration)
			coveragePositions[vault] = CoveragePosition(0, badDebtGeneration);
		unallocatedAccruedFeesAttoEth -= fees;
		totalClaimableVaultFeesAttoEth += fees;
		securityVaults[vault].claimableFeesAttoEth += fees;
		if (vault != address(0) && !isKnownVault[vault]) {
			isKnownVault[vault] = true;
			vaultAddresses.push(vault);
		}
		if (vaultAccountingChanged)
			_delegateEvent(address(pool.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		if (poolAccountingChanged)
			_delegateEvent(address(pool.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.VaultCheckpoint, vault)));
		_synchronizeVaultTarget(pool, vault);
	}

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
		totalCapacityOwnershipAttoRep =
			totalCapacityOwnershipAttoRep -
			previousCapacityOwnershipAttoRep +
			nextCapacityOwnershipAttoRep;
		securityVaults[vault].capacityOwnershipAttoRep = nextCapacityOwnershipAttoRep;
		if (depositTargetHealthFactorBps != 0)
			emit VaultDepositTargetHealthFactorRecorded(vault, depositTargetHealthFactorBps, nextCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
		if (depositTargetHealthFactorBps != 0) {
			emit VaultDepositTargetHealthFactorRecorded(vault, depositTargetHealthFactorBps, nextCapacityOwnershipAttoRep, totalCapacityOwnershipAttoRep);
		}
	}

	event VaultBackingFactorAdjusted(address indexed vault, uint256 backingFactorBps, uint256 capacityOwnershipAttoRep);

	function adjustVaultBackingFactor(address vault, uint256 backingFactorBps) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		ISecurityPool securityPool = ISecurityPool(payable(address(this)));
		require(msg.sender == address(securityPool.priceOracleManagerAndOperatorQueuer()), 'Unauthorized');
		require(securityPool.priceOracleManagerAndOperatorQueuer().isPriceValid(), 'Stale price');
		_requireVaultAdmissionOpen(pool);
		require(backingFactorBps >= statoblastSecurityMultiplierBps, 'Backing factor below minimum');
		require(address(escalationGame) == address(0) || escalationGame.disputeStakedRepByVaultAttoRep(vault) == 0, 'Vault REP in dispute');
		pool.updateVaultFees(vault);
		uint256 backing = pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits);
		require(backing > 0, 'Vault has no REP backing');
		vaultTargetBackingFactorBps[vault] = backingFactorBps;
		_applyVaultTarget(pool, vault, backing, backingFactorBps);
		require(SecurityPoolUtils.isVaultHealthy(backing, 0, securityPool.getVaultOpenInterestAttoEth(vault), securityPool.priceOracleManagerAndOperatorQueuer().lastPrice(), statoblastSecurityMultiplierBps), 'Vault backing insufficient');
	}

	function _applyVaultTarget(ISecurityPoolRepDepositContext pool, address vault, uint256 backing, uint256 factor) private {
		uint256 capacity = Math.mulDiv(backing, statoblastSecurityMultiplierBps, factor);
		require(capacity > 0, 'Capacity must be positive');
		_setVaultCapacity(vault, capacity, 0);
		pool.updateRetentionRate();
		emit VaultBackingFactorAdjusted(vault, factor, capacity);
		SecurityPoolEventEmitter emitter = pool.eventEmitter();
		_delegateEvent(address(emitter), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		_delegateEvent(address(emitter), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.CapacityOwnershipChange, vault)));
	}

	function _synchronizeVaultTarget(ISecurityPoolRepDepositContext pool, address vault) private {
		uint256 factor = vaultTargetBackingFactorBps[vault];
		if (factor == 0 || settlementCollateralAttoEth != 0 || systemState != SystemState.Operational) return;
		if (IZoltarForkState(pool.zoltar()).getForkTime(pool.universeId()) != 0 || pool.isEscalationResolved()) return;
		if (
			block.timestamp >= IQuestionEndTime(pool.questionData()).getQuestionEndDate(pool.questionId()) &&
			!postEndVaultAdmissionAllowed
		) return;
		if (address(escalationGame) != address(0) && escalationGame.disputeStakedRepByVaultAttoRep(vault) != 0) return;
		uint256 backing = pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits);
		uint256 capacity = Math.mulDiv(backing, statoblastSecurityMultiplierBps, factor);
		if (capacity == 0 || capacity == securityVaults[vault].capacityOwnershipAttoRep) return;
		_applyVaultTarget(pool, vault, backing, factor);
	}

	function depositRepToVault(uint256 attoRepAmount, uint256 targetHealthFactorBps) external {
		_depositRepToVault(msg.sender, attoRepAmount, targetHealthFactorBps);
	}

	function depositRepToVaultWithPermit(uint256 attoRepAmount, uint256 targetHealthFactorBps, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		require(pool.universeId() != 0, 'Genesis REP does not support permit');
		address token = pool.repToken();
		try
			IERC20PermitAuthorization(token).permit(msg.sender, address(this), attoRepAmount, deadline, v, r, s)
		{} catch {
			require(IERC20(token).allowance(msg.sender, address(this)) >= attoRepAmount, 'Vault permit and allowance insufficient');
		}
		_depositRepToVault(msg.sender, attoRepAmount, targetHealthFactorBps);
	}

	function depositRepToVaultWithAuthorization(address owner, uint256 attoRepAmount, uint256 targetHealthFactorBps, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		require(pool.universeId() != 0, 'Genesis REP does not support authorization');
		bytes32 operationHash = keccak256(abi.encode(this.depositRepToVaultWithAuthorization.selector, owner, pool.universeId(), pool.questionId(), attoRepAmount, targetHealthFactorBps));
		uint256 repBackingUnits = _prepareRepDeposit(owner, attoRepAmount, targetHealthFactorBps);
		IERC3009Authorization(pool.repToken()).receiveWithAuthorization(owner, address(this), attoRepAmount, validAfter, validBefore, keccak256(abi.encode(nonce, operationHash, owner)), v, r, s);
		_creditRepDeposit(owner, attoRepAmount, targetHealthFactorBps, repBackingUnits);
	}

	function _depositRepToVault(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps) private {
		uint256 repBackingUnits = _prepareRepDeposit(vault, attoRepAmount, targetHealthFactorBps);
		IERC20(ISecurityPoolRepDepositContext(address(this)).repToken()).safeTransferFrom(vault, address(this), attoRepAmount);
		_creditRepDeposit(vault, attoRepAmount, targetHealthFactorBps, repBackingUnits);
	}

	function _prepareRepDeposit(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps) private returns (uint256) {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		_requireVaultAdmissionOpen(pool);
		require(attoRepAmount > 0, 'Zero REP');
		require(targetHealthFactorBps >= statoblastSecurityMultiplierBps, 'Target below pool minimum');
		uint256 savedTarget = vaultTargetBackingFactorBps[vault];
		require(savedTarget == 0 || savedTarget == targetHealthFactorBps, 'Use saved vault target');
		if (savedTarget == 0) vaultTargetBackingFactorBps[vault] = targetHealthFactorBps;
		pool.updateVaultFees(vault);
		return pool.attoRepToBackingUnits(attoRepAmount);
	}

	function _creditRepDeposit(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps, uint256 repBackingUnits) private {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		securityVaults[vault].repBackingUnits += repBackingUnits;
		totalRepBackingUnits += repBackingUnits;
		require(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Vault REP below minimum');
		uint256 capacityOwnershipAddedAttoRep = Math.mulDiv(attoRepAmount, statoblastSecurityMultiplierBps, targetHealthFactorBps);
		uint256 nextCapacity =
			settlementCollateralAttoEth == 0
				? Math.mulDiv(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits), statoblastSecurityMultiplierBps, targetHealthFactorBps)
				: securityVaults[vault].capacityOwnershipAttoRep + capacityOwnershipAddedAttoRep;
		require(nextCapacity > 0, 'Capacity must be positive');
		_setVaultCapacity(vault, nextCapacity, targetHealthFactorBps);
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

	function _requireVaultAdmissionOpen(ISecurityPoolRepDepositContext pool) private view {
		require(IZoltarForkState(pool.zoltar()).getForkTime(pool.universeId()) == 0, 'Forked');
		require(systemState == SystemState.Operational, 'Pool inactive');
		if (pool.isEscalationResolved()) revert('Escalation resolved');
		if (
			block.timestamp >= IQuestionEndTime(pool.questionData()).getQuestionEndDate(pool.questionId()) &&
			!postEndVaultAdmissionAllowed
		) revert('Vault admission closed');
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
		if (!awaitingForkContinuation || systemState != SystemState.Operational)
			revert('Fork continuation unavailable');
		escalationGame.resumeFromFork();
		if (escalationGame.forkResumedAt() == 0) return;
		awaitingForkContinuation = false;
		emit AwaitingForkContinuationSet(false);
	}

	function redeemShares(IShareToken shareToken, ISecurityPoolForker forker, uint248 universeId, address redeemer) external returns (uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth) {
		BinaryOutcomes.BinaryOutcome outcome = forker.getQuestionOutcome(ISecurityPool(payable(address(this))));
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		(winningSharesBurnedAttoShares, ) = shareToken.burnTokenIdAndGetRemainingSupply(tokenId, redeemer);
		settlementCollateralRedeemedAttoEth =
			shareTokenSupplyAttoShares == 0
				? 0
				: (winningSharesBurnedAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares;
		shareTokenSupplyAttoShares -= winningSharesBurnedAttoShares;
		settlementCollateralAttoEth -= settlementCollateralRedeemedAttoEth;
		if (shareTokenSupplyAttoShares == 0 && totalObligationUnits != 0) {
			_closeCoverageEpoch();
		}
	}

	function redeemCompleteSet(IShareToken shareToken, uint248 universeId, address redeemer, uint256 amountAttoShares) external returns (uint256 settlementCollateralRedeemedAttoEth) {
		settlementCollateralRedeemedAttoEth =
			amountAttoShares == 0 || shareTokenSupplyAttoShares == 0
				? 0
				: (amountAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares;
		shareToken.burnCompleteSets(universeId, redeemer, amountAttoShares);
		shareTokenSupplyAttoShares -= amountAttoShares;
		settlementCollateralAttoEth -= settlementCollateralRedeemedAttoEth;
		if (shareTokenSupplyAttoShares == 0 && totalObligationUnits != 0) {
			_closeCoverageEpoch();
		}
	}
}
