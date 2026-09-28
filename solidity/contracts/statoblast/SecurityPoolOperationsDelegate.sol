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
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { EscalationGame } from './EscalationGame.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { IShareToken } from './interfaces/IShareToken.sol';

interface ISecurityPoolRepDepositContext {
	function escalationGameFactory() external view returns (EscalationGameFactory);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
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
	function getNonDecisionThresholdAttoRep(uint248 universeId) external view returns (uint256);
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
	event VaultDepositTargetHealthFactorRecorded(address indexed vault, uint256 depositTargetHealthFactorBps, uint256 underwritingLimitAttoEth, uint256 resultingTotalUnderwritingLimitAttoEth);

	function updateVaultFees(address vault) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		pool.updateSettlementCollateral();
		bool hadUncheckpointedFeeEligibleCapacity = uncheckpointedFeeEligibleUnderwritingLimitAttoEth != 0;
		uint256 previousVaultFeeIndex = securityVaults[vault].feeIndex;
		uint256 previousVaultFeeRemainder = vaultFeeRemainders[vault];
		(uint256 fees, uint256 nextRemainder) = SecurityPoolUtils.calculateVaultFee(securityVaults[vault].underwritingLimitAttoEth, feeIndex - securityVaults[vault].feeIndex, previousVaultFeeRemainder);
		bool vaultAccountingChanged =
			previousVaultFeeIndex != feeIndex || previousVaultFeeRemainder != nextRemainder || fees != 0;
		bool poolAccountingChanged = fees != 0;
		vaultFeeRemainders[vault] = nextRemainder;
		securityVaults[vault].feeIndex = feeIndex;
		if (previousVaultFeeIndex != feeIndex) {
			uint256 underwritingLimitAttoEth = securityVaults[vault].underwritingLimitAttoEth;
			uncheckpointedFeeEligibleUnderwritingLimitAttoEth -= underwritingLimitAttoEth;
			if (underwritingLimitAttoEth != 0) poolAccountingChanged = true;
		}
		unallocatedAccruedFeesAttoEth -= fees;
		totalClaimableVaultFeesAttoEth += fees;
		securityVaults[vault].claimableFeesAttoEth += fees;
		if (!hadUncheckpointedFeeEligibleCapacity && _releaseUnassignableFeeReserveIfComplete())
			poolAccountingChanged = true;
		if (vault != address(0) && !isKnownVault[vault]) {
			isKnownVault[vault] = true;
			vaultAddresses.push(vault);
		}
		if (vaultAccountingChanged)
			_delegateEvent(address(pool.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		if (poolAccountingChanged)
			_delegateEvent(address(pool.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.VaultCheckpoint, vault)));
	}

	function _releaseUnassignableFeeReserveIfComplete() private returns (bool released) {
		// Each independently rounded vault or unassigned-auction entitlement ledger, and each global
		// fee-index denominator epoch whose remainder is cleared, can leave less than one attoETH of
		// aggregate division residue. Their count has no safe protocol-wide bound, so release the
		// terminal reserve only after every capacity unit behind the final fee index is reconciled.
		if (
			uncheckpointedFeeEligibleUnderwritingLimitAttoEth != 0 ||
			systemState != SystemState.PoolForked ||
			unallocatedAccruedFeesAttoEth == 0
		) return false;
		settlementCollateralAttoEth += unallocatedAccruedFeesAttoEth;
		unallocatedAccruedFeesAttoEth = 0;
		return true;
	}

	function decodeError(bytes calldata result) external pure returns (string memory reason) {
		if (result.length < 68 || bytes4(result[:4]) != bytes4(keccak256('Error(string)')))
			return 'Delegate call failed';
		return abi.decode(result[4:], (string));
	}

	function setUnderwritingLimit(uint256 limitAttoEth) external {
		_setUnderwritingLimit(msg.sender, limitAttoEth);
	}

	function setVaultUnderwritingLimit(address vault, uint256 limitAttoEth) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == address(pool.priceOracleManagerAndOperatorQueuer()), 'Unauthorized');
		_setUnderwritingLimit(vault, limitAttoEth);
	}

	function _setUnderwritingLimit(address vault, uint256 limitAttoEth) private {
		ISecurityPoolRepDepositContext context = ISecurityPoolRepDepositContext(address(this));
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(IZoltarForkState(context.zoltar()).getForkTime(context.universeId()) == 0 || (ISecurityPool(payable(address(this))).isEscalationResolved() && limitAttoEth <= securityVaults[vault].underwritingLimitAttoEth), 'Forked');
		uint256 oldLimitAttoEth = securityVaults[vault].underwritingLimitAttoEth;
		if (limitAttoEth == oldLimitAttoEth) return;
		if (limitAttoEth > oldLimitAttoEth) _requireVaultAdmissionOpen(context);
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		context.updateVaultFees(vault);
		uint256 nextTotalAttoEth = totalUnderwritingLimitAttoEth - oldLimitAttoEth + limitAttoEth;
		if (limitAttoEth < oldLimitAttoEth)
			require(nextTotalAttoEth >= settlementCollateralAttoEth, 'Commitments below collateral');
		if (limitAttoEth > oldLimitAttoEth) {
			require(pool.priceOracleManagerAndOperatorQueuer().isPriceValid(), 'Stale price');
			_requireLimitBacked(pool, vault, limitAttoEth);
		}
		feeIndexRemainder = 0;
		feeEligibleUnderwritingLimitAttoEth = feeEligibleUnderwritingLimitAttoEth - oldLimitAttoEth + limitAttoEth;
		totalUnderwritingLimitAttoEth = nextTotalAttoEth;
		securityVaults[vault].underwritingLimitAttoEth = limitAttoEth;
		context.updateRetentionRate();
		emit UnderwritingLimitSet(vault, limitAttoEth, nextTotalAttoEth);
		_delegateEvent(address(context.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
		_delegateEvent(address(context.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.CapacityOwnershipChange, vault)));
	}

	function _requireLimitBacked(ISecurityPool pool, address vault, uint256 limitAttoEth) private view {
		uint256 disputeStakedAttoRep =
			address(escalationGame) == address(0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		require(SecurityPoolUtils.isVaultHealthy(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits), disputeStakedAttoRep, limitAttoEth, pool.priceOracleManagerAndOperatorQueuer().lastPrice(), statoblastSecurityMultiplierBps), 'Vault backing insufficient');
	}

	function activateRecoveredCommitment(address vault, uint256 commitmentAttoEth) external {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(msg.sender == pool.securityPoolForker(), 'Only forker');
		require(systemState == SystemState.Operational, 'Pool inactive');
		ISecurityPoolRepDepositContext context = ISecurityPoolRepDepositContext(address(this));
		require(IZoltarForkState(context.zoltar()).getForkTime(context.universeId()) == 0, 'Forked');
		require(pool.priceOracleManagerAndOperatorQueuer().isPriceValid(), 'Stale price');
		_requireLimitBacked(pool, vault, securityVaults[vault].underwritingLimitAttoEth);
		// The forker checkpointed the recipient before assigning the previously ineligible weight.
		feeIndexRemainder = 0;
		feeEligibleUnderwritingLimitAttoEth += commitmentAttoEth;
		require(feeEligibleUnderwritingLimitAttoEth <= totalUnderwritingLimitAttoEth, 'Fee ownership exceeds capacity');
		context.updateRetentionRate();
		_delegateEvent(address(context.eventEmitter()), abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (AccountingReason.CapacityOwnershipChange, vault)));
	}

	event EscalationGameSet(EscalationGame escalationGame);

	function depositWalletRepToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		IZoltarForkState zoltar = IZoltarForkState(pool.zoltar());
		uint248 universeId = pool.universeId();
		require(zoltar.getForkTime(universeId) == 0, 'Forked');
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(!awaitingForkContinuation, 'Fork await');
		if (address(escalationGame) == address(0)) {
			require(block.timestamp > IQuestionEndTime(pool.questionData()).getQuestionEndDate(pool.questionId()), 'Question active');
			escalationGame = pool.escalationGameFactory().deployEscalationGame(pool.initialEscalationGameDepositAttoRep(), zoltar.getNonDecisionThresholdAttoRep(universeId));
			emit EscalationGameSet(escalationGame);
		}
		require(!escalationGame.forkContinuation(), 'Fork game');
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = escalationGame.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
		// Wallet funding enters dispute escrow directly and never acquires pool backing or capacity.
		IERC20(pool.repToken()).safeTransferFrom(msg.sender, address(escalationGame), depositedAttoRep);
		escalationGame.recordDepositFromSecurityPool(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
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
		_creditRepDeposit(owner, attoRepAmount, repBackingUnits);
	}

	function _depositRepToVault(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps) private {
		uint256 repBackingUnits = _prepareRepDeposit(vault, attoRepAmount, targetHealthFactorBps);
		IERC20(ISecurityPoolRepDepositContext(address(this)).repToken()).safeTransferFrom(vault, address(this), attoRepAmount);
		_creditRepDeposit(vault, attoRepAmount, repBackingUnits);
	}

	function _prepareRepDeposit(address vault, uint256 attoRepAmount, uint256 targetHealthFactorBps) private returns (uint256) {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		_requireVaultAdmissionOpen(pool);
		require(attoRepAmount > 0, 'Zero REP');
		require(targetHealthFactorBps >= statoblastSecurityMultiplierBps, 'Target below pool minimum');
		pool.updateVaultFees(vault);
		return pool.attoRepToBackingUnits(attoRepAmount);
	}

	function _creditRepDeposit(address vault, uint256 attoRepAmount, uint256 repBackingUnits) private {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		securityVaults[vault].repBackingUnits += repBackingUnits;
		totalRepBackingUnits += repBackingUnits;
		require(pool.backingUnitsToAttoRep(securityVaults[vault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Vault REP below minimum');
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
		if (shareTokenSupplyAttoShares == 0) {
			totalBadDebtAttoEth = 0;
			unchecked {
				badDebtGeneration++;
			}
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
		if (shareTokenSupplyAttoShares == 0) {
			totalBadDebtAttoEth = 0;
			unchecked {
				badDebtGeneration++;
			}
		}
	}

	function performBundledLiquidation(LiquidationExecutionRequest calldata request) external returns (uint256 debtToMoveAttoEth, uint256 underwritingLimitToMoveAttoEth, uint256 badDebtAttoEth) {
		ISecurityPool pool = ISecurityPool(payable(address(this)));
		require(request.receiverVault != request.targetVault && request.receiverVault != address(0), 'Receiver bad');
		require(_getVaultBadDebtAttoEth(request.targetVault) == 0, 'Target bad debt');
		require(_getVaultBadDebtAttoEth(request.receiverVault) == 0, 'Receiver bad debt');
		require(securityVaults[request.targetVault].repBackingUnits == request.snapshotTargetBackingUnits, 'Target backingUnits changed');
		require(securityVaults[request.targetVault].underwritingLimitAttoEth == request.snapshotTargetUnderwritingLimitAttoEth, 'Target commitment changed');
		uint256 targetLimitAttoEth = request.snapshotTargetUnderwritingLimitAttoEth;
		uint256 targetBackingAttoRep = pool.backingUnitsToAttoRep(request.snapshotTargetBackingUnits);
		uint256 targetDisputeAttoRep =
			address(escalationGame) == address(0)
				? 0
				: escalationGame.disputeStakedRepByVaultAttoRep(request.targetVault);
		require(SecurityPoolUtils._isLiquidationBeyondMinPriceDistance(targetBackingAttoRep, targetDisputeAttoRep, targetLimitAttoEth, statoblastSecurityMultiplierBps, request.repEthPrice, request.minLiquidationPriceDistanceBps), 'Liquidation distance too low');
		require(!SecurityPoolUtils.isVaultHealthy(targetBackingAttoRep, targetDisputeAttoRep, targetLimitAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps), 'Target safe');
		uint256 backingUnitsToTransfer;
		(debtToMoveAttoEth, underwritingLimitToMoveAttoEth, , backingUnitsToTransfer) = SecurityPoolUtils.calculateBundledLiquidationTransfer(request.snapshotTargetBackingUnits, targetLimitAttoEth, targetLimitAttoEth, request.requestedDebtAttoEth, request.repEthPrice, pool.getTotalPoolHeldAttoRep(), totalRepBackingUnits, request.requestedDebtAttoEth >= targetLimitAttoEth ? 0 : minimumVaultRepDepositAttoRep);
		require(debtToMoveAttoEth != 0, 'No liq');
		feeIndexRemainder = 0;
		securityVaults[request.targetVault].underwritingLimitAttoEth -= debtToMoveAttoEth;
		securityVaults[request.receiverVault].underwritingLimitAttoEth += debtToMoveAttoEth;
		securityVaults[request.targetVault].repBackingUnits -= backingUnitsToTransfer;
		securityVaults[request.receiverVault].repBackingUnits += backingUnitsToTransfer;
		uint256 receiverLimitAttoEth = securityVaults[request.receiverVault].underwritingLimitAttoEth;
		uint256 receiverDisputeAttoRep =
			address(escalationGame) == address(0)
				? 0
				: escalationGame.disputeStakedRepByVaultAttoRep(request.receiverVault);
		require(SecurityPoolUtils.isVaultHealthyAtFactor(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits), receiverDisputeAttoRep, receiverLimitAttoEth, request.repEthPrice, statoblastSecurityMultiplierBps, request.minimumReceiverHealthFactorBps), 'Receiver bad');
		require(receiverLimitAttoEth >= minimumSecurityBondDebtAttoEth, 'Receiver commitment below minimum');
		require(pool.backingUnitsToAttoRep(securityVaults[request.receiverVault].repBackingUnits) >= minimumVaultRepDepositAttoRep, 'Receiver REP');
		uint256 remainingLimitAttoEth = securityVaults[request.targetVault].underwritingLimitAttoEth;
		require(remainingLimitAttoEth == 0 || remainingLimitAttoEth >= minimumSecurityBondDebtAttoEth, 'Target commitment');
		// A partially transferred commitment remains authorized, visible, and eligible for takeover.
		// No commitment or settlement collateral is written off by liquidation.
		badDebtAttoEth = 0;
	}
}
