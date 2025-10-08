// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import { IOpenOracle } from './IOpenOracle.sol';
import { Auction } from './Auction.sol';
import { Zoltar } from '../Zoltar.sol';
import { IERC20 } from '../IERC20.sol';
import { CompleteSet } from './CompleteSet.sol';

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
uint256 constant FEE_DIVISOR = 10000;
uint256 constant MIN_FEE = 200;
uint256 constant FEE_SLOPE1 = 200;
uint256 constant FEE_SLOPE2 = 600;
uint256 constant FEE_DIP = 80;
uint256 constant PRICE_PRECISION = 10 ** 18;

// price oracle
uint256 constant PRICE_VALID_FOR_SECONDS = 1 hours;

IERC20 constant WETH = IERC20(0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2);

// smallest vaults
uint256 constant MIN_SECURITY_BOND_DEBT = 1 ether; // 1 eth
uint256 constant MIN_REP_DEPOSIT = 10 ether; // 10 rep

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
	uint256 public operationQueuedPriceId;
	uint256 public lastSettlementTimestamp;
	uint256 public lastPrice; // (REP * PRICE_PRECISION) / ETH;
	IERC20 reputationToken;
	SecurityPool public securityPool;
	IOpenOracle public openOracle;

	// operation queuing
	uint256 public queuedOperationId;
	mapping(uint256 => QueuedOperation) public queuedOperations;

	constructor(SecurityPool _securityPool, IOpenOracle _openOracle, uint256 _lastPrice) {
		reputationToken = reputationToken;
		lastPrice = _lastPrice;
		securityPool = _securityPool;
		openOracle = _openOracle;
	}

	function requestPrice() public payable {
		require(pendingReportId == 0, 'Already pending request');
		bytes4 callbackSelector = this.openOracleReportPrice.selector;
		uint256 gasConsumedOpenOracleReportPrice = 100000; //TODO
		uint32 gasConsumedSettlement = 100000; //TODO
		// https://github.com/j0i0m0b0o/openOracleBase/blob/feeTokenChange/src/OpenOracle.sol#L100
		uint256 ethCost = block.basefee * 4 * (gasConsumedSettlement + gasConsumedOpenOracleReportPrice); // todo, probably something else
		require(msg.value > ethCost, 'not big enough eth bounty');

		// TODO, research more on how to set these params
		IOpenOracle.CreateReportParams memory reportparams = IOpenOracle.CreateReportParams({
			exactToken1Report: block.basefee * 200 / lastPrice, // initial oracle liquidity in token1
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
			callbackSelector: callbackSelector, // method in the callbackContract you want called.
			protocolFeeRecipient: address(0x0), // address that receives protocol fees and initial reporter rewards if keepFee set to false
			feeToken: true //if true, protocol fees + fees paid to previous reporter are in tokenToSwap. if false, in not(tokenToSwap)
		}); //typically if feeToken true, fees are paid in less valuable token, if false, fees paid in more valuable token

		pendingReportId = openOracle.createReportInstance{value: ethCost}(reportparams);
	}

	function openOracleReportPrice(uint256, uint256 reportId, uint256 price, uint256, address, address) public {
		require(msg.sender == address(openOracle), 'only open oracle can call');
		require(reportId == pendingReportId, 'not report created by us');
		pendingReportId = 0;
		lastSettlementTimestamp = lastSettlementTimestamp;
		lastPrice = price;
		if (operationQueuedPriceId != 0) { // todo we maybe should allow executing couple operations?
			executeQueuedOperation(operationQueuedPriceId);
			operationQueuedPriceId = 0;
		}
	}

	function isPriceValid() public view returns (bool)  {
		return lastSettlementTimestamp < block.timestamp + PRICE_VALID_FOR_SECONDS;
	}

	function requestPriceIfNeededAndQueueOperation(OperationType operation, address targetVault, uint256 amount) public payable {
		queuedOperations[queuedOperationId] = QueuedOperation({
			operation: operation,
			initiatorVault: msg.sender,
			targetVault: targetVault,
			amount: amount
		});
		if (isPriceValid()) {
			executeQueuedOperation(queuedOperationId);
		} else {
			operationQueuedPriceId = queuedOperationId;
			requestPrice();
		}
		queuedOperationId++;
	}

	function executeQueuedOperation(uint256 operationId) public {
		require(queuedOperations[operationId].amount > 0, 'no such operation or already executed');
		require(isPriceValid());
		// todo, we should allow these operations here to fail, but solidity try catch doesnt work inside the same contract
		if (queuedOperations[operationId].operation == OperationType.Liquidation) {
			securityPool.performLiquidation(queuedOperations[operationId].initiatorVault, queuedOperations[operationId].targetVault, queuedOperations[operationId].amount);
		} else if(queuedOperations[operationId].operation == OperationType.WithdrawRep) {
			securityPool.performWithdrawRep(queuedOperations[operationId].targetVault,queuedOperations[operationId].amount);
		} else {
			securityPool.performSetSecurityBondsAllowance(queuedOperations[operationId].targetVault, queuedOperations[operationId].amount);
		}
		queuedOperations[queuedOperationId].amount = 0;
	}
}

// Security pool for one market, one universe, one denomination (ETH)
contract SecurityPool {
	uint56 public questionId;
	uint192 public universeId;

	Zoltar public zoltar;
	uint256 public securityBondAllowance;
	uint256 public ethAmountForCompleteSets;
	uint256 public migratedRep;
	uint256 public repAtFork;
	uint256 public securityMultiplier;

	uint256 public cumulativeFeePerAllowance;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public currentPerSecondFee;

	uint256 public securityPoolForkTriggeredTimestamp;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => bool) public claimedAuctionProceeds;

	SecurityPool[3] public children;
	SecurityPool public parent;

	uint256 public truthAuctionStarted;
	SystemState public systemState;

	CompleteSet public completeSet;
	Auction public auction;
	IERC20 public repToken;
	SecurityPoolFactory public securityPoolFactory;

	PriceOracleManagerAndOperatorQueuer public priceOracleManagerAndOperatorQueuer;
	IOpenOracle public openOracle;

	modifier isOperational {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime == 0, 'Zoltar has forked');
		require(systemState == SystemState.OnGoingAFork, 'System is not operational');
		_;
	}

	constructor(SecurityPoolFactory _securityPoolFactory, IOpenOracle _openOracle, SecurityPool _parent, Zoltar _zoltar, uint192 _universeId, uint56 _questionId, uint256 _securityMultiplier, uint256 _startingPerSecondFee, uint256 _startingRepEthPrice, uint256 _ethAmountForCompleteSets) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		currentPerSecondFee = _startingPerSecondFee;
		(repToken,,) = zoltar.universes(universeId);
		ethAmountForCompleteSets = _ethAmountForCompleteSets;
		priceOracleManagerAndOperatorQueuer = new PriceOracleManagerAndOperatorQueuer(this, _openOracle, _startingRepEthPrice);
		if (address(parent) == address(0x0)) { // origin universe never does auction
			truthAuctionStarted = 1;
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.OnGoingAFork;
			auction = new Auction(); // create auction instance that can start receive orders right away
		}
	}

	// todo, this calculates the fee incorrectly if the update is called way after market end time (as it does not check how long ago it ended)
	function updateFee() public {
		uint256 timeDelta = block.timestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;
		uint256 retentionFactor = rpow(currentPerSecondFee, timeDelta, PRICE_PRECISION);
		uint256 newEthAmountForCompleteSets = (ethAmountForCompleteSets * retentionFactor) / PRICE_PRECISION;

		uint256 feesAccrued = ethAmountForCompleteSets - newEthAmountForCompleteSets;
		ethAmountForCompleteSets = newEthAmountForCompleteSets;
		if (ethAmountForCompleteSets > 0) {
			cumulativeFeePerAllowance += (feesAccrued * PRICE_PRECISION) / newEthAmountForCompleteSets;
		}

		lastUpdatedFeeAccumulator = block.timestamp;
		(uint64 endTime,,,) = zoltar.questions(questionId);
		if (endTime > block.timestamp) {
			// this is for question end time, not finalization time, this removes incentive for rep holders to delay the oracle to extract fees
			currentPerSecondFee = 0;
		} else {
			uint256 utilization = ethAmountForCompleteSets * 100 / securityBondAllowance;
			if (utilization < FEE_DIP) {
				currentPerSecondFee = MIN_FEE + utilization * FEE_SLOPE1;
			} else {
				currentPerSecondFee = MIN_FEE + FEE_DIP * FEE_SLOPE1 + utilization * FEE_SLOPE2;
			}
		}
	}
	// I wonder if we want to delay the payments and smooth them out to avoid flashloan attacks?
	function updateVaultFees(address vault) public {
		updateFee();
		uint256 accumulatorDiff = cumulativeFeePerAllowance - securityVaults[vault].feeAccumulator;
		uint256 fees = (securityVaults[vault].securityBondAllowance * accumulatorDiff) / PRICE_PRECISION;
		securityVaults[vault].feeAccumulator = cumulativeFeePerAllowance;
		securityVaults[vault].unpaidEthFees += fees;
	}

	function redeemFees(address vault) public {
		uint256 fees = securityVaults[vault].unpaidEthFees;
		securityVaults[vault].unpaidEthFees = 0;
		(bool sent, ) = payable(vault).call{value: fees}('');
		require(sent, 'Failed to send Ether');
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 amount) public isOperational {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		uint256 repAmount = amount * migratedRep / repToken.balanceOf(address(this));
		require((securityVaults[vault].repDepositShare - amount) * migratedRep / repToken.balanceOf(address(this)) * PRICE_PRECISION > securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Local Security Bond Alowance broken');
		require((repToken.balanceOf(address(this)) - amount) * PRICE_PRECISION > securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Global Security Bond Alowance broken');

		securityVaults[vault].repDepositShare -= amount;
		require(securityVaults[vault].repDepositShare > MIN_REP_DEPOSIT * repToken.balanceOf(address(this)) / migratedRep || securityVaults[vault].repDepositShare == 0, 'min deposit requirement');
		repToken.transfer(address(this), repAmount);
	}

	// todo, an owner can save their vault from liquidation if they deposit REP after the liquidation price query is triggered, we probably want to lock the vault from deposits if this has been triggered?
	function depositRep(uint256 amount) public isOperational {
		uint256 repAmount = amount * repToken.balanceOf(address(this)) / migratedRep;
		securityVaults[msg.sender].repDepositShare += amount;
		require(securityVaults[msg.sender].repDepositShare > MIN_REP_DEPOSIT * repToken.balanceOf(address(this)) / migratedRep || securityVaults[msg.sender].repDepositShare == 0, 'min deposit requirement');
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
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		updateVaultFees(callerVault);
		require(securityVaults[callerVault].repDepositShare / migratedRep * repToken.balanceOf(address(this)) * PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(repToken.balanceOf(address(this)) * PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(amount < ethAmountForCompleteSets, 'minted too many compete sets to allow this');
		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		securityBondAllowance += amount;
		securityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance += amount;
		securityVaults[callerVault].securityBondAllowance -= oldAllowance;
		require(securityVaults[callerVault].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() payable public isOperational {
		require(msg.value > 0, 'need to send eth');
		require(securityBondAllowance - ethAmountForCompleteSets > msg.value, 'no capacity to create that many sets');
		updateFee();
		uint256 amountToMint = msg.value * address(this).balance / ethAmountForCompleteSets;
		completeSet.mint(msg.sender, amountToMint);
		ethAmountForCompleteSets += msg.value;
	}

	function redeemCompleteSet(uint256 amount) public isOperational {
		updateFee();
		// takes in complete set and releases security bond and eth
		completeSet.burn(msg.sender, amount);
		uint256 ethValue = amount * ethAmountForCompleteSets / address(this).balance;
		(bool sent, ) = payable(msg.sender).call{value: ethValue}('');
		require(sent, 'Failed to send Ether');
		ethAmountForCompleteSets -= ethValue;
	}

	/*
	function redeemShare() isOperational public {
		require(zoltar.isFinalized(universeId, questionId), 'Question has not finalized!');
		//convertes yes,no or invalid share to 1 eth each, depending on market outcome
	}
	*/

	////////////////////////////////////////
	// FORKING (migrate vault (oi+rep), truth auction)
	////////////////////////////////////////
	function triggerFork() public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(systemState == SystemState.Operational, 'System needs to be operational to trigger fork');
		require(securityPoolForkTriggeredTimestamp == 0, 'fork already triggered');
		systemState = SystemState.OnGoingAFork;
		securityPoolForkTriggeredTimestamp = block.timestamp;
		repAtFork = repToken.balanceOf(address(this));
		zoltar.splitRep(universeId); // converts origin rep to rep_true, rep_false and rep_invalid
		// we could pay the caller basefee*2 out of Open interest we have?
	}

	// migrates vault into outcome universe after fork
	function migrateVault(QuestionOutcome outcome) public {
		require(securityPoolForkTriggeredTimestamp > 0, 'fork needs to be triggered');
		require(securityPoolForkTriggeredTimestamp + MIGRATION_TIME <= block.timestamp, 'migration time passed');
		require(securityVaults[msg.sender].repDepositShare > 0, 'Vault has no rep to migrate');
		updateVaultFees(msg.sender);
		if (address(children[uint8(outcome)]) == address(0x0)) {
			// first vault migrater creates new pool and transfers all REP to it
			uint192  childUniverseId = universeId << 2 + uint192(outcome);
			// TODO here priceOracleManagerAndOperatorQueuer.lastPrice might be old, do we want to get upto date price for it?
			children[uint8(outcome)] = securityPoolFactory.deploySecurityPool(this, openOracle, zoltar, childUniverseId, questionId, securityMultiplier, currentPerSecondFee, priceOracleManagerAndOperatorQueuer.lastPrice(), ethAmountForCompleteSets);
			repToken.transfer(address(children[uint8(outcome)]), repToken.balanceOf(address(this)));
		}
		children[uint256(outcome)].migrateRepFromParent(msg.sender);

		// migrate open interest
		(bool sent, ) = payable(msg.sender).call{value: ethAmountForCompleteSets * securityVaults[msg.sender].repDepositShare / repAtFork }('');
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

	// starts an auction on children
	function startTruthAuction() public {
		require(securityPoolForkTriggeredTimestamp + MIGRATION_TIME > block.timestamp, 'migration time needs to pass first');
		require(truthAuctionStarted == 0, 'Auction already started');
		truthAuctionStarted = block.timestamp;
		if (address(this).balance >= parent.ethAmountForCompleteSets()) {
			// we have acquired all the ETH already, no need auction
			systemState = SystemState.Operational;
			auction.finalizeAuction();
		} else {
			uint256 ethToBuy = parent.ethAmountForCompleteSets() - address(this).balance;
			repToken.transfer(address(auction), repToken.balanceOf(address(this)));
			auction.startAuction(ethToBuy);
		}
	}

	function finalizeTruthAuction() public {
		require(truthAuctionStarted + AUCTION_TIME < block.timestamp, 'auction still ongoing');
		auction.finalizeAuction(); // this sends the rep+eth back to this contract
		systemState = SystemState.Operational;

		//TODO, if auction fails what do we do?

		/*
		this code is not needed, just FYI on what can happen after auction:
		uint256 ourRep = repToken.balanceOf(address(this))
		if (migratedRep > ourRep) {
			// we migrated more rep than we got back. This means this pools holders need to take a haircut, this is acounted with repricing pools reps
		} else {
			// we migrated less rep that we got back from auction, this means we can give extra REP to our pool holders, this is acounted with repricing pools reps
		}
		*/
	}

	// accounts the purchased REP from auction to the vault
	// we should also move a share of bad debt in the system to this vault
	function claimAuctionProceeds(address vault) public {
		require(claimedAuctionProceeds[vault] == false, 'Already Claimed');
		require(auction.isFinalized(), 'Auction needs to be finalized');
		claimedAuctionProceeds[vault] = true;
		uint256 amount = auction.purchasedRep(vault);
		uint256 repAmount = amount * repToken.balanceOf(address(this)) / migratedRep; // todo, this is wrong
		securityVaults[msg.sender].repDepositShare += repAmount;
	}
}

contract SecurityPoolFactory {
	// TODO, we probably want to deploy these using create2 so we can get the address nicer than with this mapping hack
	mapping(uint256 => SecurityPool) public securityPools;
	uint256 currentId;
	function deploySecurityPool(SecurityPool parent, IOpenOracle openOracle, Zoltar zoltar, uint192 universeId, uint56 questionId, uint256 securityMultiplier, uint256 startingPerSecondFee, uint256 startingRepEthPrice, uint256 ethAmountForCompleteSets) external returns (SecurityPool) {
		currentId++;
		securityPools[currentId] = new SecurityPool(this, openOracle, parent, zoltar, universeId, questionId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, ethAmountForCompleteSets);
		return securityPools[currentId];
	}
}
