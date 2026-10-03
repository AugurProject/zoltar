// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { StagedOperation, OperationType } from './OpenOraclePriceCoordinatorTypes.sol';
import { LiquidationApprovalRegistry } from './LiquidationApprovalRegistry.sol';
import { ISecurityPool, LiquidationRequest, LiquidationSnapshot } from './interfaces/ISecurityPool.sol';

struct VaultLiquidationInput {
	address targetVault;
	uint256 requestedDebtAttoEth;
}

struct VaultOperationsInput {
	uint256 depositAttoRep;
	bool changeCommitment;
	uint256 commitmentAttoEth;
	VaultLiquidationInput[] liquidations;
	uint256 withdrawAttoRep;
	uint256 minimumReceiverHealthFactorBps;
	uint256 validForSeconds;
}

interface IVaultOperationsCoordinator {
	function securityPool() external view returns (ISecurityPool);
	function liquidationApprovalRegistry() external view returns (LiquidationApprovalRegistry);
	function stagedOperationCounter() external view returns (uint256);
	function stageVaultOperations(address owner, bool changeCommitment, uint256 actionCount, uint256 validForSeconds, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256);
	function minLiquidationPriceDistanceBps() external view returns (uint256);
}

/// @notice Stores bounded, ordered pool bundles. Only its creating coordinator can stage, execute, or release them.
contract VaultOperations {
	uint256 public constant MAX_ACTIONS = 4;
	address private immutable coordinator;
	bool private submitting;
	struct BundleLiquidation {
		address targetVault;
		uint256 requestedDebtAttoEth;
		LiquidationSnapshot snapshot;
	}
	struct Bundle {
		address owner;
		bool changeCommitment;
		uint256 commitmentAttoEth;
		uint256 withdrawAttoRep;
		uint256 minimumReceiverHealthFactorBps;
		BundleLiquidation[] liquidations;
	}
	mapping(uint256 => Bundle) private bundles;

	event VaultOperationsStaged(uint256 indexed operationId, address indexed owner, bool changeCommitment, uint256 commitmentAttoEth, uint256 withdrawAttoRep);
	event VaultLiquidationStaged(uint256 indexed operationId, address indexed targetVault, uint256 requestedDebtAttoEth);

	constructor() {
		coordinator = msg.sender;
	}

	modifier onlyCoordinator() {
		require(msg.sender == coordinator, 'Only coordinator');
		_;
	}

	/// @notice One pool, one wallet, one ordered bundle. Deposits are immediate; stale-price actions wait for settlement.
	function submitVaultOperations(VaultOperationsInput calldata input, uint256 proposedRepPerEthPrice, uint256 requestedInitialAttoWeth, uint256 bountyAttoEth) external payable returns (uint256 operationId) {
		require(!submitting, 'Vault submission already active');
		submitting = true;
		ISecurityPool pool = IVaultOperationsCoordinator(coordinator).securityPool();
		if (input.depositAttoRep > 0) pool.depositRepToVaultFromExecutor(msg.sender, input.depositAttoRep);
		if (input.changeCommitment || input.liquidations.length > 0 || input.withdrawAttoRep > 0) {
			operationId = IVaultOperationsCoordinator(coordinator).stagedOperationCounter() + 1;
			uint256 count = _stage(operationId, msg.sender, input);
			require(IVaultOperationsCoordinator(coordinator).stageVaultOperations{value: msg.value}(msg.sender, input.changeCommitment, count, input.validForSeconds, proposedRepPerEthPrice, requestedInitialAttoWeth, bountyAttoEth) == operationId, 'Bundle id changed');
		} else {
			require(input.depositAttoRep > 0, 'Choose a vault action');
			if (msg.value > 0) {
				(bool sent, ) = payable(msg.sender).call{value: msg.value}('');
				require(sent, 'Vault operation refund failed');
			}
		}
		submitting = false;
	}

	function _stage(uint256 operationId, address owner, VaultOperationsInput calldata input) private returns (uint256 actionCount) {
		actionCount =
			input.liquidations.length +
			(input.changeCommitment ? 1 : 0) +
			(input.withdrawAttoRep > 0 ? 1 : 0);
		require(actionCount > 0 && actionCount <= MAX_ACTIONS, 'Choose one to four price actions');
		ISecurityPool pool = IVaultOperationsCoordinator(coordinator).securityPool();
		if (input.liquidations.length > 0)
			require(input.minimumReceiverHealthFactorBps >= 10_000, 'Receiver health factor below one');
		Bundle storage bundle = bundles[operationId];
		bundle.owner = owner;
		bundle.changeCommitment = input.changeCommitment;
		bundle.commitmentAttoEth = input.commitmentAttoEth;
		bundle.withdrawAttoRep = input.withdrawAttoRep;
		bundle.minimumReceiverHealthFactorBps = input.minimumReceiverHealthFactorBps;
		for (uint256 index = 0; index < input.liquidations.length; index++) {
			VaultLiquidationInput calldata liquidation = input.liquidations[index];
			require(liquidation.targetVault != address(0) && liquidation.targetVault != owner, 'Choose another vault');
			require(liquidation.requestedDebtAttoEth > 0, 'Liquidation amount zero');
			for (uint256 previous = 0; previous < index; previous++) {
				require(input.liquidations[previous].targetVault != liquidation.targetVault, 'Duplicate liquidation target');
			}
			(uint256 backingUnits, uint256 limit, , ) = pool.securityVaults(liquidation.targetVault);
			require(backingUnits > 0 && limit > 0, 'Target vault has no commitment');
			bundle.liquidations.push(BundleLiquidation({targetVault: liquidation.targetVault, requestedDebtAttoEth: liquidation.requestedDebtAttoEth, snapshot: LiquidationSnapshot({targetBackingUnits: backingUnits, targetUnderwritingLimitAttoEth: limit})}));
			emit VaultLiquidationStaged(operationId, liquidation.targetVault, liquidation.requestedDebtAttoEth);
		}
		emit VaultOperationsStaged(operationId, owner, input.changeCommitment, input.commitmentAttoEth, input.withdrawAttoRep);
	}

	function getBundle(uint256 operationId) external view returns (Bundle memory) {
		return bundles[operationId];
	}

	/// @dev A single external call creates the rollback boundary for all dependent actions.
	function execute(uint256 operationId) public onlyCoordinator {
		Bundle memory bundle = bundles[operationId];
		require(bundle.owner != address(0), 'Bundle unavailable');
		ISecurityPool pool = IVaultOperationsCoordinator(coordinator).securityPool();
		if (bundle.changeCommitment) pool.setVaultUnderwritingLimit(bundle.owner, bundle.commitmentAttoEth);
		for (uint256 index = 0; index < bundle.liquidations.length; index++) {
			BundleLiquidation memory liquidation = bundle.liquidations[index];
			pool.performLiquidation(LiquidationRequest({operationId: operationId, operator: bundle.owner, receiverVault: bundle.owner, targetVault: liquidation.targetVault, requestedDebtAttoEth: liquidation.requestedDebtAttoEth, snapshot: liquidation.snapshot, minimumReceiverHealthFactorBps: bundle.minimumReceiverHealthFactorBps, minLiquidationPriceDistanceBps: IVaultOperationsCoordinator(coordinator).minLiquidationPriceDistanceBps()}));
		}
		if (bundle.withdrawAttoRep > 0) {
			require(_previewWithdrawRep(pool, bundle.owner, bundle.withdrawAttoRep) > 0, 'Withdraw amount has no effect');
			pool.withdrawRepFromVault(bundle.owner, bundle.withdrawAttoRep);
		}
	}

	/// @notice Uses the same minimum-remainder sweep rule as pool withdrawals.
	function previewWithdrawRep(ISecurityPool pool, address vault, uint256 amountAttoRep) external view returns (uint256) {
		return _previewWithdrawRep(pool, vault, amountAttoRep);
	}

	function _previewWithdrawRep(ISecurityPool pool, address vault, uint256 amountAttoRep) private view returns (uint256) {
		if (amountAttoRep == 0) return 0;
		(uint256 vaultBackingUnits, , , ) = pool.securityVaults(vault);
		uint256 backingUnitsToWithdraw = pool.attoRepToBackingUnits(amountAttoRep);
		uint256 minimumRemainingBackingUnits = pool.attoRepToBackingUnits(pool.minimumVaultRepDepositAttoRep());
		uint256 withdrawBackingUnits =
			backingUnitsToWithdraw + minimumRemainingBackingUnits > vaultBackingUnits
				? vaultBackingUnits
				: backingUnitsToWithdraw;
		return pool.backingUnitsToAttoRep(withdrawBackingUnits);
	}

	/// @notice Executes existing single operations through the same authenticated pool boundary.
	function executeSingle(uint256 operationId, StagedOperation calldata operation) external onlyCoordinator returns (uint256 debtMovedAttoEth) {
		ISecurityPool pool = IVaultOperationsCoordinator(coordinator).securityPool();
		if (operation.operation == OperationType.VaultOperations) {
			execute(operationId);
			return 0;
		}
		if (operation.operation == OperationType.Liquidation) {
			uint256 minimumHealthFactorBps = 10_000;
			uint256 maximumDebtAttoEth = operation.operationValue;
			if (operation.liquidationApprovalId != bytes32(0)) {
				minimumHealthFactorBps = IVaultOperationsCoordinator(coordinator).liquidationApprovalRegistry().minimumHealthFactorBps(operationId);
				maximumDebtAttoEth = operation.reservedLiquidationDebtAttoEth;
			}
			(debtMovedAttoEth, , ) = pool.performLiquidation(LiquidationRequest({operationId: operationId, operator: operation.operator, receiverVault: operation.receiverVault, targetVault: operation.targetVault, requestedDebtAttoEth: maximumDebtAttoEth, snapshot: LiquidationSnapshot({targetBackingUnits: operation.snapshotTargetBackingUnits, targetUnderwritingLimitAttoEth: operation.snapshotTargetUnderwritingLimitAttoEth}), minimumReceiverHealthFactorBps: minimumHealthFactorBps, minLiquidationPriceDistanceBps: IVaultOperationsCoordinator(coordinator).minLiquidationPriceDistanceBps()}));
		} else if (operation.operation == OperationType.WithdrawRep)
			pool.withdrawRepFromVault(operation.operator, operation.operationValue);
		else {
			require(operation.operation == OperationType.SetVaultUnderwritingLimit, 'Unsupported single operation');
			pool.setVaultUnderwritingLimit(operation.operator, operation.operationValue);
		}
	}

	function release(uint256 operationId) external onlyCoordinator {
		delete bundles[operationId];
	}
}
