// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 5 minutes;
uint256 constant PRICE_PRECISION = 1e18;
uint256 constant ORACLE_BUDGET_BPS = 10000;
uint256 constant MAX_OPERATION_VALID_FOR_SECONDS = 5 minutes;

enum OperationType {
	Liquidation,
	WithdrawRep,
	SetSecurityBondsAllowance
}

struct StagedOperation {
	OperationType operation;
	address initiatorVault;
	address targetVault;
	uint256 amount;
	uint256 queuedAt;
	uint256 validForSeconds;
	uint256 snapshotTargetOwnership;
	uint256 snapshotTargetAllowance;
	uint256 snapshotTotalRep;
	uint256 snapshotDenominator;
}

contract SecurityPoolOracleCoordinator {
	uint256 public pendingReportId;
	uint256 public pendingOperationSlotId;
	uint256 public lastSettlementTimestamp;
	uint256 public lastPrice; // (REP * PRICE_PRECISION) / ETH;
	ReputationToken immutable reputationToken;
	ISecurityPool public securityPool;
	OpenOracle public immutable openOracle;
	IWeth9 public immutable weth;
	uint256 public immutable gasConsumedOpenOracleReportPrice;
	uint32 public immutable gasConsumedSettlement;
	uint256 public immutable exactToken1Report;
	uint48 public immutable settlementTime;
	uint24 public immutable disputeDelay;
	uint24 public immutable protocolFee;
	uint24 public immutable feePercentage;
	uint16 public immutable multiplier;
	bool public immutable timeType;
	bool public immutable trackDisputes;
	address public immutable protocolFeeRecipient;
	uint256 public immutable priceRoundBudgetMultiplierBps;
	uint256 public immutable escalationHaltMultiplierBps;
	uint256 public immutable maxSettlementBaseFeeMultiplierBps;
	uint256 public immutable minLiquidationPriceDistanceBps;
	uint256 public pendingReportMaxSettlementBaseFee;
	uint256 public priceRoundId;
	uint256 public priceRoundMaxNotional;
	uint256 public priceRoundConsumedNotional;

	event PriceReported(uint256 reportId, uint256 price);
	event StagedOperationQueued(
		uint256 operationId,
		OperationType operation,
		address initiatorVault,
		address targetVault,
		uint256 amount,
		bool isPendingSlot
	);
	event ExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string errorMessage);

	// This is not a FIFO queue. We keep an append-only operation record and a single
	// pending slot that settlement can auto-execute once a fresh oracle price arrives.
	// Active-operation paging is newest-first so UI previews remain stable after manual
	// execution removes older entries from the set.
	uint256 public stagedOperationCounter;
	mapping(uint256 => StagedOperation) public stagedOperations;
	uint256 private activeStagedOperationCount;
	uint256 private latestActiveStagedOperationId;
	mapping(uint256 => uint256) private olderActiveStagedOperationIds;
	mapping(uint256 => uint256) private newerActiveStagedOperationIds;
	mapping(uint256 => bool) private isActiveStagedOperation;

	constructor(
		OpenOracle _openOracle,
		ReputationToken _reputationToken,
		IWeth9 _weth,
		uint256 _gasConsumedOpenOracleReportPrice,
		uint32 _gasConsumedSettlement,
		uint256 _exactToken1Report,
		uint48 _settlementTime,
		uint24 _disputeDelay,
		uint24 _protocolFee,
		uint24 _feePercentage,
		uint16 _multiplier,
		bool _timeType,
		bool _trackDisputes,
		address _protocolFeeRecipient,
		uint256 _priceRoundBudgetMultiplierBps,
		uint256 _escalationHaltMultiplierBps,
		uint256 _maxSettlementBaseFeeMultiplierBps,
		uint256 _minLiquidationPriceDistanceBps
	) {
		reputationToken = _reputationToken;
		openOracle = _openOracle;
		weth = _weth;
		gasConsumedOpenOracleReportPrice = _gasConsumedOpenOracleReportPrice;
		gasConsumedSettlement = _gasConsumedSettlement;
		exactToken1Report = _exactToken1Report;
		settlementTime = _settlementTime;
		disputeDelay = _disputeDelay;
		protocolFee = _protocolFee;
		feePercentage = _feePercentage;
		multiplier = _multiplier;
		timeType = _timeType;
		trackDisputes = _trackDisputes;
		protocolFeeRecipient = _protocolFeeRecipient;
		require(_priceRoundBudgetMultiplierBps > 0, 'price budget multiplier is zero');
		require(_escalationHaltMultiplierBps > 0, 'escalation halt multiplier is zero');
		priceRoundBudgetMultiplierBps = _priceRoundBudgetMultiplierBps;
		escalationHaltMultiplierBps = _escalationHaltMultiplierBps;
		require(_maxSettlementBaseFeeMultiplierBps >= ORACLE_BUDGET_BPS, 'base fee multiplier too low');
		require(_minLiquidationPriceDistanceBps <= ORACLE_BUDGET_BPS, 'liquidation distance too high');
		maxSettlementBaseFeeMultiplierBps = _maxSettlementBaseFeeMultiplierBps;
		minLiquidationPriceDistanceBps = _minLiquidationPriceDistanceBps;
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require(address(securityPool) == address(0x0), 'already set!');
		securityPool = _securityPool;
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'only security pool can set');
		lastPrice = _lastPrice;
	}

	function getRequestPriceEthCost() public view returns (uint256) {
		uint256 ethCost = block.basefee * 4 * (gasConsumedSettlement + gasConsumedOpenOracleReportPrice) + 101;
		return ethCost;
	}
	function requestPrice() public payable {
		require(pendingReportId == 0, 'Already pending request');
		uint256 ethCost = getRequestPriceEthCost();
		require(msg.value >= ethCost, 'not big enough eth bounty');
		uint256 escalationHalt = (exactToken1Report * escalationHaltMultiplierBps) / ORACLE_BUDGET_BPS;
		uint256 settlerReward = block.basefee * 2 * gasConsumedOpenOracleReportPrice;
		require(exactToken1Report <= type(uint128).max, 'exactToken1Report too large');
		require(escalationHalt <= type(uint128).max, 'escalation halt too large');
		require(settlerReward <= type(uint96).max, 'settler reward too large');
		pendingReportMaxSettlementBaseFee = (block.basefee * maxSettlementBaseFeeMultiplierBps) / ORACLE_BUDGET_BPS;

		OpenOracle.CreateReportParams memory reportparams = OpenOracle.CreateReportParams({
			exactToken1Report: uint128(exactToken1Report),
			escalationHalt: uint128(escalationHalt), // amount of token1 past which escalation stops but disputes can still happen
			settlerReward: uint96(settlerReward), // eth paid to settler in wei
			token1Address: address(reputationToken), // address of token1 in the oracle report instance
			settlementTime: settlementTime,
			disputeDelay: disputeDelay,
			protocolFee: protocolFee,
			token2Address: address(weth), // address of token2 in the oracle report instance
			callbackGasLimit: gasConsumedSettlement, // gas the settlement callback must use
			feePercentage: feePercentage,
			multiplier: multiplier,
			timeType: timeType,
			trackDisputes: trackDisputes,
			callbackContract: address(this), // contract address for settle to call back into
			protocolFeeRecipient: protocolFeeRecipient
		});

		pendingReportId = openOracle.createReportInstance{ value: ethCost }(reportparams);

		// Refund any excess Ether sent by the caller
		uint256 excess = msg.value - ethCost;
		if (excess > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: excess }('');
			require(sent, 'failed to refund excess');
		}
	}
	function openOracleCallback(
		uint256 reportId,
		uint256 amount1,
		uint256 amount2,
		uint256,
		address,
		address
	) external {
		require(msg.sender == address(openOracle), 'only open oracle can call');
		require(reportId == pendingReportId, 'not report created by us');
		pendingReportId = 0;
		if (block.basefee > pendingReportMaxSettlementBaseFee) {
			pendingReportMaxSettlementBaseFee = 0;
			return;
		}
		pendingReportMaxSettlementBaseFee = 0;
		if (amount1 == 0 || amount2 == 0) {
			return;
		}
		uint256 price = (amount1 * PRICE_PRECISION) / amount2;
		if (price == 0) {
			return;
		}
		lastSettlementTimestamp = block.timestamp;
		lastPrice = price;
		priceRoundId++;
		priceRoundConsumedNotional = 0;
		priceRoundMaxNotional =
			(exactToken1Report * PRICE_PRECISION * priceRoundBudgetMultiplierBps) /
			price /
			ORACLE_BUDGET_BPS;
		emit PriceReported(reportId, lastPrice);
		if (pendingOperationSlotId != 0) {
			// TODO we maybe should allow executing couple operations?
			uint256 operationId = pendingOperationSlotId;
			pendingOperationSlotId = 0;
			StagedOperation memory stagedOperation = stagedOperations[operationId];
			if (stagedOperation.initiatorVault == address(0)) return;
			if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
				_consumeActiveStagedOperation(operationId);
				stagedOperations[operationId].initiatorVault = address(0);
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'staged operation expired');
				return;
			}
			executeStagedOperation(operationId);
		}
	}

	function isPriceValid() public view returns (bool) {
		return
			lastPrice > 0 &&
			lastSettlementTimestamp != 0 &&
			lastSettlementTimestamp + PRICE_VALID_FOR_SECONDS > block.timestamp;
	}

	function getPriceRoundRemainingNotional() public view returns (uint256) {
		if (priceRoundMaxNotional <= priceRoundConsumedNotional) return 0;
		return priceRoundMaxNotional - priceRoundConsumedNotional;
	}

	function requestPriceIfNeededAndStageOperation(
		OperationType operation,
		address targetVault,
		uint256 amount,
		uint256 validForSeconds
	) public payable {
		if (operation != OperationType.SetSecurityBondsAllowance) {
			require(amount > 0, 'need to do non zero operation');
		}
		require(validForSeconds > 0, 'operation timeout must be positive');
		require(validForSeconds <= MAX_OPERATION_VALID_FOR_SECONDS, 'operation timeout too long');
		if (operation != OperationType.Liquidation) {
			require(targetVault == msg.sender, 'self operation target must match initiator');
		}
		require(!securityPool.isEscalationResolved(), 'question already resolved');
		stagedOperationCounter++;
		uint256 operationId = stagedOperationCounter;
		// Capture the target vault state at queue time. Liquidation may still execute if
		// the target deposits more REP after staging, but allowance changes or ownership
		// decreases make the snapshot stale. Stale operations are consumed and must be
		// restaged against current state.
		// Liquidation should value the vault's full collateral claim. That means using the
		// pool's total REP balance here rather than only the currently withdrawable balance.
		(uint256 snapshotTargetOwnership, uint256 snapshotTargetAllowance, , ) = securityPool.securityVaults(
			targetVault
		);
		uint256 snapshotTotalRep = securityPool.getTotalRepBalance();
		uint256 snapshotDenominator = securityPool.poolOwnershipDenominator();
		stagedOperations[operationId] = StagedOperation({
			operation: operation,
			initiatorVault: msg.sender,
			targetVault: targetVault,
			amount: amount,
			queuedAt: block.timestamp,
			validForSeconds: validForSeconds,
			snapshotTargetOwnership: snapshotTargetOwnership,
			snapshotTargetAllowance: snapshotTargetAllowance,
			snapshotTotalRep: snapshotTotalRep,
			snapshotDenominator: snapshotDenominator
		});
		_trackActiveStagedOperation(operationId);

		uint256 retained = 0; // amount to retain from msg.value (cost incurred)

		if (
			isPriceValid() && _getOperationNotional(stagedOperations[operationId]) <= getPriceRoundRemainingNotional()
		) {
			emit StagedOperationQueued(operationId, operation, msg.sender, targetVault, amount, false);
			executeStagedOperation(operationId);
			// no cost when price is valid
		} else if (pendingReportId == 0 && pendingOperationSlotId == 0) {
			pendingOperationSlotId = operationId;
			emit StagedOperationQueued(operationId, operation, msg.sender, targetVault, amount, true);
			uint256 ethCost = getRequestPriceEthCost();
			require(msg.value >= ethCost, 'not enough eth to request price');
			retained += ethCost;
			// Forward exactly ethCost to requestPrice to create the report
			this.requestPrice{ value: ethCost }();
		} else if (pendingReportId == 0) {
			emit StagedOperationQueued(operationId, operation, msg.sender, targetVault, amount, false);
		} else if (pendingOperationSlotId == 0) {
			pendingOperationSlotId = operationId;
			emit StagedOperationQueued(operationId, operation, msg.sender, targetVault, amount, true);
		} else {
			emit StagedOperationQueued(operationId, operation, msg.sender, targetVault, amount, false);
			// This is intentional: only one staged operation is marked as the auto-execute
			// pending slot for the next fresh oracle report. Additional operations are still
			// recorded and can be executed manually via executeStagedOperation once the price
			// becomes valid again.
		}

		// Refund the excess of msg.value that was not retained
		uint256 refund = msg.value - retained;
		if (refund > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: refund }('');
			require(sent, 'failed to return eth');
		}
	}

	function executeStagedOperation(uint256 operationId) public {
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		require(stagedOperation.initiatorVault != address(0), 'no such operation');
		require(isPriceValid(), 'price is not valid to execute');
		if (block.timestamp > stagedOperation.queuedAt + settlementTime + stagedOperation.validForSeconds) {
			_consumeStagedOperation(operationId);
			emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'staged operation expired');
			return;
		}
		uint256 operationNotional = _getOperationNotional(stagedOperation);
		if (operationNotional > getPriceRoundRemainingNotional()) {
			_consumeStagedOperation(operationId);
			emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'oracle budget exceeded');
			return;
		}
		if (stagedOperation.operation == OperationType.Liquidation) {
			(uint256 currentTargetOwnership, uint256 currentTargetAllowance, , ) = securityPool.securityVaults(
				stagedOperation.targetVault
			);
			if (
				currentTargetOwnership < stagedOperation.snapshotTargetOwnership ||
				currentTargetAllowance != stagedOperation.snapshotTargetAllowance
			) {
				_consumeStagedOperation(operationId);
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'stale liquidation');
				return;
			}
			if (!_isLiquidationBeyondMinPriceDistance(stagedOperation)) {
				_consumeStagedOperation(operationId);
				emit ExecutedStagedOperation(
					operationId,
					stagedOperation.operation,
					false,
					'liquidation too close to threshold'
				);
				return;
			}
			_consumeStagedOperation(operationId);
			try
				securityPool.performLiquidation(
					stagedOperation.initiatorVault,
					stagedOperation.targetVault,
					stagedOperation.amount,
					stagedOperation.snapshotTargetOwnership,
					stagedOperation.snapshotTargetAllowance,
					stagedOperation.snapshotTotalRep,
					stagedOperation.snapshotDenominator
				)
			{
				_consumePriceRoundNotional(operationNotional);
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		} else if (stagedOperation.operation == OperationType.WithdrawRep) {
			_consumeStagedOperation(operationId);
			try securityPool.performWithdrawRep(stagedOperation.initiatorVault, stagedOperation.amount) {
				_consumePriceRoundNotional(operationNotional);
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		} else {
			_consumeStagedOperation(operationId);
			try securityPool.performSetSecurityBondsAllowance(stagedOperation.initiatorVault, stagedOperation.amount) {
				_consumePriceRoundNotional(operationNotional);
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		}
	}

	function _consumePriceRoundNotional(uint256 notional) private {
		priceRoundConsumedNotional += notional;
	}

	function _getOperationNotional(StagedOperation memory stagedOperation) private view returns (uint256) {
		if (stagedOperation.operation == OperationType.Liquidation) {
			uint256 debtToMove = _getLiquidationDebtToMove(stagedOperation);
			uint256 repToMove = _getLiquidationRepToMove(stagedOperation, debtToMove);
			uint256 repEthValue = _repToEthNotional(repToMove);
			return debtToMove > repEthValue ? debtToMove : repEthValue;
		}
		if (stagedOperation.operation == OperationType.WithdrawRep) {
			uint256 price = lastPrice;
			if (price == 0 || stagedOperation.amount == 0) return 0;
			uint256 numerator = stagedOperation.amount * PRICE_PRECISION;
			return (numerator - 1) / price + 1;
		}
		if (stagedOperation.amount <= stagedOperation.snapshotTargetAllowance) return 0;
		return stagedOperation.amount - stagedOperation.snapshotTargetAllowance;
	}

	function _getSnapshotVaultRep(StagedOperation memory stagedOperation) private pure returns (uint256) {
		if (stagedOperation.snapshotDenominator == 0) {
			return stagedOperation.snapshotTargetOwnership / PRICE_PRECISION;
		}
		return
			(stagedOperation.snapshotTargetOwnership * stagedOperation.snapshotTotalRep) /
			stagedOperation.snapshotDenominator;
	}

	function _getLiquidationDebtToMove(StagedOperation memory stagedOperation) private pure returns (uint256) {
		return
			stagedOperation.amount > stagedOperation.snapshotTargetAllowance
				? stagedOperation.snapshotTargetAllowance
				: stagedOperation.amount;
	}

	function _getLiquidationRepToMove(
		StagedOperation memory stagedOperation,
		uint256 debtToMove
	) private pure returns (uint256) {
		if (stagedOperation.snapshotTargetAllowance == 0 || debtToMove == 0) return 0;
		return (debtToMove * _getSnapshotVaultRep(stagedOperation)) / stagedOperation.snapshotTargetAllowance;
	}

	function _repToEthNotional(uint256 repAmount) private view returns (uint256) {
		uint256 price = lastPrice;
		if (price == 0 || repAmount == 0) return 0;
		uint256 numerator = repAmount * PRICE_PRECISION;
		return (numerator - 1) / price + 1;
	}

	function _isLiquidationBeyondMinPriceDistance(StagedOperation memory stagedOperation) private view returns (bool) {
		if (minLiquidationPriceDistanceBps == 0) return true;
		uint256 snapshotTargetAllowance = stagedOperation.snapshotTargetAllowance;
		if (snapshotTargetAllowance == 0) return false;
		uint256 currentPrice = lastPrice;
		if (currentPrice == 0) return false;
		uint256 vaultRep = _getSnapshotVaultRep(stagedOperation);
		uint256 securityMultiplier = securityPool.securityMultiplier();
		uint256 thresholdPrice = (vaultRep * PRICE_PRECISION) / (snapshotTargetAllowance * securityMultiplier);
		if (currentPrice <= thresholdPrice) return false;
		return ((currentPrice - thresholdPrice) * ORACLE_BUDGET_BPS) / currentPrice >= minLiquidationPriceDistanceBps;
	}

	function _consumeStagedOperation(uint256 operationId) private {
		_consumeActiveStagedOperation(operationId);
		stagedOperations[operationId].initiatorVault = address(0);
	}

	function getPendingOperationSlot() public view returns (StagedOperation memory) {
		return stagedOperations[pendingOperationSlotId];
	}

	function getActiveStagedOperationCount() public view returns (uint256) {
		return activeStagedOperationCount;
	}

	function getActiveStagedOperations(
		uint256 startIndex,
		uint256 count
	) public view returns (uint256[] memory operationIds, StagedOperation[] memory operations) {
		if (count == 0 || startIndex >= activeStagedOperationCount) {
			return (new uint256[](0), new StagedOperation[](0));
		}
		uint256 availableCount = activeStagedOperationCount - startIndex;
		uint256 resultCount = count < availableCount ? count : availableCount;
		operationIds = new uint256[](resultCount);
		operations = new StagedOperation[](resultCount);
		uint256 operationId = latestActiveStagedOperationId;
		for (uint256 skipped = 0; skipped < startIndex && operationId != 0; skipped++) {
			operationId = olderActiveStagedOperationIds[operationId];
		}
		for (uint256 index = 0; index < resultCount && operationId != 0; index++) {
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
