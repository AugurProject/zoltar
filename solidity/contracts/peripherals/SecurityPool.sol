// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

import { Auction } from './Auction.sol';
import { Zoltar } from '../Zoltar.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { CompleteSet } from './CompleteSet.sol';
import { PriceOracleManagerAndOperatorQueuer } from './PriceOracleManagerAndOperatorQueuer.sol';
import { ISecurityPool, SecurityVault, SystemState, QuestionOutcome } from './interfaces/ISecurityPool.sol';
import { ISecurityPoolFactory } from './interfaces/ISecurityPoolFactory.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is ISecurityPool {
	uint56 public questionId;
	uint192 public universeId;

	Zoltar public zoltar;
	uint256 public securityBondAllowance;
	uint256 public completeSetCollateralAmount; // amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public repDenominator;
	uint256 public repAtFork;
	uint256 public migratedRep;
	uint256 public securityMultiplier;

	uint256 public feesAccrued;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public currentRetentionRate;

	uint256 public securityPoolForkTriggeredTimestamp;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => bool) public claimedAuctionProceeds;

	ISecurityPool[3] public children;
	ISecurityPool public parent;

	uint256 public truthAuctionStarted;
	SystemState public systemState;

	CompleteSet public completeSet;
	Auction public truthAuction;
	ReputationToken public repToken;
	ISecurityPoolFactory public securityPoolFactory;

	PriceOracleManagerAndOperatorQueuer public priceOracleManagerAndOperatorQueuer;
	OpenOracle public openOracle;

	event SecurityBondAllowanceChange(address vault, uint256 from, uint256 to);
	event PerformWithdrawRep(address vault, uint256 amount);
	event PoolRetentionRateChanged(uint256 feesAccrued, uint256 utilization, uint256 retentionRate);
	event ForkSecurityPool(uint256 repAtFork);
	event MigrateVault(address vault, QuestionOutcome outcome, uint256 repDepositShare, uint256 securityBondAllowance);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 repShareAmount);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentRepDepositShare);
	event DepositRep(address vault, uint256 repAmount, uint256 repDepositShare);

	modifier isOperational {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime == 0, 'Zoltar has forked');
		require(systemState == SystemState.Operational, 'System is not operational');
		_;
	}

	constructor(ISecurityPoolFactory _securityPoolFactory, OpenOracle _openOracle, ISecurityPool _parent, Zoltar _zoltar, uint192 _universeId, uint56 _questionId, uint256 _securityMultiplier) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		if (address(parent) == address(0x0)) { // origin universe never does truthAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
			truthAuction = new Auction{ salt: bytes32(uint256(0x1)) }(address(this));
		}
		// todo, we can probably do these smarter so that we don't need migration
		completeSet = new CompleteSet{ salt: bytes32(uint256(0x1)) }(address(this));
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _repEthPrice, uint256 _completeSetCollateralAmount) public {
		require(msg.sender == address(securityPoolFactory), 'only callable by securityPoolFactory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		(repToken,,) = zoltar.universes(universeId);
		priceOracleManagerAndOperatorQueuer = new PriceOracleManagerAndOperatorQueuer{ salt: bytes32(uint256(0x1)) }(openOracle, this, repToken);
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(_repEthPrice);
	}

	function updateCollateralAmount() public {
		(uint64 endTime,,,) = zoltar.questions(questionId);
		uint256 clampedCurrentTimestamp = block.timestamp > endTime ? endTime : block.timestamp;
		uint256 clampedLastUpdatedFeeAccumulator = lastUpdatedFeeAccumulator > endTime ? endTime : lastUpdatedFeeAccumulator;
		uint256 timeDelta = clampedCurrentTimestamp - clampedLastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;

		uint256 newCompleteSetCollateralAmount = completeSetCollateralAmount * SecurityPoolUtils.rpow(currentRetentionRate, timeDelta, SecurityPoolUtils.PRICE_PRECISION) / SecurityPoolUtils.PRICE_PRECISION;
		feesAccrued += completeSetCollateralAmount - newCompleteSetCollateralAmount;
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
		lastUpdatedFeeAccumulator = block.timestamp;
	}

	function updateRetentionRate() public {
		if (securityBondAllowance == 0) return;
		if (systemState != SystemState.Operational) return; // if system state is not operational do not change fees
		uint256 utilization = (completeSetCollateralAmount * 100) / securityBondAllowance;
		if (utilization <= SecurityPoolUtils.RETENTION_RATE_DIP) {
			// first slope: 0% -> RETENTION_RATE_DIP%
			uint256 utilizationRatio = (utilization * SecurityPoolUtils.PRICE_PRECISION) / SecurityPoolUtils.RETENTION_RATE_DIP;
			uint256 slopeSpan = SecurityPoolUtils.MAX_RETENTION_RATE - SecurityPoolUtils.MIN_RETENTION_RATE;
			currentRetentionRate = SecurityPoolUtils.MAX_RETENTION_RATE - (slopeSpan * utilizationRatio) / SecurityPoolUtils.PRICE_PRECISION;
		} else if (utilization <= 100) {
			// second slope: RETENTION_RATE_DIP% -> 100%
			uint256 slopeSpan = SecurityPoolUtils.MAX_RETENTION_RATE - SecurityPoolUtils.MIN_RETENTION_RATE;
			currentRetentionRate = SecurityPoolUtils.MIN_RETENTION_RATE + (slopeSpan * (100 - utilization) * SecurityPoolUtils.PRICE_PRECISION / (100 - SecurityPoolUtils.RETENTION_RATE_DIP)) / SecurityPoolUtils.PRICE_PRECISION;
		} else {
			// clamp to MIN_RETENTION_RATE if utilization > 100%
			currentRetentionRate = SecurityPoolUtils.MIN_RETENTION_RATE;
		}
		emit PoolRetentionRateChanged(feesAccrued, utilization, currentRetentionRate);
	}

	// I wonder if we want to delay the payments and smooth them out to avoid flashloan attacks?
	function updateVaultFees(address vault) public {
		updateCollateralAmount();
		require(feesAccrued >= securityVaults[vault].feeAccumulator, 'fee accumulator too high? should not happen');
		uint256 accumulatorDiff = feesAccrued - securityVaults[vault].feeAccumulator;
		uint256 fees = (securityVaults[vault].securityBondAllowance * accumulatorDiff) / SecurityPoolUtils.PRICE_PRECISION;
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

	function performWithdrawRep(address vault, uint256 repAmount) public isOperational {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		uint256 newShares = securityVaults[vault].repDepositShare + repToRepShares(repAmount);
		uint256 oldRep = repSharesToRep(securityVaults[vault].repDepositShare);
		require((oldRep - repAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Local Security Bond Alowance broken');
		require((repToken.balanceOf(address(this)) - repAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Global Security Bond Alowance broken');

		securityVaults[vault].repDepositShare = newShares;
		repToken.transfer(vault, repAmount);
		repDenominator -= repAmount;
		require(repSharesToRep(securityVaults[vault].repDepositShare) >= SecurityPoolUtils.MIN_REP_DEPOSIT || securityVaults[vault].repDepositShare == 0, 'min deposit requirement');
		emit PerformWithdrawRep(vault, repAmount);
	}

	function repSharesToRep(uint256 repShares) public view returns (uint256) {
		if (repDenominator == 0) return repShares;
		return repShares * repToken.balanceOf(address(this)) / repDenominator;
	}

	function repToRepShares(uint256 repAmount) public view returns (uint256) {
		if (repDenominator == 0) return repAmount;
		return repAmount * repDenominator / repToken.balanceOf(address(this));
	}

	// todo, an owner can save their vault from liquidation if they deposit REP after the liquidation price query is triggered, we probably want to lock the vault from deposits if this has been triggered?
	function depositRep(uint256 repAmount) public isOperational {
		repDenominator += repAmount;
		repToken.transferFrom(msg.sender, address(this), repAmount);
		securityVaults[msg.sender].repDepositShare += repToRepShares(repAmount);
		require(repSharesToRep(securityVaults[msg.sender].repDepositShare) >= SecurityPoolUtils.MIN_REP_DEPOSIT, 'min deposit requirement');
		emit DepositRep(msg.sender, repAmount, securityVaults[msg.sender].repDepositShare);
	}

	////////////////////////////////////////
	// liquidating vault
	////////////////////////////////////////

	//price = (amount1 * PRICE_PRECISION) / amount2;
	// price = REP * PRICE_PRECISION / ETH
	// liquidation moves share of debt and rep to another pool which need to remain non-liquidable
	// this is currently very harsh, as we steal all the rep and debt from the pool
	function performLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount) public isOperational {
	/*	require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');
		updateVaultFees(targetVaultAddress);
		updateVaultFees(callerVault);
		uint256 vaultsSecurityBondAllowance = securityVaults[targetVaultAddress].securityBondAllowance;
		uint256 vaultsRepDeposit = securityVaults[targetVaultAddress].repDepositShare * repToken.balanceOf(address(this)) / repDenominator;
		require(vaultsSecurityBondAllowance * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() > vaultsRepDeposit * PRICE_PRECISION, 'vault need to be liquidable');

		uint256 debtToMove = debtAmount > securityVaults[callerVault].securityBondAllowance ? securityVaults[callerVault].securityBondAllowance : debtAmount;
		require(debtToMove > 0, 'no debt to move');
		uint256 repToMove = securityVaults[callerVault].repDepositShare * repToken.balanceOf(address(this)) / repDenominator * debtToMove / securityVaults[callerVault].securityBondAllowance;
		require((securityVaults[callerVault].securityBondAllowance+debtToMove) * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() <= (securityVaults[callerVault].repDepositShare + repToMove) * PRICE_PRECISION, 'New pool would be liquidable!');
		securityVaults[targetVaultAddress].securityBondAllowance -= debtToMove;
		securityVaults[targetVaultAddress].repDepositShare -= repToMove * repDenominator / repToken.balanceOf(address(this));

		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].repDepositShare += repToMove * repDenominator / repToken.balanceOf(address(this));

		require(securityVaults[targetVaultAddress].repDepositShare > MIN_REP_DEPOSIT * repToken.balanceOf(address(this)) / repDenominator || securityVaults[targetVaultAddress].repDepositShare == 0, 'min deposit requirement');
		require(securityVaults[targetVaultAddress].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[targetVaultAddress].securityBondAllowance == 0, 'min deposit requirement');
		require(securityVaults[callerVault].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
	*/}

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
		require(systemState == SystemState.Operational, 'system is not Operational'); //todo, we want to be able to create complete sets in the children right away, figure accounting out
		updateCollateralAmount();
		require(securityBondAllowance - completeSetCollateralAmount >= msg.value, 'no capacity to create that many sets');
		uint256 amountToMint = completeSet.totalSupply() == completeSetCollateralAmount ? msg.value : msg.value * completeSet.totalSupply() / completeSetCollateralAmount;
		completeSet.mint(msg.sender, amountToMint);
		completeSetCollateralAmount += msg.value;
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 amount) public isOperational {
		require(systemState == SystemState.Operational, 'system is not Operational'); // todo, we want to allow people to exit, but for accounting purposes that is difficult but maybe there's a way?
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
		require(!zoltar.isFinalized(universeId, questionId), 'question has been finalized already');
		systemState = SystemState.PoolForked;
		securityPoolForkTriggeredTimestamp = block.timestamp;
		repAtFork = repToken.balanceOf(address(this));
		// TODO, handle case where parent repAtFork == 0
		emit ForkSecurityPool(repAtFork);
		repToken.approve(address(zoltar), repAtFork);
		zoltar.splitRep(universeId);
		// we could pay the caller basefee*2 out of Open interest we have?
	}

	// migrates vault into outcome universe after fork
	function migrateVault(QuestionOutcome outcome) public { // called on parent
		require(systemState == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= securityPoolForkTriggeredTimestamp + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
		require(securityVaults[msg.sender].repDepositShare > 0, 'Vault has no rep to migrate');
		updateVaultFees(msg.sender);
		emit MigrateVault(msg.sender, outcome, securityVaults[msg.sender].repDepositShare, securityVaults[msg.sender].securityBondAllowance);
		if (address(children[uint8(outcome)]) == address(0x0)) {
			// first vault migrater creates new pool and transfers all REP to it
			uint192 childUniverseId = (universeId << 2) + uint192(outcome) + 1;
			children[uint8(outcome)] = securityPoolFactory.deploySecurityPool(openOracle, this, zoltar, childUniverseId, questionId, securityMultiplier, currentRetentionRate, priceOracleManagerAndOperatorQueuer.lastPrice(), 0);
			ReputationToken childReputationToken = children[uint8(outcome)].repToken();
			childReputationToken.transfer(address(children[uint8(outcome)]), childReputationToken.balanceOf(address(this)));
		}
		children[uint256(outcome)].migrateRepFromParent(msg.sender);

		// migrate open interest
		if (repAtFork > 0) {
			(bool sent, ) = payable(msg.sender).call{value: completeSetCollateralAmount * securityVaults[msg.sender].repDepositShare / repAtFork }('');
			require(sent, 'Failed to send Ether');
		}
		securityVaults[msg.sender].repDepositShare = 0;
		securityVaults[msg.sender].securityBondAllowance = 0;
	}

	function migrateRepFromParent(address vault) public { // called on children
		require(msg.sender == address(parent), 'only parent can migrate');
		updateVaultFees(vault);
		parent.updateCollateralAmount();
		(uint256 parentRepDepositShare, uint256 parentSecurityBondAllowance, , ) = parent.securityVaults(vault);
		emit MigrateRepFromParent(vault, parentSecurityBondAllowance, parentRepDepositShare);
		securityVaults[vault].securityBondAllowance = parentSecurityBondAllowance;
		securityBondAllowance += parentSecurityBondAllowance;

		securityVaults[vault].repDepositShare = parentRepDepositShare * repToken.balanceOf(address(this)) / parent.repDenominator();
		migratedRep += securityVaults[vault].repDepositShare;

		// migrate completeset collateral amount incrementally as we want this portion to start paying fees right away, but stop paying fees in the parent system
		// TODO, handle case where parent repAtFork == 0
		require(parent.repAtFork() > 0, 'parent needs to have rep at fork');
		completeSetCollateralAmount += parent.completeSetCollateralAmount() * parentRepDepositShare / parent.repAtFork();
		securityVaults[vault].feeAccumulator = feesAccrued;
	}

	// starts an truthAuction on children
	function startTruthAuction() public {
		require(systemState == SystemState.ForkMigration, 'System needs to be in migration');
		require(block.timestamp > securityPoolForkTriggeredTimestamp + SecurityPoolUtils.MIGRATION_TIME, 'migration time needs to pass first');
		require(truthAuctionStarted == 0, 'Auction already started');
		systemState = SystemState.ForkTruthAuction;
		truthAuctionStarted = block.timestamp;
		parent.updateCollateralAmount();
		uint256 parentCollateral = parent.completeSetCollateralAmount();
		completeSetCollateralAmount = parentCollateral; // update to the real one, and not only to migrated amount
		emit TruthAuctionStarted(completeSetCollateralAmount, migratedRep, parent.repAtFork());
		if (migratedRep >= parent.repAtFork()) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction();
		} else {
			// we need to buy all the collateral that is missing (did not migrate)
			uint256 ethToBuy = parentCollateral - parentCollateral * migratedRep / parent.repAtFork();
			truthAuction.startAuction(ethToBuy, parent.repAtFork()); // sell possibly all REP we have to recover open interest
		}
	}

	function _finalizeTruthAuction() private {
		require(systemState == SystemState.ForkTruthAuction, 'Auction need to have started');
		emit TruthAuctionFinalized();
		truthAuction.finalizeAuction(); // this sends the eth back
		systemState = SystemState.Operational;
		repDenominator = repToken.balanceOf(address(this)) * truthAuction.totalRepPurchased() / truthAuction.repAvailable();
		updateRetentionRate();
	}

	function finalizeTruthAuction() public {
		require(block.timestamp > truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'truthAuction still ongoing');
		_finalizeTruthAuction();
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
		uint256 repShareAmount = repToRepShares(amount);
		securityVaults[vault].repDepositShare += repShareAmount;
		emit ClaimAuctionProceeds(vault, amount, repShareAmount);
		//todo, we should give the auction buyers the securitbond debt of attackers?
	}

	// todo, missing feature to get rep back after market finalization
	// todo, missing redeeming yes/no/invalid shares to eth after finalization
}
