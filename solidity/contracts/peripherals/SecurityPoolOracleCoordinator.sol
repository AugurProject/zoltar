// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IWeth9 } from './interfaces/IWeth9.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { ISecurityPool } from './interfaces/ISecurityPool.sol';

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 1 hours;

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
	bool public immutable keepFee;
	address public immutable protocolFeeRecipient;
	bool public immutable feeToken;

	event PriceReported(uint256 reportId, uint256 price);
	event ExecutedStagedOperation(uint256 operationId, OperationType operation, bool success, string errorMessage);

	// This is not a FIFO queue. We keep an append-only operation record and a single
	// pending slot that settlement can auto-execute once a fresh oracle price arrives.
	uint256 public stagedOperationCounter;
	mapping(uint256 => StagedOperation) public stagedOperations;

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
		bool _keepFee,
		address _protocolFeeRecipient,
		bool _feeToken
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
		keepFee = _keepFee;
		protocolFeeRecipient = _protocolFeeRecipient;
		feeToken = _feeToken;
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require (address(securityPool) == address(0x0), 'already set!');
		securityPool = _securityPool;
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'only security pool can set');
		lastPrice = _lastPrice;
	}

	function getRequestPriceEthCost() public view returns (uint256) {
		// https://github.com/j0i0m0b0o/openOracleBase/blob/feeTokenChange/src/OpenOracle.sol#L100
		uint256 ethCost = block.basefee * 4 * (gasConsumedSettlement + gasConsumedOpenOracleReportPrice) + 101;
		return ethCost;
	}
	function requestPrice() public payable {
		require(pendingReportId == 0, 'Already pending request');
		// https://github.com/j0i0m0b0o/openOracleBase/blob/feeTokenChange/src/OpenOracle.sol#L100
		uint256 ethCost = getRequestPriceEthCost();
		require(msg.value >= ethCost, 'not big enough eth bounty');

		OpenOracle.CreateReportParams memory reportparams = OpenOracle.CreateReportParams({
			exactToken1Report: exactToken1Report,
			escalationHalt: reputationToken.totalSupply() / 100000, // amount of token1 past which escalation stops but disputes can still happen
			settlerReward: block.basefee * 2 * gasConsumedOpenOracleReportPrice, // eth paid to settler in wei
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
			keepFee: keepFee,
			callbackContract: address(this), // contract address for settle to call back into
			callbackSelector: this.openOracleReportPrice.selector, // method in the callbackContract you want called.
			protocolFeeRecipient: protocolFeeRecipient,
			feeToken: feeToken
		});

		pendingReportId = openOracle.createReportInstance{value: ethCost}(reportparams);

		// Refund any excess Ether sent by the caller
		uint256 excess = msg.value - ethCost;
		if (excess > 0) {
			(bool sent, ) = payable(msg.sender).call{ value: excess }('');
			require(sent, 'failed to refund excess');
		}
	}
	function openOracleReportPrice(uint256 reportId, uint256 price, uint256, address, address) external {
		require(msg.sender == address(openOracle), 'only open oracle can call');
		require(reportId == pendingReportId, 'not report created by us');
		pendingReportId = 0;
		lastSettlementTimestamp = block.timestamp;
		lastPrice = price;
		emit PriceReported(reportId, lastPrice);
		if (pendingOperationSlotId != 0) { // TODO we maybe should allow executing couple operations?
			executeStagedOperation(pendingOperationSlotId);
			pendingOperationSlotId = 0;
		}
	}

	function isPriceValid() public view returns (bool) {
		return lastSettlementTimestamp != 0 && lastSettlementTimestamp + PRICE_VALID_FOR_SECONDS > block.timestamp;
	}

	function requestPriceIfNeededAndStageOperation(OperationType operation, address targetVault, uint256 amount) public payable {
		require(amount > 0, 'need to do non zero operation');
		require(!securityPool.isEscalationResolved(), 'question already resolved');
		stagedOperationCounter++;
		// Capture snapshot of the target vault state at queue time to prevent manipulation.
		// Liquidation should value the vaults full collateral claim. That means using the pools
		// total REP balance here rather than only the currently withdrawable balance.
		(uint256 snapshotTargetOwnership, uint256 snapshotTargetAllowance, , , ) = securityPool.securityVaults(targetVault);
		uint256 snapshotTotalRep = securityPool.getTotalRepBalance();
		uint256 snapshotDenominator = securityPool.poolOwnershipDenominator();
		stagedOperations[stagedOperationCounter] = StagedOperation({
			operation: operation,
			initiatorVault: msg.sender,
			targetVault: targetVault,
			amount: amount,
			snapshotTargetOwnership: snapshotTargetOwnership,
			snapshotTargetAllowance: snapshotTargetAllowance,
			snapshotTotalRep: snapshotTotalRep,
			snapshotDenominator: snapshotDenominator
		});

		uint256 retained = 0; // amount to retain from msg.value (cost incurred)

		if (isPriceValid()) {
			executeStagedOperation(stagedOperationCounter);
			// no cost when price is valid
		} else if (pendingOperationSlotId == 0) {
			pendingOperationSlotId = stagedOperationCounter;
			uint256 ethCost = getRequestPriceEthCost();
			require(msg.value >= ethCost, 'not enough eth to request price');
			retained += ethCost;
			// Forward exactly ethCost to requestPrice to create the report
			this.requestPrice{value: ethCost}();
		} else {
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
		require(stagedOperations[operationId].amount > 0, 'no such operation or already executed');
		require(isPriceValid(), 'price is not valid to execute');
		StagedOperation memory stagedOperation = stagedOperations[operationId];
		bool success;
		if (stagedOperation.operation == OperationType.Liquidation) {
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
				success = true;
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		} else if (stagedOperation.operation == OperationType.WithdrawRep) {
			try
				securityPool.performWithdrawRep(stagedOperation.initiatorVault, stagedOperation.amount)
			{
				success = true;
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		} else {
			try
				securityPool.performSetSecurityBondsAllowance(stagedOperation.initiatorVault, stagedOperation.amount)
			{
				success = true;
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, reason);
			} catch Panic(uint256) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Panic');
			} catch (bytes memory) {
				emit ExecutedStagedOperation(operationId, stagedOperation.operation, false, 'Unknown error');
			}
		}
		if (success) {
			stagedOperations[operationId].amount = 0;
		}
	}

	function getPendingOperationSlot() public view returns (StagedOperation memory) {
		return stagedOperations[pendingOperationSlotId];
	}
}
