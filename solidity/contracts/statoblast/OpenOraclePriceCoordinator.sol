// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { LiquidationApprovalRegistry } from './LiquidationApprovalRegistry.sol';
import './OpenOraclePriceCoordinatorTypes.sol';
import { VaultOperations } from './VaultOperations.sol';
import { OpenOraclePriceSource } from './OpenOraclePriceSource.sol';
import { OpenOracleReportDelegate } from './OpenOracleReportDelegate.sol';

contract OpenOraclePriceCoordinator is OpenOraclePriceSource {
	string private constant STAGED_OPERATION_EXECUTION_OK = '';
	string private constant STAGED_OPERATION_ERROR_EXPIRED = 'Staged operation expired';
	string private constant STAGED_OPERATION_ERROR_STALE_LIQUIDATION = 'Stale liquidation';
	string private constant STAGED_OPERATION_ERROR_ZERO_WITHDRAW = 'Withdraw amount has no effect';
	string private constant STAGED_OPERATION_ERROR_PANIC = 'Panic';
	string private constant STAGED_OPERATION_ERROR_UNKNOWN = 'Unknown error';
	VaultOperations public immutable vaultOperations;
	uint256 public pendingOperationSlotId;
	LiquidationApprovalRegistry public liquidationApprovalRegistry;

	event LiquidationApprovalRegistrySet(LiquidationApprovalRegistry indexed registry);
	event LiquidationRouteStaged(uint256 indexed operationId, address indexed operator, address indexed receiverVault, address targetVault, bytes32 approvalId, uint256 requestedDebtAttoEth, uint256 reservedDebtAttoEth);
	event StagedOperationQueued(uint256 indexed operationId, OperationType operation, address indexed operator, address indexed targetVault, uint256 operationValue, uint256 queuedAt, uint256 validForSeconds, uint256 snapshotTargetBackingUnits, uint256 snapshotTargetUnderwritingLimitAttoEth, uint256 snapshotTargetOpenInterestAttoEth, uint256 snapshotTargetDisputeStakedAttoRep, uint256 snapshotTotalPoolHeldAttoRep, uint256 snapshotTotalRepBackingUnits, bool isPendingSlot);
	event ExecutedStagedOperation(uint256 indexed operationId, OperationType operation, bool success, string errorMessage);
	/// @notice Authoritative operation-governing and report state after a coordinator mutation.
	/// REP/ETH prices use 1e18 precision. The base-fee field uses attoETH.
	event CoordinatorStateCheckpoint(CoordinatorCheckpointReason reason, uint256 indexed reportId, uint256 indexed operationId, uint256 pendingReportId, address pendingReportSponsor, uint256 pendingOperationSlotId, uint256 pendingReportMaxSettlementBaseFeeAttoEthPerGas, uint256 lastPrice, uint256 lastSettlementTimestamp, uint256 stagedOperationCounter, uint256 activeStagedOperationCount, uint256 pendingSettlementOperationCount);

	// This is not a FIFO queue. We keep append-only operation records plus a bounded
	// pending settlement list that auto-executes once a fresh oracle price arrives.
	// Active-operation paging is newest-first so UI previews remain stable after
	// execution removes older entries from the set.
	uint256 public stagedOperationCounter;
	// Coordinator operation ID -> operation record; operator is cleared when consumed.
	mapping(uint256 => StagedOperation) public stagedOperations;
	mapping(address => uint256) private latestBackingTargetOperationIds;
	uint256 private activeStagedOperationCount;
	uint256 private latestActiveStagedOperationId;
	// Active operation ID -> neighboring operation IDs in the paging list; zero marks either end.
	mapping(uint256 => uint256) private olderActiveStagedOperationIds;
	mapping(uint256 => uint256) private newerActiveStagedOperationIds;
	mapping(uint256 => bool) private isActiveStagedOperation;
	uint256[] private pendingSettlementOperationIds;

	constructor(OpenOracle _openOracle, ReputationToken _reputationToken, IWeth9 _weth, uint256 _gasConsumedOpenOracleReportPrice, uint32 _gasConsumedSettlement, uint256 _gasUnitsForOneDispute, uint256 _initialReportPriorityFeeAttoEthPerGas, uint256 _targetPriceErrorForDispute, uint256 _openOracleSecurityMultiplierBps, uint48 _settlementTime, uint24 _disputeDelay, uint24 _protocolFee, uint24 _feePercentage, uint16 _multiplier, bool _timeType, bool _trackDisputes, address _protocolFeeRecipient, uint256 _escalationHaltMultiplierBps, uint256 _maxSettlementBaseFeeMultiplierBps, uint256 _minLiquidationPriceDistanceBps, OpenOracleReportDelegate _reportDelegate)
		OpenOraclePriceSource(
			_openOracle,
			_reputationToken,
			_weth,
			_gasConsumedOpenOracleReportPrice,
			_gasConsumedSettlement,
			_gasUnitsForOneDispute,
			_initialReportPriorityFeeAttoEthPerGas,
			_targetPriceErrorForDispute,
			_openOracleSecurityMultiplierBps,
			_settlementTime,
			_disputeDelay,
			_protocolFee,
			_feePercentage,
			_multiplier,
			_timeType,
			_trackDisputes,
			_protocolFeeRecipient,
			_escalationHaltMultiplierBps,
			_maxSettlementBaseFeeMultiplierBps,
			_minLiquidationPriceDistanceBps,
			_reportDelegate
		)
	{
		vaultOperations = new VaultOperations();
	}

	/// @notice Deployment-worker-only registry binding.
	function setLiquidationApprovalRegistry(LiquidationApprovalRegistry registry) external {
		require(msg.sender == coordinatorFactory && address(liquidationApprovalRegistry) == address(0) && address(registry) != address(0), 'Registry setup invalid');
		liquidationApprovalRegistry = registry;
		emit LiquidationApprovalRegistrySet(registry);
	}

	function _acceptPendingSettlementOperations() internal override {
		uint256[] memory operationIds = pendingSettlementOperationIds;
		delete pendingSettlementOperationIds;
		pendingOperationSlotId = 0;
		for (uint256 index = 0; index < operationIds.length; index++) {
			if (stagedOperations[operationIds[index]].operator != address(0))
				executeStagedOperation(operationIds[index]);
		}
	}

	function _failPendingSettlementOperations(string memory reason) internal override {
		uint256[] memory operationIds = pendingSettlementOperationIds;
		delete pendingSettlementOperationIds;
		pendingOperationSlotId = 0;
		for (uint256 index = 0; index < operationIds.length; index++) {
			uint256 operationId = operationIds[index];
			StagedOperation memory stagedOperation = stagedOperations[operationId];
			if (stagedOperation.operator == address(0)) continue;
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
		}
	}

	/// @notice Executor-only registration preserves the wallet as owner and oracle sponsor.
	function stageVaultOperations(address owner, bool changeCommitment, uint256 actionCount, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 operationId) {
		require(msg.sender == address(vaultOperations), 'Only vault operations executor');
		require(validForSeconds > 0 && validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'Invalid execution window');
		require(!securityPool.isEscalationResolved(), 'Escalation resolved');
		if (address(sharedPriceFeed) == address(0) && pendingReportId() != 0 && !isPriceValid())
			require(owner == pendingReportSponsor(), 'Only pending report sponsor can submit');
		if (changeCommitment)
			require(stagedOperations[latestBackingTargetOperationIds[owner]].operator == address(0), 'Commitment operation already pending');
		HistoricalQueueSnapshot memory snapshot;
		(operationId, snapshot) = _recordStagedOperation(OperationType.VaultOperations, owner, owner, owner, bytes32(0), actionCount, validForSeconds);
		if (changeCommitment) latestBackingTargetOperationIds[owner] = operationId;
		uint256 retained;
		if (isPriceValid()) {
			_emitStagedOperationQueued(operationId, snapshot, false);
			vaultOperations.execute(operationId);
			_consumeAndEmitExecutedStagedOperation(operationId, OperationType.VaultOperations, true, STAGED_OPERATION_EXECUTION_OK);
		} else {
			require(getPendingSettlementWork() + actionCount <= MAX_PENDING_SETTLEMENT_OPERATIONS, 'Oracle settlement capacity exceeded');
			retained = _executeOrQueueStagedOperation(operationId, snapshot, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		}
		if (msg.value > retained) {
			(bool sent, ) = payable(owner).call{value: msg.value - retained}('');
			require(sent, 'Vault operation refund failed');
		}
	}

	/// @notice Remaining callbacks are bounded by action count, including actions inside bundles.
	function getPendingSettlementWork() public view returns (uint256 work) {
		for (uint256 index = 0; index < pendingSettlementOperationIds.length; index++) {
			StagedOperation storage operation = stagedOperations[pendingSettlementOperationIds[index]];
			work += operation.operation == OperationType.VaultOperations ? operation.operationValue : 1;
		}
	}

	/// @notice Stages an operation with the caller as operator and receiver, executing it under a valid price or queuing it for the next price.
	function requestPriceIfNeededAndStageOperation(OperationType operation, address targetVault, uint256 operationValue, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) public payable {
		_requestPriceIfNeededAndStageOperation(operation, targetVault, msg.sender, bytes32(0), operationValue, validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
	}

	/// @notice Stages a liquidation of `targetVault` into `receiverVault`, executing it under a valid price or queuing it for the next price.
	/// @dev A receiver other than the caller must have approved the caller through `approvalId` in the liquidation approval registry.
	function requestPriceIfNeededAndStageLiquidation(address targetVault, address receiverVault, uint256 requestedDebtAttoEth, bytes32 approvalId, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable {
		_requestPriceIfNeededAndStageOperation(OperationType.Liquidation, targetVault, receiverVault, approvalId, requestedDebtAttoEth, validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
	}

	function _requestPriceIfNeededAndStageOperation(OperationType operation, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) private {
		require(operation != OperationType.VaultOperations, 'Use vault operations submission');
		_validateStageRequest(operation, targetVault, receiverVault, approvalId, operationValue, validForSeconds);
		(uint256 operationId, HistoricalQueueSnapshot memory snapshot) = _recordStagedOperation(operation, msg.sender, targetVault, receiverVault, approvalId, operationValue, validForSeconds);
		uint256 retained = _executeOrQueueStagedOperation(operationId, snapshot, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth);
		uint256 refund = msg.value - retained;
		if (refund > 0) {
			(bool sent, ) = payable(msg.sender).call{value: refund}('');
			require(sent, 'Oracle coordinator failed to return unused ETH');
		}
	}

	function _validateStageRequest(OperationType operation, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds) private view {
		require(operationValue > 0 || operation == OperationType.SetVaultUnderwritingLimit, 'Staged operation amount must be non-zero');
		require(validForSeconds > 0, 'Staged operation timeout must be positive');
		require(validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'Staged operation timeout exceeds the maximum allowed');
		if (operation != OperationType.Liquidation) {
			require(targetVault == msg.sender, 'Self operation target mismatch');
			require(receiverVault == msg.sender && approvalId == bytes32(0), 'Self route mismatch');
		} else {
			require(receiverVault != targetVault, 'Receiver is target');
		}
		require(!securityPool.isEscalationResolved(), 'Escalation resolved');
		if (address(sharedPriceFeed) == address(0) && pendingReportId() != 0 && !isPriceValid()) {
			require(msg.sender == pendingReportSponsor(), 'Only the pending report sponsor can queue more operations until settlement');
		}
		if (operation == OperationType.WithdrawRep) {
			uint256 withdrawRepAmountAttoRep = vaultOperations.previewWithdrawRep(securityPool, msg.sender, operationValue);
			require(withdrawRepAmountAttoRep > 0, STAGED_OPERATION_ERROR_ZERO_WITHDRAW);
		}
	}

	function _recordStagedOperation(OperationType operation, address operator, address targetVault, address receiverVault, bytes32 approvalId, uint256 operationValue, uint256 validForSeconds) private returns (uint256 operationId, HistoricalQueueSnapshot memory snapshot) {
		stagedOperationCounter++;
		operationId = stagedOperationCounter;
		if (operation == OperationType.SetVaultUnderwritingLimit) {
			uint256 previousId = latestBackingTargetOperationIds[targetVault];
			require(stagedOperations[previousId].operator == address(0) || stagedOperations[previousId].operation != OperationType.VaultOperations, 'Vault bundle already pending');
			if (stagedOperations[previousId].operator != address(0))
				_consumeAndEmitExecutedStagedOperation(previousId, operation, false, 'Backing target superseded');
			latestBackingTargetOperationIds[targetVault] = operationId;
		}
		// Liquidations snapshot the complete collateral bundle, including committed REP.
		// Backing or capacity mutations invalidate the quote, protecting rescue deposits.
		// Other operations retain this observation only for history and event context.
		snapshot = _captureHistoricalQueueSnapshot(operation, targetVault);
		uint256 reservedLiquidationDebtAttoEth;
		if (operation == OperationType.Liquidation && receiverVault != operator) {
			reservedLiquidationDebtAttoEth = liquidationApprovalRegistry.reserve(operationId, approvalId, receiverVault, targetVault, operator, operationValue, snapshot.targetUnderwritingLimitAttoEth, block.timestamp + uint256(settlementTime) + validForSeconds);
		} else if (operation == OperationType.Liquidation) {
			require(approvalId == bytes32(0), 'Self approval must be zero');
		}
		stagedOperations[operationId] = StagedOperation({operation: operation, operator: operator, receiverVault: receiverVault, targetVault: targetVault, operationValue: operationValue, queuedAt: block.timestamp, validForSeconds: validForSeconds, snapshotTargetBackingUnits: snapshot.targetBackingUnits, snapshotTargetUnderwritingLimitAttoEth: snapshot.targetUnderwritingLimitAttoEth, liquidationApprovalId: approvalId, reservedLiquidationDebtAttoEth: reservedLiquidationDebtAttoEth});
		_trackActiveStagedOperation(operationId);
		if (operation == OperationType.Liquidation) {
			emit LiquidationRouteStaged(operationId, operator, receiverVault, targetVault, approvalId, operationValue, reservedLiquidationDebtAttoEth);
		}
	}

	/// @dev Executes immediately under a valid price; otherwise joins the pending settlement set and,
	/// when it opens that set, requests a price. Returns the bounty retained from `msg.value`.
	function _executeOrQueueStagedOperation(uint256 operationId, HistoricalQueueSnapshot memory snapshot, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) private returns (uint256 retained) {
		if (isPriceValid()) {
			_emitStagedOperationQueued(operationId, snapshot, false);
			executeStagedOperation(operationId);
			return 0;
		}
		if (address(sharedPriceFeed) != address(0)) {
			// Shared feeds accept independent reports. Operations execute individually
			// against any later valid canonical price, without a global queue slot.
			_emitStagedOperationQueued(operationId, snapshot, false);
			_requireRequestBounty(bountyAttoEth);
			_requestPrice(stagedOperations[operationId].operator, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);
			return bountyAttoEth;
		}
		bool shouldRequestPrice = pendingReportId() == 0 && pendingSettlementOperationIds.length == 0;
		bool isPendingSettlementOperationId = _trackPendingSettlementOperation(operationId);
		_emitStagedOperationQueued(operationId, snapshot, isPendingSettlementOperationId);
		if (shouldRequestPrice && isPendingSettlementOperationId) {
			_requireRequestBounty(bountyAttoEth);
			retained = bountyAttoEth;
			_requestPrice(stagedOperations[operationId].operator, bountyAttoEth, proposedRepPerEthPrice, requestedInitialAttoWeth);
		}
	}

	function _captureHistoricalQueueSnapshot(OperationType operation, address targetVault) private view returns (HistoricalQueueSnapshot memory snapshot) {
		(snapshot.targetBackingUnits, snapshot.targetUnderwritingLimitAttoEth, , ) = securityPool.securityVaults(targetVault);
		snapshot.targetOpenInterestAttoEth = securityPool.getVaultOpenInterestAttoEth(targetVault);
		snapshot.totalPoolHeldAttoRep = securityPool.getTotalPoolHeldAttoRep();
		snapshot.totalRepBackingUnits = securityPool.totalRepBackingUnits();
		snapshot.targetDisputeStakedAttoRep =
			operation == OperationType.Liquidation && address(securityPool.escalationGame()) != address(0x0)
				? securityPool.escalationGame().getVaultDisputeBackingAttoRep(targetVault)
				: 0;
	}

	/// @notice Executes a staged operation under a valid price, or consumes it as failed when expired or stale; callable by anyone.
	function executeStagedOperation(uint256 operationId) public {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_EXPIRED);
			return;
		}
		require(isPriceValid(), 'Valid oracle price required');
		if (stagedOperation.operation == OperationType.Liquidation) {
			(uint256 currentTargetBackingUnits, uint256 currentTargetUnderwritingLimitAttoEth, , ) = securityPool.securityVaults(stagedOperation.targetVault);
			if (
				currentTargetBackingUnits != stagedOperation.snapshotTargetBackingUnits ||
				currentTargetUnderwritingLimitAttoEth != stagedOperation.snapshotTargetUnderwritingLimitAttoEth
			) {
				_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_STALE_LIQUIDATION);
				return;
			}
		}
		if (
			stagedOperation.operation == OperationType.WithdrawRep &&
			vaultOperations.previewWithdrawRep(securityPool, stagedOperation.operator, stagedOperation.operationValue) ==
				0
		) {
			_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_ZERO_WITHDRAW);
			return;
		}
		_executeSingleStagedOperation(operationId, stagedOperation);
	}

	/// @notice Consumes an expired staged operation as failed; callable by anyone.
	function expireStagedOperation(uint256 operationId) external {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.operator != address(0), 'Staged operation unavailable');
		require(block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds, 'Staged operation active');
		_consumeAndEmitExecutedStagedOperation(operationId, stagedOperation.operation, false, STAGED_OPERATION_ERROR_EXPIRED);
	}

	function _emitExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string memory errorMessage) private {
		emit ExecutedStagedOperation(operationId, operation, success, errorMessage);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationExecuted, 0, operationId);
	}

	function _consumeAndEmitExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string memory errorMessage) private {
		_consumeStagedOperation(operationId);
		_emitExecutedStagedOperation(operationId, operation, success, errorMessage);
	}

	function _executeSingleStagedOperation(uint256 operationId, StagedOperation memory operation) private {
		try vaultOperations.executeSingle(operationId, operation) returns (uint256 debtMovedAttoEth) {
			if (operation.liquidationApprovalId != bytes32(0))
				require(debtMovedAttoEth <= operation.reservedLiquidationDebtAttoEth, 'Debt exceeds reservation');
			if (operation.operation == OperationType.Liquidation)
				liquidationApprovalRegistry.consume(operationId, debtMovedAttoEth);
			else liquidationApprovalRegistry.release(operationId);
			_deleteStagedOperation(operationId);
			_emitExecutedStagedOperation(operationId, operation.operation, true, STAGED_OPERATION_EXECUTION_OK);
		} catch Error(string memory reason) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, reason);
		} catch Panic(uint256) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, STAGED_OPERATION_ERROR_PANIC);
		} catch (bytes memory) {
			_consumeAndEmitExecutedStagedOperation(operationId, operation.operation, false, STAGED_OPERATION_ERROR_UNKNOWN);
		}
	}

	function _emitStagedOperationQueued(uint256 operationId, HistoricalQueueSnapshot memory snapshot, bool isPendingSlot) private {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		emit StagedOperationQueued(operationId, stagedOperation.operation, stagedOperation.operator, stagedOperation.targetVault, stagedOperation.operationValue, stagedOperation.queuedAt, stagedOperation.validForSeconds, snapshot.targetBackingUnits, snapshot.targetUnderwritingLimitAttoEth, snapshot.targetOpenInterestAttoEth, snapshot.targetDisputeStakedAttoRep, snapshot.totalPoolHeldAttoRep, snapshot.totalRepBackingUnits, isPendingSlot);
		_emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason.OperationQueued, pendingReportId(), operationId);
	}

	function _emitCoordinatorStateCheckpoint(CoordinatorCheckpointReason reason, uint256 reportId, uint256 operationId) internal override {
		emit CoordinatorStateCheckpoint(reason, reportId, operationId, pendingReportId(), pendingReportSponsor(), pendingOperationSlotId, pendingReportMaxSettlementBaseFeeAttoEthPerGas(), lastPrice(), lastSettlementTimestamp(), stagedOperationCounter, activeStagedOperationCount, pendingSettlementOperationIds.length);
	}

	function _consumeStagedOperation(uint256 operationId) private {
		liquidationApprovalRegistry.release(operationId);
		_deleteStagedOperation(operationId);
	}

	function _deleteStagedOperation(uint256 operationId) private {
		if (stagedOperations[operationId].operation == OperationType.VaultOperations)
			vaultOperations.release(operationId);
		_consumePendingSettlementOperation(operationId);
		_consumeActiveStagedOperation(operationId);
		stagedOperations[operationId].operator = address(0);
	}

	/// @notice Returns the first pending settlement operation.
	function getPendingOperationSlot() public view returns (StagedOperation memory) {
		return stagedOperations[pendingOperationSlotId];
	}

	/// @notice Returns the number of active staged operations.
	function getActiveStagedOperationCount() public view returns (uint256) {
		return activeStagedOperationCount;
	}

	/// @notice Returns the number of operations waiting for the next price settlement.
	function getPendingSettlementOperationCount() public view returns (uint256) {
		return pendingSettlementOperationIds.length;
	}

	/// @notice Returns the operation ids waiting for the next price settlement.
	function getPendingSettlementOperationIds() public view returns (uint256[] memory) {
		return pendingSettlementOperationIds;
	}

	/// @notice Returns the owner's live commitment operation, including expired operations awaiting consumption.
	function getPendingCommitmentOperationId(address owner) public view returns (uint256) {
		uint256 operationId = latestBackingTargetOperationIds[owner];
		return stagedOperations[operationId].operator == address(0) ? 0 : operationId;
	}

	/// @notice Pages newest first from an inclusive active operation id; zero starts at the head.
	/// @dev Pin every page to one block. A consumed cursor reverts; nextCursor is zero at the end.
	function getActiveStagedOperationsPage(uint256 cursorOperationId, uint256 count) public view returns (uint256[] memory operationIds, StagedOperation[] memory operations, uint256 nextCursor) {
		require(count > 0, 'Page count must be positive');
		require(cursorOperationId == 0 || isActiveStagedOperation[cursorOperationId], 'Inactive operation cursor');
		uint256 operationId = cursorOperationId == 0 ? latestActiveStagedOperationId : cursorOperationId;
		nextCursor = operationId;
		uint256 resultCount;
		while (resultCount < count && nextCursor != 0) {
			resultCount++;
			nextCursor = olderActiveStagedOperationIds[nextCursor];
		}
		operationIds = new uint256[](resultCount);
		operations = new StagedOperation[](resultCount);
		for (uint256 index = 0; index < resultCount; index++) {
			operationIds[index] = operationId;
			operations[index] = stagedOperations[operationId];
			operationId = olderActiveStagedOperationIds[operationId];
		}
	}

	function _trackActiveStagedOperation(uint256 operationId) private {
		if (isActiveStagedOperation[operationId]) return;
		isActiveStagedOperation[operationId] = true;
		activeStagedOperationCount++;
		if (latestActiveStagedOperationId != 0) {
			olderActiveStagedOperationIds[operationId] = latestActiveStagedOperationId;
			newerActiveStagedOperationIds[latestActiveStagedOperationId] = operationId;
		}
		latestActiveStagedOperationId = operationId;
	}

	function _trackPendingSettlementOperation(uint256 operationId) private returns (bool) {
		uint256 work =
			stagedOperations[operationId].operation == OperationType.VaultOperations
				? stagedOperations[operationId].operationValue
				: 1;
		if (getPendingSettlementWork() + work > MAX_PENDING_SETTLEMENT_OPERATIONS) return false;
		pendingSettlementOperationIds.push(operationId);
		if (pendingOperationSlotId == 0) {
			pendingOperationSlotId = operationId;
		}
		return true;
	}

	function _consumePendingSettlementOperation(uint256 operationId) private {
		uint256 operationCount = pendingSettlementOperationIds.length;
		for (uint256 index = 0; index < operationCount; index++) {
			if (pendingSettlementOperationIds[index] != operationId) continue;
			for (uint256 shiftIndex = index + 1; shiftIndex < operationCount; shiftIndex++) {
				pendingSettlementOperationIds[shiftIndex - 1] = pendingSettlementOperationIds[shiftIndex];
			}
			pendingSettlementOperationIds.pop();
			pendingOperationSlotId = pendingSettlementOperationIds.length == 0 ? 0 : pendingSettlementOperationIds[0];
			return;
		}
	}

	function _consumeActiveStagedOperation(uint256 operationId) private {
		if (!isActiveStagedOperation[operationId]) return;
		uint256 olderOperationId = olderActiveStagedOperationIds[operationId];
		uint256 newerOperationId = newerActiveStagedOperationIds[operationId];
		if (newerOperationId != 0) {
			olderActiveStagedOperationIds[newerOperationId] = olderOperationId;
		} else {
			latestActiveStagedOperationId = olderOperationId;
		}
		if (olderOperationId != 0) {
			newerActiveStagedOperationIds[olderOperationId] = newerOperationId;
		}
		delete olderActiveStagedOperationIds[operationId];
		delete newerActiveStagedOperationIds[operationId];
		delete isActiveStagedOperation[operationId];
		activeStagedOperationCount--;
	}
}
