// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { Auction } from './Auction.sol';
import { Zoltar } from '../Zoltar.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { PriceOracleManagerAndOperatorQueuer } from './PriceOracleManagerAndOperatorQueuer.sol';
import { ISecurityPool, SecurityVault, SystemState, QuestionOutcome, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is ISecurityPool {
	uint56 public immutable questionId;
	uint192 public immutable universeId;

	Zoltar public immutable zoltar;
	ISecurityPool immutable public parent;
	IShareToken public immutable shareToken;
	Auction public immutable truthAuction;
	ISecurityPoolFactory public immutable securityPoolFactory;
	ReputationToken public immutable repToken;
	PriceOracleManagerAndOperatorQueuer public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;

	uint256 public securityBondAllowance;
	uint256 public auctionedSecurityBondAllowance;
	// amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public completeSetCollateralAmount;
	uint256 public poolOwnershipDenominator;
	uint256 public repAtFork;
	uint256 public migratedRep;
	uint256 public securityMultiplier;
	uint256 public shareTokenSupply;

	uint256 public feesAccrued;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public currentRetentionRate;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => bool) public claimedAuctionProceeds;

	ISecurityPool[3] public children;

	uint256 public truthAuctionStarted;
	SystemState public systemState;

	event SecurityBondAllowanceChange(address vault, uint256 from, uint256 to);
	event PerformWithdrawRep(address vault, uint256 amount);
	event PoolRetentionRateChanged(uint256 retentionRate);
	event ForkSecurityPool(uint256 repAtFork);
	event MigrateVault(address vault, QuestionOutcome outcome, uint256 poolOwnership, uint256 securityBondAllowance);
	event TruthAuctionStarted(uint256 completeSetCollateralAmount, uint256 repMigrated, uint256 repAtFork);
	event TruthAuctionFinalized();
	event ClaimAuctionProceeds(address vault, uint256 amount, uint256 poolOwnershipAmount, uint256 poolOwnershipDenominator);
	event MigrateRepFromParent(address vault, uint256 parentSecurityBondAllowance, uint256 parentpoolOwnership);
	event DepositRep(address vault, uint256 repAmount, uint256 poolOwnership);
	event RedeemShares(address redeemer, uint256 sharesAmount, uint256 ethValue);
	event FinalizeAuction(uint256 repAvailable, uint256 migratedRep, uint256 repPurchased, uint256 poolOwnershipDenominator);

	modifier isOperational {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime == 0, 'Zoltar has forked');
		require(systemState == SystemState.Operational, 'System is not operational');
		_;
	}

	constructor(ISecurityPoolFactory _securityPoolFactory, Auction _truthAuction, PriceOracleManagerAndOperatorQueuer _priceOracleManagerAndOperatorQueuer, IShareToken _shareToken, OpenOracle _openOracle, ISecurityPool _parent, Zoltar _zoltar, uint192 _universeId, uint56 _questionId, uint256 _securityMultiplier) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		truthAuction = _truthAuction;
		priceOracleManagerAndOperatorQueuer = _priceOracleManagerAndOperatorQueuer;
		if (address(parent) == address(0x0)) {
			// origin universe never does truthAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
		}
		shareToken = _shareToken;
		(repToken, , ) = zoltar.universes(universeId);
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _repEthPrice, uint256 _completeSetCollateralAmount) public {
		require(msg.sender == address(securityPoolFactory), 'only callable by securityPoolFactory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
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
		// if system state is not operational do not change fees
		if (systemState != SystemState.Operational) return;
		currentRetentionRate = SecurityPoolUtils.calculateRetentionRate(completeSetCollateralAmount, securityBondAllowance);
		emit PoolRetentionRateChanged(currentRetentionRate);
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
		uint256 ownershipToWithdraw = repToPoolOwnership(repAmount);
		uint256 withdrawOwnership = ownershipToWithdraw + repToPoolOwnership(SecurityPoolUtils.MIN_REP_DEPOSIT) > securityVaults[vault].poolOwnership ? securityVaults[vault].poolOwnership : ownershipToWithdraw;
		uint256 withdrawRepAmount = poolOwnershipToRep(withdrawOwnership);

		uint256 oldRep = poolOwnershipToRep(securityVaults[vault].poolOwnership);
		require((oldRep - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Local Security Bond Allowance broken');
		require((repToken.balanceOf(address(this)) - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Global Security Bond Allowance broken');

		securityVaults[vault].poolOwnership -= withdrawOwnership;
		poolOwnershipDenominator -= withdrawOwnership;
		repToken.transfer(vault, withdrawRepAmount);
		emit PerformWithdrawRep(vault, withdrawRepAmount);
	}

	function repToPoolOwnership(uint256 repAmount) public view returns (uint256) {
		if (poolOwnershipDenominator == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * poolOwnershipDenominator / repToken.balanceOf(address(this));
	}

	function poolOwnershipToRep(uint256 poolOwnership) public view returns (uint256) {
		return poolOwnership * repToken.balanceOf(address(this)) / poolOwnershipDenominator;
	}

	function sharesToCash(uint256 completeSetAmount) public view returns (uint256) {
		return completeSetAmount * completeSetCollateralAmount / shareTokenSupply;
	}

	function cashToShares(uint256 eth) public view returns (uint256) {
		return completeSetCollateralAmount == 0 ? (eth * SecurityPoolUtils.PRICE_PRECISION) : (eth * shareTokenSupply / completeSetCollateralAmount);
	}

	// todo, an owner can save their vault from liquidation if they deposit REP after the liquidation price query is triggered, we probably want to lock the vault from deposits if this has been triggered?
	function depositRep(uint256 repAmount) public isOperational {
		uint256 poolOwnership = repToPoolOwnership(repAmount);
		repToken.transferFrom(msg.sender, address(this), repAmount);
		securityVaults[msg.sender].poolOwnership += poolOwnership;
		poolOwnershipDenominator += poolOwnership;
		require(poolOwnershipToRep(securityVaults[msg.sender].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT, 'min deposit requirement');
		emit DepositRep(msg.sender, repAmount, securityVaults[msg.sender].poolOwnership);
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
		uint256 vaultsRepDeposit = securityVaults[targetVaultAddress].poolOwnership * repToken.balanceOf(address(this)) / poolOwnershipDenominator;
		require(vaultsSecurityBondAllowance * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() > vaultsRepDeposit * PRICE_PRECISION, 'vault need to be liquidable');

		uint256 debtToMove = debtAmount > securityVaults[callerVault].securityBondAllowance ? securityVaults[callerVault].securityBondAllowance : debtAmount;
		require(debtToMove > 0, 'no debt to move');
		uint256 repToMove = securityVaults[callerVault].poolOwnership * repToken.balanceOf(address(this)) / poolOwnershipDenominator * debtToMove / securityVaults[callerVault].securityBondAllowance;
		require((securityVaults[callerVault].securityBondAllowance+debtToMove) * securityMultiplier * priceOracleManagerAndOperatorQueuer.lastPrice() <= (securityVaults[callerVault].poolOwnership + repToMove) * PRICE_PRECISION, 'New pool would be liquidable!');
		securityVaults[targetVaultAddress].securityBondAllowance -= debtToMove;
		securityVaults[targetVaultAddress].poolOwnership -= repToMove * poolOwnershipDenominator / repToken.balanceOf(address(this));

		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += repToMove * poolOwnershipDenominator / repToken.balanceOf(address(this));

		require(securityVaults[targetVaultAddress].poolOwnership > MIN_REP_DEPOSIT * repToken.balanceOf(address(this)) / poolOwnershipDenominator || securityVaults[targetVaultAddress].poolOwnership == 0, 'min deposit requirement');
		require(securityVaults[targetVaultAddress].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[targetVaultAddress].securityBondAllowance == 0, 'min deposit requirement');
		require(securityVaults[callerVault].securityBondAllowance > MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
	*/}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) public isOperational {
		updateVaultFees(callerVault);
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'only priceOracleManagerAndOperatorQueuer can call');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'no valid price');

		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		securityBondAllowance += amount;
		securityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance = amount;

		require(poolOwnershipToRep(securityVaults[callerVault].poolOwnership) * SecurityPoolUtils.PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(repToken.balanceOf(address(this)) * SecurityPoolUtils.PRICE_PRECISION > securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(securityBondAllowance >= completeSetCollateralAmount, 'minted too many complete sets to allow this');
		require(securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
		emit SecurityBondAllowanceChange(callerVault, oldAllowance, amount);
		updateRetentionRate();
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() payable public isOperational {
		require(msg.value > 0, 'need to send eth');
		// todo, we want to be able to create complete sets in the children right away, figure accounting out
		require(systemState == SystemState.Operational, 'system is not Operational');
		updateCollateralAmount();
		require(securityBondAllowance >= msg.value + completeSetCollateralAmount, 'no capacity to create that many sets');
		uint256 completeSetsToMint = cashToShares(msg.value);
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMint);
		shareTokenSupply += completeSetsToMint;
		completeSetCollateralAmount += msg.value;
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 completeSetAmount) public isOperational {
		// todo, we want to allow people to exit, but for accounting purposes that is difficult but maybe there's a way?
		require(systemState == SystemState.Operational, 'system is not Operational');
		updateCollateralAmount();
		// takes in complete set and releases security bond and eth
		uint256 ethValue = sharesToCash(completeSetAmount);
		shareToken.burnCompleteSets(universeId, msg.sender, completeSetAmount);
		shareTokenSupply -= completeSetAmount;
		completeSetCollateralAmount -= ethValue;
		updateRetentionRate();
		(bool sent, ) = payable(msg.sender).call{ value: ethValue }('');
		require(sent, 'Failed to send Ether');
	}

	function redeemShares() isOperational external {
		Zoltar.Outcome outcome = zoltar.finalizeQuestion(universeId, questionId);
		require(outcome != Zoltar.Outcome.None, 'Question has not finalized!');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		uint256 amount = shareToken.burnTokenId(tokenId, msg.sender);
		uint256 ethValue = sharesToCash(amount);
		(bool sent, ) = payable(msg.sender).call{ value: ethValue }('');
		require(sent, 'Failed to send Ether');
		emit RedeemShares(msg.sender, amount, ethValue);
	}

	////////////////////////////////////////
	// FORKING (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////
	function forkSecurityPool() public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(forkTime > 0, 'Zoltar needs to have forked before Security Pool can do so');
		require(systemState == SystemState.Operational, 'System needs to be operational to trigger fork');
		require(!zoltar.isFinalized(universeId, questionId), 'question has been finalized already');
		systemState = SystemState.PoolForked;
		updateCollateralAmount();
		currentRetentionRate = 0;
		repAtFork = repToken.balanceOf(address(this));
		// TODO, handle case where parent repAtFork == 0
		emit ForkSecurityPool(repAtFork);
		repToken.approve(address(zoltar), repAtFork);
		zoltar.splitRep(universeId);
		// we could pay the caller basefee*2 out of Open interest we have?
	}

	function createChildUniverse(QuestionOutcome outcome) public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(systemState == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= forkTime + SecurityPoolUtils.MIGRATION_TIME, 'migration time passed');
		_createChildUniverse(outcome);
	}

	function _createChildUniverse(QuestionOutcome outcome) public {
		// first vault migrater creates new pool and transfers all REP to it
		uint192 childUniverseId = (universeId << 2) + uint192(outcome) + 1;
		uint256 retentionRate = SecurityPoolUtils.calculateRetentionRate(completeSetCollateralAmount, securityBondAllowance);
		children[uint8(outcome)] = securityPoolFactory.deployChildSecurityPool(shareToken, childUniverseId, questionId, securityMultiplier, retentionRate, priceOracleManagerAndOperatorQueuer.lastPrice(), 0);
		shareToken.authorize(children[uint8(outcome)]);
		ReputationToken childReputationToken = children[uint8(outcome)].repToken();
		childReputationToken.transfer(address(children[uint8(outcome)]), childReputationToken.balanceOf(address(this)));
	}

	// migrates vault into outcome universe after fork
	// called on parent
	function migrateVault(QuestionOutcome outcome) public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(systemState == SystemState.PoolForked, 'Pool needs to have forked');
		require(block.timestamp <= forkTime + SecurityPoolUtils.MIGRATION_TIME , 'migration time passed');
		require(securityVaults[msg.sender].poolOwnership > 0, 'Vault has no rep to migrate');
		updateVaultFees(msg.sender);
		emit MigrateVault(msg.sender, outcome, securityVaults[msg.sender].poolOwnership, securityVaults[msg.sender].securityBondAllowance);
		if (address(children[uint8(outcome)]) == address(0x0)) {
			_createChildUniverse(outcome);
		}
		children[uint256(outcome)].migrateRepFromParent(msg.sender);

		// migrate open interest
		(bool sent, ) = payable(children[uint256(outcome)]).call{ value: completeSetCollateralAmount * securityVaults[msg.sender].poolOwnership / poolOwnershipDenominator }('');
		require(sent, 'Failed to send Ether');

		securityVaults[msg.sender].poolOwnership = 0;
		securityVaults[msg.sender].securityBondAllowance = 0;
	}

	// called on children
	function migrateRepFromParent(address vault) public {
		require(msg.sender == address(parent), 'only parent can migrate');
		updateVaultFees(vault);
		parent.updateCollateralAmount();
		(uint256 parentPoolOwnership, uint256 parentSecurityBondAllowance, , ) = parent.securityVaults(vault);
		emit MigrateRepFromParent(vault, parentSecurityBondAllowance, parentPoolOwnership);
		securityVaults[vault].securityBondAllowance = parentSecurityBondAllowance;
		securityBondAllowance += parentSecurityBondAllowance;
		poolOwnershipDenominator = parent.repAtFork() * SecurityPoolUtils.PRICE_PRECISION;
		securityVaults[vault].poolOwnership = repToPoolOwnership(parentPoolOwnership * parent.repAtFork() / parent.poolOwnershipDenominator());
		migratedRep += poolOwnershipToRep(securityVaults[vault].poolOwnership);

		// migrate completeset collateral amount incrementally as we want this portion to start paying fees right away, but stop paying fees in the parent system
		// TODO, handle case where parent repAtFork == 0
		require(parent.repAtFork() > 0, 'parent needs to have rep at fork');
		//completeSetCollateralAmount += parent.completeSetCollateralAmount() * securityVaults[vault].poolOwnership / (SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR * parent.repAtFork());
		securityVaults[vault].feeAccumulator = feesAccrued;
	}

	function startTruthAuction() public {
		(,, uint256 forkTime) = zoltar.universes(universeId);
		require(systemState == SystemState.ForkMigration, 'System needs to be in migration');
		require(block.timestamp > forkTime + SecurityPoolUtils.MIGRATION_TIME, 'migration time needs to pass first');
		systemState = SystemState.ForkTruthAuction;
		truthAuctionStarted = block.timestamp;
		parent.updateCollateralAmount();
		uint256 parentCollateral = parent.completeSetCollateralAmount();
		shareTokenSupply = parent.shareTokenSupply();
		emit TruthAuctionStarted(parentCollateral, migratedRep, parent.repAtFork());
		if (migratedRep >= parent.repAtFork()) {
			// we have acquired all the ETH already, no need for truthAuction
			_finalizeTruthAuction(0);
		} else {
			// we need to buy all the collateral that is missing (did not migrate)
			uint256 ethToBuy = parentCollateral - parentCollateral * migratedRep / parent.repAtFork();
			// sell all but very small amount of REP for ETH. We cannot sell all for accounting purposes, as `poolOwnershipDenominator` cannot be infinite
			// only migratedRep gets this guarrantee that some of their rep never gets sold
			truthAuction.startAuction(ethToBuy, parent.repAtFork() - migratedRep / SecurityPoolUtils.MAX_AUCTION_VAULT_HAIRCUT_DIVISOR);
		}
	}

	function _finalizeTruthAuction(uint256 repPurchased) private {
		require(systemState == SystemState.ForkTruthAuction, 'Auction need to have started');
		truthAuction.finalizeAuction(); // this sends the eth back
		systemState = SystemState.Operational;
		uint256 repAvailable = parent.repAtFork();
		completeSetCollateralAmount = address(this).balance - feesAccrued; //todo, we might want to reduce fees if we didn't get fully funded?
		// TODO, handle case where parent repAtFork == 0
		require(repAvailable > 0, 'parent needs to have rep at fork');
		poolOwnershipDenominator = migratedRep * repAvailable * SecurityPoolUtils.PRICE_PRECISION / (repAvailable - repPurchased);
		auctionedSecurityBondAllowance = parent.securityBondAllowance() - securityBondAllowance;
		securityBondAllowance = parent.securityBondAllowance();
		if (poolOwnershipDenominator == 0) poolOwnershipDenominator = repAvailable * SecurityPoolUtils.PRICE_PRECISION;
		emit FinalizeAuction(repAvailable, migratedRep, repPurchased, poolOwnershipDenominator);
		updateRetentionRate();
	}

	function finalizeTruthAuction() public {
		require(block.timestamp > truthAuctionStarted + SecurityPoolUtils.AUCTION_TIME, 'truthAuction still ongoing');
		_finalizeTruthAuction(truthAuction.totalRepPurchased());
	}

	receive() external payable {
		// needed for Truth Auction to send ETH back
	}

	// accounts the purchased REP from truthAuction to the vault
	// we should also move a share of bad debt in the system to this vault
	// anyone can call these so that we can liquidate them if needed
	function claimAuctionProceeds(address vault) public {
		require(claimedAuctionProceeds[vault] == false, 'Already Claimed');
		require(truthAuction.finalized(), 'Auction needs to be finalized');
		claimedAuctionProceeds[vault] = true;
		uint256 amount = truthAuction.purchasedRep(vault);
		// not really necessary, but good for testing
		require(amount > 0, 'Did not purchase anything');
		uint256 poolOwnershipAmount = repToPoolOwnership(amount);
		// no need to add to poolOwnershipDenominator as its already accounted
		securityVaults[vault].poolOwnership += poolOwnershipAmount;
		emit ClaimAuctionProceeds(vault, amount, poolOwnershipAmount, poolOwnershipDenominator);
		securityVaults[vault].securityBondAllowance = auctionedSecurityBondAllowance * amount / truthAuction.totalRepPurchased();
	}

	// todo, missing feature to get rep back after market finalization
	// todo, missing redeeming yes/no/invalid poolOwnership to eth after finalization
	// todo, fee calculation doesn't work yet
	// todo, liquidation system missing
}
