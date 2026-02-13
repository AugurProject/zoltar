// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

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

uint256 constant gasConsumedOpenOracleReportPrice = 100000; //TODO
uint32 constant gasConsumedSettlement = 1000000; //TODO

IWeth9 constant WETH = IWeth9(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

struct QueuedOperation {
	OperationType operation;
	address initiatorVault;
	address targetVault;
	uint256 amount;
}

contract PriceOracleManagerAndOperatorQueuer {
	uint256 public pendingReportId;
	uint256 public queuedPendingOperationId;
	uint256 public lastSettlementTimestamp;
	uint256 public lastPrice; // (REP * PRICE_PRECISION) / ETH;
	ReputationToken immutable reputationToken;
	ISecurityPool public securityPool;
	OpenOracle public immutable openOracle;

	event PriceReported(uint256 reportId, uint256 price);
	event ExecutedQueuedOperation(uint256 operationId, OperationType operation, bool success, string errorMessage);

	// operation queuing
	uint256 public previousQueuedOperationId;
	mapping(uint256 => QueuedOperation) public queuedOperations;

	constructor(OpenOracle _openOracle, ReputationToken _reputationToken) {
		reputationToken = _reputationToken;
		openOracle = _openOracle;
	}

	function setSecurityPool(ISecurityPool _securityPool) public {
		require (address(securityPool) == address(0x0), 'already set!');
		securityPool = _securityPool;
	}

	function setRepEthPrice(uint256 _lastPrice) public {
		require(msg.sender == address(securityPool), 'only security pool can set');
		lastPrice = _lastPrice;
	}

	function getRequestPriceEthCost() public view returns (uint256) {// todo, probably something else
		// https://github.com/j0i0m0b0o/openOracleBase/blob/feeTokenChange/src/OpenOracle.sol#L100
		uint256 ethCost = block.basefee * 4 * (gasConsumedSettlement + gasConsumedOpenOracleReportPrice); // todo, probably something else
		return ethCost;
	}
	function requestPrice() public payable {
		require(pendingReportId == 0, 'Already pending request');
		// https://github.com/j0i0m0b0o/openOracleBase/blob/feeTokenChange/src/OpenOracle.sol#L100
		uint256 ethCost = getRequestPriceEthCost();// todo, probably something else
		require(msg.value >= ethCost, 'not big enough eth bounty');

		// TODO, research more on how to set these params
		OpenOracle.CreateReportParams memory reportparams = OpenOracle.CreateReportParams({
			exactToken1Report: 26392439800,//block.basefee * 200 / lastPrice, // initial oracle liquidity in token1
			escalationHalt: reputationToken.totalSupply() / 100000, // amount of token1 past which escalation stops but disputes can still happen
			settlerReward: block.basefee * 2 * gasConsumedOpenOracleReportPrice, // eth paid to settler in wei
			token1Address: address(reputationToken), // address of token1 in the oracle report instance
			settlementTime: 15 * 12,//~15 blocks // report instance can settle if no disputes within this timeframe
			disputeDelay: 0, // time disputes must wait after every new report
			protocolFee: 0, // fee paid to protocolFeeRecipient. 1000 = 0.01%
			token2Address: address(WETH), // address of token2 in the oracle report instance
			callbackGasLimit: gasConsumedSettlement, // gas the settlement callback must use
			feePercentage: 10000, // 0.1% atm, TODO,// fee paid to previous reporter. 1000 = 0.01%
			multiplier: 140, // amount by which newAmount1 must increase versus old amount1. 140 = 1.4x
			timeType: true, // true for block timestamp, false for block number
			trackDisputes: false, // true keeps a readable dispute history for smart contracts
			keepFee: false, // true means initial reporter keeps the initial reporter reward. if false, it goes to protocolFeeRecipient
			callbackContract: address(this), // contract address for settle to call back into
			callbackSelector: this.openOracleReportPrice.selector, // method in the callbackContract you want called.
			protocolFeeRecipient: address(0x0), // address that receives protocol fees and initial reporter rewards if keepFee set to false
			feeToken: true //if true, protocol fees + fees paid to previous reporter are in tokenToSwap. if false, in not(tokenToSwap)
		}); //typically if feeToken true, fees are paid in less valuable token, if false, fees paid in more valuable token

		pendingReportId = openOracle.createReportInstance{value: ethCost}(reportparams);
	}
	function openOracleReportPrice(uint256 reportId, uint256 price, uint256, address, address) external {
		require(msg.sender == address(openOracle), 'only open oracle can call');
		require(reportId == pendingReportId, 'not report created by us');
		pendingReportId = 0;
		lastSettlementTimestamp = block.timestamp;
		lastPrice = price;
		emit PriceReported(reportId, lastPrice);
		if (queuedPendingOperationId != 0) { // todo we maybe should allow executing couple operations?
			executeQueuedOperation(queuedPendingOperationId);
			queuedPendingOperationId = 0;
		}
	}

	function isPriceValid() public view returns (bool)  {
		return lastSettlementTimestamp + PRICE_VALID_FOR_SECONDS > block.timestamp;
	}

	function requestPriceIfNeededAndQueueOperation(OperationType operation, address targetVault, uint256 amount) public payable {
		require(amount > 0, 'need to do non zero operation');
		previousQueuedOperationId++;
		queuedOperations[previousQueuedOperationId] = QueuedOperation({
			operation: operation,
			initiatorVault: msg.sender,
			targetVault: targetVault,
			amount: amount
		});
		if (isPriceValid()) {
			executeQueuedOperation(previousQueuedOperationId);
		} else if (queuedPendingOperationId == 0) {
			queuedPendingOperationId = previousQueuedOperationId;
			requestPrice();
		}
		// send rest of the eth back
		(bool sent, ) = payable(msg.sender).call{ value: address(this).balance }('');
		require(sent, 'Failed to return eth');
	}

	function executeQueuedOperation(uint256 operationId) public {
		require(queuedOperations[operationId].amount > 0, 'no such operation or already executed');
		require(isPriceValid(), 'price is not valid to execute');
		// todo, we should allow these operations here to fail, but solidity try catch doesnt work inside the same contract
		if (queuedOperations[operationId].operation == OperationType.Liquidation) {
			try securityPool.performLiquidation(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].targetVault, queuedOperations[operationId].amount) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, reason);
			} catch (bytes memory lowLevelData) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, 'Unknown error');
			}
		} else if(queuedOperations[operationId].operation == OperationType.WithdrawRep) {
			try securityPool.performWithdrawRep(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].amount) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, reason);
			} catch (bytes memory lowLevelData) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, 'Unknown error');
			}
		} else {
			try securityPool.performSetSecurityBondsAllowance(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].amount) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, true, '');
			} catch Error(string memory reason) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, reason);
			} catch (bytes memory lowLevelData) {
				emit ExecutedQueuedOperation(operationId, queuedOperations[operationId].operation, false, 'Unknown error');
			}
		}
		queuedOperations[operationId].amount = 0;
	}

	function getQueuedOperation() public view returns (QueuedOperation memory) {
		return queuedOperations[queuedPendingOperationId];
	}
}
