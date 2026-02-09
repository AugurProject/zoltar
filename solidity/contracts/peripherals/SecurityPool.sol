// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import { Auction } from './Auction.sol';
import { Zoltar, FORK_TRESHOLD_DIVISOR } from '../Zoltar.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { PriceOracleManagerAndOperatorQueuer, QueuedOperation } from './PriceOracleManagerAndOperatorQueuer.sol';
import { ISecurityPool, SecurityVault, SystemState, QuestionOutcome, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { EscalationGame } from './EscalationGame.sol';
import { YesNoMarkets } from './YesNoMarkets.sol';
import { SecurityPoolForker } from './SecurityPoolForker.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';

uint256 constant TODO_INITIAL_ESCALATION_GAME_DEPOSIT = 1 ether; // todo, how to get this value?

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is ISecurityPool {
	uint256 public immutable marketId;
	uint248 public immutable universeId;

	Zoltar public immutable zoltar;
	ISecurityPool immutable public parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	PriceOracleManagerAndOperatorQueuer public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	EscalationGame public escalationGame;
	YesNoMarkets public yesNoMarkets;
	ISecurityPoolForker public securityPoolForker;
	ISecurityPoolFactory public securityPoolFactory;

	uint256 public totalSecurityBondAllowance;
	uint256 public completeSetCollateralAmount; // amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public poolOwnershipDenominator;
	uint256 public securityMultiplier;
	uint256 public shareTokenSupply;

	uint256 public totalFeesOvedToVaults;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 public currentRetentionRate;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => bool) public claimedAuctionProceeds;

	uint256 public truthAuctionStarted;
	SystemState public systemState;

	event SecurityBondAllowanceChange(address vault, uint256 from, uint256 to);
	event PerformWithdrawRep(address vault, uint256 amount);
	event PoolRetentionRateChanged(uint256 retentionRate);
	event DepositRep(address vault, uint256 repAmount, uint256 poolOwnership);
	event RedeemShares(address redeemer, uint256 sharesAmount, uint256 ethValue);
	event UpdateVaultFees(address vault, uint256 feeIndex, uint256 unpaidEthFees);
	event RedeemFees(address vault, uint256 fees);
	event UpdateCollateralAmount(uint256 totalFeesOvedToVaults, uint256 completeSetCollateralAmount);
	event CreateCompleteSet(uint256 shareTokenSupply, uint256 completeSetsToMint, uint256 completeSetCollateralAmount);
	event PerformLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount, uint256 debtToMove, uint256 repToMove);
	event RedeemRep(address caller, address vault, uint256 repAmount);

	modifier isOperational {
		require(zoltar.getForkTime(universeId) == 0, 'Zoltar has forked');
		require(systemState == SystemState.Operational, 'System is not operational');
		_;
	}

	modifier onlyValidOracle {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'OnlyOracle');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'Stale price');
		_;
	}

	modifier onlyForker {
		require(msg.sender == address(securityPoolForker), 'Only Forker');
		_;
	}

	constructor(ISecurityPoolForker _securityPoolForker, ISecurityPoolFactory _securityPoolFactory, YesNoMarkets _yesNoMarkets, EscalationGameFactory _escalationGameFactory, PriceOracleManagerAndOperatorQueuer _priceOracleManagerAndOperatorQueuer, IShareToken _shareToken, OpenOracle _openOracle, ISecurityPool _parent, Zoltar _zoltar, uint248 _universeId, uint256 _marketId, uint256 _securityMultiplier) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		marketId = _marketId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		priceOracleManagerAndOperatorQueuer = _priceOracleManagerAndOperatorQueuer;
		securityPoolForker = _securityPoolForker;
		yesNoMarkets = _yesNoMarkets;
		if (address(parent) == address(0x0)) { // origin universe never does truthAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
		}
		shareToken = _shareToken;
		repToken = zoltar.getRepToken(universeId);
		repToken.approve(address(zoltar), type(uint256).max);
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _repEthPrice, uint256 _completeSetCollateralAmount) public {
		require(msg.sender == address(securityPoolFactory), 'only callable by securityPoolFactory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(_repEthPrice);
	}

	function updateCollateralAmount() public {
		if (totalSecurityBondAllowance == 0) return;
		uint256 forkTime = zoltar.getForkTime(universeId);
		uint256 endTime = yesNoMarkets.getMarketEndDate(marketId);
		uint256 feeEndDate = forkTime == 0 ? endTime : forkTime;
		uint256 clampedCurrentTimestamp = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;

		uint256 newCompleteSetCollateralAmount = completeSetCollateralAmount * SecurityPoolUtils.rpow(currentRetentionRate, timeDelta, SecurityPoolUtils.PRICE_PRECISION) / SecurityPoolUtils.PRICE_PRECISION;
		uint256 delta = completeSetCollateralAmount - newCompleteSetCollateralAmount;
		totalFeesOvedToVaults += delta;
		feeIndex += delta * SecurityPoolUtils.PRICE_PRECISION / totalSecurityBondAllowance;
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
		lastUpdatedFeeAccumulator = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;

		emit UpdateCollateralAmount(totalFeesOvedToVaults, completeSetCollateralAmount);
	}

	function updateRetentionRate() public {
		if (totalSecurityBondAllowance == 0) return;
		if (systemState != SystemState.Operational) return; // if system state is not operational do not change fees
		currentRetentionRate = SecurityPoolUtils.calculateRetentionRate(completeSetCollateralAmount, totalSecurityBondAllowance);
		emit PoolRetentionRateChanged(currentRetentionRate);
	}

	function updateVaultFees(address vault) public {
		updateCollateralAmount();
		uint256 fees = securityVaults[vault].securityBondAllowance * (feeIndex - securityVaults[vault].feeIndex) / SecurityPoolUtils.PRICE_PRECISION;
		securityVaults[vault].feeIndex = feeIndex;
		securityVaults[vault].unpaidEthFees += fees;
		emit UpdateVaultFees(vault, securityVaults[vault].feeIndex, securityVaults[vault].unpaidEthFees);
	}

	function redeemFees(address vault) public {
		uint256 fees = securityVaults[vault].unpaidEthFees;
		securityVaults[vault].unpaidEthFees = 0;
		totalFeesOvedToVaults -= fees;
		(bool sent, ) = payable(vault).call{ value: fees }('');
		require(sent, 'Failed to send Ether');
		emit RedeemFees(vault, fees);
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 repAmount) public isOperational onlyValidOracle {
		uint256 ownershipToWithdraw = repToPoolOwnership(repAmount);
		uint256 withdrawOwnership = ownershipToWithdraw + repToPoolOwnership(SecurityPoolUtils.MIN_REP_DEPOSIT) > securityVaults[vault].poolOwnership ? securityVaults[vault].poolOwnership : ownershipToWithdraw;
		uint256 withdrawRepAmount = poolOwnershipToRep(withdrawOwnership);

		uint256 oldRep = poolOwnershipToRep(securityVaults[vault].poolOwnership);
		require((oldRep - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Local Security Bond Allowance broken');
		require((repToken.balanceOf(address(this)) - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'Global Security Bond Allowance broken');

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

	function depositRep(uint256 repAmount) public isOperational {
		QueuedOperation memory queuedOperation = priceOracleManagerAndOperatorQueuer.getQueuedOperation();
		require(queuedOperation.amount == 0 || queuedOperation.targetVault != msg.sender, 'operation pending'); // prevents owner from saving their vault when liquidation is pending
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
	function performLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount) public isOperational onlyValidOracle {
		updateVaultFees(targetVaultAddress);
		updateVaultFees(callerVault);
		uint256 vaultsSecurityBondAllowance = securityVaults[targetVaultAddress].securityBondAllowance;
		uint256 vaultsRepDeposit = poolOwnershipToRep(securityVaults[targetVaultAddress].poolOwnership);
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		require(vaultsSecurityBondAllowance * securityMultiplier * repEthPrice > vaultsRepDeposit * SecurityPoolUtils.PRICE_PRECISION, 'vault need to be liquidable');

		uint256 debtToMove = debtAmount > securityVaults[targetVaultAddress].securityBondAllowance ? securityVaults[targetVaultAddress].securityBondAllowance : debtAmount;
		require(debtToMove > 0, 'no debt to move');
		uint256 repToMove = debtToMove * vaultsRepDeposit / securityVaults[targetVaultAddress].securityBondAllowance;
		uint256 ownershipToMove = repToPoolOwnership(repToMove);
		require((securityVaults[callerVault].securityBondAllowance + debtToMove) * securityMultiplier * repEthPrice <= poolOwnershipToRep(securityVaults[callerVault].poolOwnership + ownershipToMove) * SecurityPoolUtils.PRICE_PRECISION, 'New pool would be liquidable!');
		securityVaults[targetVaultAddress].securityBondAllowance -= debtToMove;
		securityVaults[targetVaultAddress].poolOwnership -= ownershipToMove;
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;

		// target vault needs to be above tresholds after liquidation
		require(poolOwnershipToRep(securityVaults[targetVaultAddress].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT || securityVaults[targetVaultAddress].poolOwnership == 0, 'target min deposit requirement');
		require(securityVaults[targetVaultAddress].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT || securityVaults[targetVaultAddress].securityBondAllowance == 0, 'target min deposit requirement');
		require(poolOwnershipToRep(securityVaults[callerVault].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT, 'caller min deposit requirement');
		require(securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT, 'caller min deposit requirement');

		emit PerformLiquidation(callerVault, targetVaultAddress, debtAmount, debtToMove, repToMove);
	}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) public isOperational onlyValidOracle {
		updateVaultFees(callerVault);

		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		totalSecurityBondAllowance += amount;
		totalSecurityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance = amount;

		require(poolOwnershipToRep(securityVaults[callerVault].poolOwnership) * SecurityPoolUtils.PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(repToken.balanceOf(address(this)) * SecurityPoolUtils.PRICE_PRECISION > totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(totalSecurityBondAllowance >= completeSetCollateralAmount, 'minted too many complete sets to allow this');
		require(securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min deposit requirement');
		emit SecurityBondAllowanceChange(callerVault, oldAllowance, amount);
		updateRetentionRate();
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() payable public isOperational { // todo, we want to be able to create complete sets in the children right away, figure accounting out
		require(msg.value > 0, 'need to send eth');
		updateCollateralAmount();
		require(totalSecurityBondAllowance >= msg.value + completeSetCollateralAmount, 'no capacity to create that many sets');
		uint256 completeSetsToMint = cashToShares(msg.value);
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMint);
		shareTokenSupply += completeSetsToMint;
		completeSetCollateralAmount += msg.value;
		emit CreateCompleteSet(shareTokenSupply, completeSetsToMint, completeSetCollateralAmount);
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 completeSetAmount) public isOperational { // todo, we want to allow people to exit, but for accounting purposes that is difficult but maybe there's a way?
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
		YesNoMarkets.Outcome outcome = escalationGame.getMarketResolution();
		require(outcome != YesNoMarkets.Outcome.None, 'Market has not finalized!');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		uint256 amount = shareToken.burnTokenId(tokenId, msg.sender);
		uint256 ethValue = sharesToCash(amount);
		(bool sent, ) = payable(msg.sender).call{ value: ethValue }('');
		require(sent, 'Failed to send Ether');
		emit RedeemShares(msg.sender, amount, ethValue);
	}

	function redeemRep(address vault) public {
		YesNoMarkets.Outcome outcome = escalationGame.getMarketResolution();
		require(outcome != YesNoMarkets.Outcome.None, 'Market has not finalized!');
		updateVaultFees(vault);
		uint256 repAmount = poolOwnershipToRep(securityVaults[vault].poolOwnership) - securityVaults[vault].lockedRepInEscalationGame;
		securityVaults[vault].poolOwnership = 0;
		repToken.transfer(vault, repAmount);
		emit RedeemRep(msg.sender, vault, repAmount);
	}

	////////////////////////////////////////
	// Escalation Game (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////

	function depositToEscalationGame(YesNoMarkets.Outcome outcome, uint256 amount) external isOperational {
		if (address(escalationGame) == address(0x0)) {
			uint256 endTime = yesNoMarkets.getMarketEndDate(marketId);
			require(block.timestamp > endTime, 'market has not ended');
			escalationGame = escalationGameFactory.deployEscalationGame(TODO_INITIAL_ESCALATION_GAME_DEPOSIT, repToken.getTotalTheoreticalSupply() / FORK_TRESHOLD_DIVISOR);
		}
		securityVaults[msg.sender].lockedRepInEscalationGame += escalationGame.depositOnOutcome(msg.sender, outcome, amount);
		require(poolOwnershipToRep(securityVaults[msg.sender].poolOwnership) >= securityVaults[msg.sender].lockedRepInEscalationGame, 'Not enough REP');
	}

	function withdrawFromEscalationGame(uint256[] memory depositIndexes) external isOperational {
		require(address(escalationGame) != address(0x0), 'escalation game needs to be deployed');
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, uint256 amountToWithdraw) = escalationGame.withdrawDeposit(depositIndexes[index]);
			securityVaults[depositor].poolOwnership += repToPoolOwnership(amountToWithdraw);
		}
	}

	// todo, cleanup these only forker functions by minimizing amount and adding checks
	function setSystemState(SystemState newState) external onlyForker {
		systemState = newState;
	}

	function setRetentionRate(uint256 newRetention) external onlyForker {
		currentRetentionRate = newRetention;
	}

	function setVaultOwnership(address vault, uint256 _poolOwnership, uint256 _securityBondAllowance) external onlyForker {
		securityVaults[vault].poolOwnership = _poolOwnership;
		securityVaults[vault].securityBondAllowance = _securityBondAllowance;
	}

	function setVaultSecurityBondAllowance(address vault, uint256 _securityBondAllowance) external onlyForker {
		securityVaults[vault].securityBondAllowance = _securityBondAllowance;

	}
	function addToTotalSecurityBondAllowance(uint256 securityBondAllowanceDelta) external onlyForker {
		totalSecurityBondAllowance += securityBondAllowanceDelta;
	}

	function setPoolOwnershipDenominator(uint256 _poolOwnershipDenominator) external onlyForker {
		poolOwnershipDenominator = _poolOwnershipDenominator;
	}

	function setVaultPoolOwnership(address vault, uint256 poolOwnership) external onlyForker {
		securityVaults[vault].poolOwnership = poolOwnership;
	}

	function setVaultFeeIndex(address vault, uint256 newFeeIndex) external onlyForker {
		securityVaults[vault].feeIndex = newFeeIndex;
	}

	function setShareTokenSupply(uint256 newShareTokenSupply) external onlyForker {
		shareTokenSupply = newShareTokenSupply;
	}

	function setCompleteSetCollateralAmount(uint256 newCompleteSetCollateralAmount) external onlyForker {
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
	}

	function setTotalSecurityBondAllowance(uint256 newTotalSecurityBondAllowance) external onlyForker {
		totalSecurityBondAllowance = newTotalSecurityBondAllowance;
	}

	receive() external payable {
		// needed for Truth Auction to send ETH back
	}
}
