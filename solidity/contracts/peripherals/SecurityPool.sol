// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import { OpenOracle } from './openOracle/OpenOracle.sol';
import { Auction } from './Auction.sol';
import { Zoltar } from '../Zoltar.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { CompleteSet } from './CompleteSet.sol';
import { IWeth9 } from '../IWeth9.sol';

struct SecurityVault {
	uint256 securityBondAllowance;
	uint256 repDepositShare;
	uint256 feeAccumulator;
	uint256 unpaidEthFees;
}

enum QuestionOutcome {
	Invalid,
	Yes,
	No
}

enum SystemState {
	Operational,
	OnGoingAFork
}

uint256 constant MIGRATION_TIME = 8 weeks;
uint256 constant AUCTION_TIME = 1 weeks;

// fees
uint256 constant PRICE_PRECISION = 1e18;

uint256 constant MAX_RETENTION_RATE = 999_999_996_848_000_000; // ≈90% yearly
uint256 constant MIN_RETENTION_RATE = 999_999_977_880_000_000; // ≈50% yearly
uint256 constant RETENTION_RATE_DIP = 80; // 80% utilization

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 1 hours;

IWeth9 constant WETH = IWeth9(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

// smallest vaults
uint256 constant MIN_SECURITY_BOND_DEBT = 1 ether; // 1 eth
uint256 constant MIN_REP_DEPOSIT = 10 ether; // 10 rep

uint256 constant gasConsumedOpenOracleReportPrice = 100000; //TODO
uint32 constant gasConsumedSettlement = 1000000; //TODO

function rpow(uint256 x, uint256 n, uint256 baseUnit) pure returns (uint256 z) {
	z = n % 2 != 0 ? x : baseUnit;
	for (n /= 2; n != 0; n /= 2) {
		x = (x * x) / baseUnit;
		if (n % 2 != 0) {
			z = (z * x) / baseUnit;
		}
	}
}

enum OperationType {
	Liquidation,
	WithdrawRep,
	SetSecurityBondsAllowance
}

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
	ReputationToken reputationToken;
	SecurityPool public securityPool;
	OpenOracle public openOracle;

	event PriceReported(uint256 reportId, uint256 price);
	event ExecutetedQueuedOperation(uint256 operationId, OperationType operation, bool success);

	// operation queuing
	uint256 public previousQueuedOperationId;
	mapping(uint256 => QueuedOperation) public queuedOperations;

	constructor(OpenOracle _openOracle, SecurityPool _securityPool, ReputationToken _reputationToken) {
		reputationToken = _reputationToken;
		securityPool = _securityPool;
		openOracle = _openOracle;
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
	}

	function executeQueuedOperation(uint256 operationId) public {
		require(queuedOperations[operationId].amount > 0, 'no such operation or already executed');
		require(isPriceValid());
		// todo, we should allow these operations here to fail, but solidity try catch doesnt work inside the same contract
		if (queuedOperations[operationId].operation == OperationType.Liquidation) {
			try securityPool.performLiquidation(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].targetVault, queuedOperations[operationId].amount) {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, true);
			} catch {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, false);
			}
		} else if(queuedOperations[operationId].operation == OperationType.WithdrawRep) {
			try securityPool.performWithdrawRep(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].amount) {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, true);
			} catch {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, false);
			}
		} else {
			try securityPool.performSetSecurityBondsAllowance(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].amount) {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, true);
			} catch {
				emit ExecutetedQueuedOperation(operationId, queuedOperations[operationId].operation, false);
			}
		}
		queuedOperations[operationId].amount = 0;
	}
}

// Security pool for one market, one universe, one denomination (ETH)
contract SecurityPool {
	uint56 public questionId;
	uint192 public universeId;

	Zoltar public zoltar;
	uint256 public securityBondAllowance;
	uint256 public completeSetCollateralAmount; // amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public migratedRep;
	uint256 public repAtFork;
	uint256 public securityMultiplier;

	uint256 public feesAccrued;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public currentRetentionRate;

	uint256 public securityPoolForkTriggeredTimestamp;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => bool) public claimedAuctionProceeds;

	SecurityPool[3] public children;
	SecurityPool public parent;

	uint256 public truthAuctionStarted;
	SystemState public systemState;

	CompleteSet public completeSet;
	Auction public truthAuction;
	ReputationToken public repToken;
	SecurityPoolFactory public securityPoolFactory;

	PriceOracleManagerAndOperatorQueuer public priceOracleManagerAndOperatorQueuer;
	OpenOracle public openOracle;

	event SecurityBondAllowanceChange(address vault, uint256 from, uint256 to);
	event PerformWithdrawRep(address vault, uint256 amount);
	event PoolRetentionRateChanged(uint256 feesAccrued, uint256 utilization, uint256 retentionRate);
	event ForkSecurityPool(uint256 repAtFork);
	event MigrateVault(address vault, QuestionOutcome outcome, uint256 repDepositShare, uint256 securityBondAllowance);
	event TruthAuctionStarted();
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 repShareAmount);

	modifier isOperational {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime == 0, 'Zoltar has forked');
		require(systemState == SystemState.Operational, 'System is not operational');
		_;
	}

	constructor(SecurityPoolFactory _securityPoolFactory, OpenOracle _openOracle, SecurityPool _parent, Zoltar _zoltar, uint192 _universeId, uint56 _questionId, uint256 _securityMultiplier) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		lastUpdatedFeeAccumulator = block.timestamp;
		(repToken,,) = zoltar.universes(universeId);
		if (address(parent) == address(0x0)) { // origin universe never does truthAuction
			truthAuctionStarted = 1;
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.OnGoingAFork;
			truthAuction = new Auction{ salt: bytes32(uint256(0x1)) }(address(this));
		}
		// todo, we can probably do these smarter so that we don't need migration
		completeSet = new CompleteSet{ salt: bytes32(uint256(0x1)) }(address(this));
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _repEthPrice, uint256 _completeSetCollateralAmount) public {
		require(msg.sender == address(securityPoolFactory), 'only callable by securityPoolFactory');
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		priceOracleManagerAndOperatorQueuer = new PriceOracleManagerAndOperatorQueuer{ salt: bytes32(uint256(0x1)) }(openOracle, this, repToken);
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(_repEthPrice);
	}

	function updateCollateralAmount() public {
		(uint64 endTime,,,) = zoltar.questions(questionId);
		uint256 clampedCurrentTimestamp = (block.timestamp > endTime ? endTime : block.timestamp);
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;

		uint256 newCompleteSetCollateralAmount = completeSetCollateralAmount * rpow(currentRetentionRate, timeDelta, PRICE_PRECISION) / PRICE_PRECISION;
		feesAccrued += completeSetCollateralAmount - newCompleteSetCollateralAmount;
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
		lastUpdatedFeeAccumulator = clampedCurrentTimestamp;
	}

	function updateRetentionRate() public {
		uint256 utilization = (completeSetCollateralAmount * 100) / securityBondAllowance;
		if (utilization <= RETENTION_RATE_DIP) {
			// first slope: 0% → RETENTION_RATE_DIP%
			uint256 utilizationRatio = (utilization * PRICE_PRECISION) / RETENTION_RATE_DIP;
			uint256 slopeSpan = MAX_RETENTION_RATE - MIN_RETENTION_RATE;
			currentRetentionRate = MAX_RETENTION_RATE - (slopeSpan * utilizationRatio) / PRICE_PRECISION;
		} else if (utilization <= 100) {
			// second slope: RETENTION_RATE_DIP% → 100%
			uint256 slopeSpan = MAX_RETENTION_RATE - MIN_RETENTION_RATE;
			currentRetentionRate = MIN_RETENTION_RATE + (slopeSpan * (100 - utilization) * PRICE_PRECISION / (100 - RETENTION_RATE_DIP)) / PRICE_PRECISION;
		} else {
			// clamp to MIN_RETENTION_RATE if utilization > 100%
			currentRetentionRate = MIN_RETENTION_RATE;
		}
		emit PoolRetentionRateChanged(feesAccrued, utilization, currentRetentionRate);
	}

	// I wonder if we want to delay the payments and smooth them out to avoid flashloan attacks?
	function updateVaultFees(address vault) public {
		updateCollateralAmount();
		uint256 accumulatorDiff = feesAccrued - securityVaults[vault].feeAccumulator;
		uint256 fees = (securityVaults[vault].securityBondAllowance * accumulatorDiff) / PRICE_PRECISION;
		securityVaults[vault].feeAccumulator = feesAccrued;
		securityVaults[vault].unpaidEthFees += fees;
	}

	function redeemFees(address vault) public {
		uint256 fees = securityVaults[vault].unpaidEthFees;
		securityVaults[vault].unpaidEthFees = 0;
		(bool sent, ) = payable(vault).call{ value: fees }('');
		require(sent, 'Failed to send Ether');
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 amount) public isOperational {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		uint256 repAmount = amount;
		require((securityVaults[vault].repDepositShare - amount) * PRICE_PRECISION >= securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Local Security Bond Alowance broken');
		require((repToken.balanceOf(address(this)) - amount) * PRICE_PRECISION >= securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Global Security Bond Alowance broken');

		securityVaults[vault].repDepositShare -= amount;
		require(securityVaults[vault].repDepositShare >= MIN_REP_DEPOSIT || securityVaults[vault].repDepositShare == 0, 'min deposit requirement');
		repToken.transfer(vault, repAmount);
		emit PerformWithdrawRep(vault, amount);
	}

	// todo, an owner can save their vault from liquidation if they deposit REP after the liquidation price query is triggered, we probably want to lock the vault from deposits if this has been triggered?
	function depositRep(uint256 amount) public isOperational {
		uint256 repAmount = amount;
		securityVaults[msg.sender].repDepositShare += amount;
		require(securityVaults[msg.sender].repDepositShare >= MIN_REP_DEPOSIT || securityVaults[msg.sender].repDepositShare == 0, 'min deposit requirement');
		repToken.transferFrom(msg.sender, address(this), repAmount);
	}

	////////////////////////////////////////
	// liquidating vault
	////////////////////////////////////////

	//price = (amount1 * PRICE_PRECISION) / amount2;
	// price = REP * PRICE_PRECISION / ETH
	// liquidation moves share of debt and rep to another pool which need to remain non-liquidable
	// this is currently very harsh, as we steal all the rep and debt from the pool
	function performLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount) public isOperational {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		updateVaultFees(targetVaultAddress);
		updateVaultFees(callerVault);
		uint256 vaultsSecurityBondAllowance = securityVaults[targetVaultAddress].securityBondAllowance;
		uint256 vaultsRepDeposit = securityVaults[targetVaultAddress].repDepositShare * repToken.balanceOf(address(this)) / migratedRep;
		require(vaultsSecurityBondAllowance * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() > vaultsRepDeposit * PRICE_PRECISION, 'vault need to be liquidable');

		uint256 debtToMove = debtAmount > securityVaults[callerVault].securityBondAllowance ? securityVaults[callerVault].securityBondAllowance : debtAmount;
		require(debtToMove > 0, 'no debt to move');
		uint256 repToMove = securityVaults[callerVault].repDepositShare * repToken.balanceOf(address(this)) / migratedRep * debtToMove / securityVaults[callerVault].securityBondAllowance;
		require((securityVaults[callerVault].securityBondAllowance+debtToMove) * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() <= (securityVaults[callerVault].repDepositShare + repToMove) * PRICE_PRECISION, 'New pool would be liquidable!');
		securityVaults[targetVaultAddress].securityBondAllowance -= debtToMove;
		securityVaults[targetVaultAddress].repDepositShare -= repToMove * migratedRep / repToken.balanceOf(address(this));

		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].repDepositShare += repToMove * migratedRep / repToken.balanceOf(address(this));

		require(securityVaults[targetVaultAddress].repDepositShare > MIN_REP_DEPOSIT * repToken.balanceOf(address(this)) / migratedRep || securityVaults[targetVaultAddress].repDepositShare == 0, 'min deposit requirement');
		require(securityVaults[targetVaultAddress].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[targetVaultAddress].securityBondAllowance == 0, 'min deposit requirement');
		require(securityVaults[callerVault].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
	}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) public isOperational {
		updateCollateralAmount();
		//require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		//require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		//updateVaultFees(callerVault)
		//require(securityVaults[callerVault].repDepositShare * PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		//require(repToken.balanceOf(address(this)) * PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		securityBondAllowance += amount;
		securityBondAllowance -= oldAllowance;
		//require(securityBondAllowance >= completeSetCollateralAmount, 'minted too many complete sets to allow this');
		securityVaults[callerVault].securityBondAllowance = amount;
		//require(securityVaults[callerVault].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
		emit SecurityBondAllowanceChange(callerVault, oldAllowance, amount);
		updateRetentionRate();
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() payable public isOperational {
		require(msg.value > 0, 'need to send eth');
		updateCollateralAmount();
		require(securityBondAllowance - completeSetCollateralAmount >= msg.value, 'no capacity to create that many sets');
		uint256 amountToMint = completeSet.totalSupply() == completeSetCollateralAmount ? msg.value : msg.value * completeSet.totalSupply() / completeSetCollateralAmount;
		completeSet.mint(msg.sender, amountToMint);
		completeSetCollateralAmount += msg.value;
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 amount) public isOperational {
		updateCollateralAmount();
		// takes in complete set and releases security bond and eth
		uint256 ethValue = amount * completeSetCollateralAmount / completeSet.totalSupply();
		completeSet.burn(msg.sender, amount);
		completeSetCollateralAmount -= ethValue;
		updateRetentionRate();
		(bool sent, ) = payable(msg.sender).call{value: ethValue}('');
		require(sent, 'Failed to send Ether');
	}

	/*
	function redeemShare() isOperational public {
		require(zoltar.isFinalized(universeId, questionId), 'Question has not finalized!');
		//convertes yes,no or invalid share to 1 eth each, depending on market outcome
	}
	*/

	////////////////////////////////////////
	// FORKING (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////
	function forkSecurityPool() public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(systemState == SystemState.Operational, 'System needs to be operational to trigger fork');
		require(securityPoolForkTriggeredTimestamp == 0, 'fork already triggered');
		systemState = SystemState.OnGoingAFork;
		securityPoolForkTriggeredTimestamp = block.timestamp;
		repAtFork = repToken.balanceOf(address(this));
		emit ForkSecurityPool(repAtFork);
		repToken.approve(address(zoltar), repAtFork);
		zoltar.splitRep(universeId); // converts origin rep to rep_true, rep_false and rep_invalid
		// we could pay the caller basefee*2 out of Open interest we have?
	}

	// migrates vault into outcome universe after fork
	function migrateVault(QuestionOutcome outcome) public {
		require(securityPoolForkTriggeredTimestamp > 0, 'fork needs to be triggered');
		require(block.timestamp <= securityPoolForkTriggeredTimestamp + MIGRATION_TIME , 'migration time passed');
		require(securityVaults[msg.sender].repDepositShare > 0, 'Vault has no rep to migrate');
		updateVaultFees(msg.sender);
		emit MigrateVault(msg.sender, outcome, securityVaults[msg.sender].repDepositShare, securityVaults[msg.sender].securityBondAllowance);
		if (address(children[uint8(outcome)]) == address(0x0)) {
			// first vault migrater creates new pool and transfers all REP to it
			uint192 childUniverseId = (universeId << 2) + uint192(outcome) + 1;
			children[uint8(outcome)] = securityPoolFactory.deploySecurityPool(openOracle, this, zoltar, childUniverseId, questionId, securityMultiplier, currentRetentionRate, priceOracleManagerAndOperatorQueuer.lastPrice(), completeSetCollateralAmount);
			ReputationToken childReputationToken = children[uint8(outcome)].repToken();
			childReputationToken.transfer(address(children[uint8(outcome)]), childReputationToken.balanceOf(address(this)));
		}
		children[uint256(outcome)].migrateRepFromParent(msg.sender);

		// migrate open interest
		(bool sent, ) = payable(msg.sender).call{value: completeSetCollateralAmount * securityVaults[msg.sender].repDepositShare / repAtFork }('');
		require(sent, 'Failed to send Ether');

		securityVaults[msg.sender].repDepositShare = 0;
		securityVaults[msg.sender].securityBondAllowance = 0;
	}

	function migrateRepFromParent(address vault) public {
		require(msg.sender == address(parent), 'only parent can migrate');
		(uint256 parentSecurityBondAllowance, uint256 parentRepDepositShare,,) = parent.securityVaults(vault);
		securityVaults[vault].securityBondAllowance = parentSecurityBondAllowance;
		securityVaults[vault].repDepositShare = parentRepDepositShare;
		securityBondAllowance += parentSecurityBondAllowance;
		migratedRep += parentRepDepositShare;
	}

	// starts an truthAuction on children
	function startTruthAuction() public {
		require(block.timestamp > securityPoolForkTriggeredTimestamp + MIGRATION_TIME, 'migration time needs to pass first');
		require(truthAuctionStarted == 0, 'Auction already started');
		emit TruthAuctionStarted();
		truthAuctionStarted = block.timestamp;
		if (address(this).balance >= parent.completeSetCollateralAmount()) {
			// we have acquired all the ETH already, no need truthAuction
			systemState = SystemState.Operational;
			truthAuction.finalizeAuction();
		} else {
			uint256 ethToBuy = parent.completeSetCollateralAmount() - address(this).balance;
			truthAuction.startAuction(ethToBuy, repToken.balanceOf(address(this)));
		}
	}

	function finalizeTruthAuction() public {
		require(truthAuctionStarted != 0, 'Auction need to have started');
		require(block.timestamp > truthAuctionStarted + AUCTION_TIME, 'truthAuction still ongoing');
		emit TruthAuctionFinalized();
		truthAuction.finalizeAuction(); // this sends the eth back
		systemState = SystemState.Operational;

		//TODO, if truthAuction fails what do we do?

		//TODO, we need to figure out how to update balances correctly as the current rep holders might have lost REP

		/*
		this code is not needed, just FYI on what can happen after truthAuction:
		uint256 ourRep = repToken.balanceOf(address(this))
		if (migratedRep > ourRep) {
			// we migrated more rep than we got back. This means this pools holders need to take a haircut, this is acounted with repricing pools reps
		} else {
			// we migrated less rep that we got back from truthAuction, this means we can give extra REP to our pool holders, this is acounted with repricing pools reps
		}
		*/
	}

	receive() external payable {
		// needed for Truth Auction to send ETH back
    }

	// accounts the purchased REP from truthAuction to the vault
	// we should also move a share of bad debt in the system to this vault
	function claimAuctionProceeds(address vault) public {
		require(claimedAuctionProceeds[vault] == false, 'Already Claimed');
		require(truthAuction.finalized(), 'Auction needs to be finalized');
		claimedAuctionProceeds[vault] = true;
		uint256 amount = truthAuction.purchasedRep(vault);
		uint256 repShareAmount = amount * (migratedRep == 0 ? 1 : migratedRep / repToken.balanceOf(address(this))); //todo, this is wrong
		securityVaults[msg.sender].repDepositShare += repShareAmount;
		emit ClaimAuctionProceeds(vault, amount, repShareAmount);
	}
}

contract SecurityPoolFactory {
	event DeploySecurityPool(SecurityPool securityPool, OpenOracle openOracle, SecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount);
	function deploySecurityPool(OpenOracle openOracle, SecurityPool parent, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 currentRetentionRate, uint256 startingRepEthPrice, uint256 completeSetCollateralAmount) external returns (SecurityPool securityPoolAddress) {
		securityPoolAddress = new SecurityPool{salt: bytes32(uint256(0x1))}(this, openOracle, parent, zoltar, universeId, questionId, securityMultiplier);
		securityPoolAddress.setStartingParams(currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
		emit DeploySecurityPool(securityPoolAddress, openOracle, parent, zoltar, universeId, questionId, securityMultiplier, currentRetentionRate, startingRepEthPrice, completeSetCollateralAmount);
	}
}
