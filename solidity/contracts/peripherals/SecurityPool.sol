// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar, FORK_THRESHOLD_DIVISOR } from '../Zoltar.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { SecurityPoolOracleCoordinator } from './SecurityPoolOracleCoordinator.sol';
import { ISecurityPool, SecurityVault, SystemState, QuestionOutcome, ISecurityPoolFactory } from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { EscalationGame } from './EscalationGame.sol';
import { EscalationGameCarryTree, CarriedDepositProof } from './EscalationGameCarryTree.sol';
import { ZoltarQuestionData } from '../ZoltarQuestionData.sol';
import { SecurityPoolForker } from './SecurityPoolForker.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

uint256 constant TODO_INITIAL_ESCALATION_GAME_DEPOSIT = 1 ether; // TODO, how to get this value?

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is ISecurityPool {
	uint256 public immutable questionId;
	uint248 public immutable universeId;

	Zoltar public immutable zoltar;
	ISecurityPool immutable public parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	SecurityPoolOracleCoordinator public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	EscalationGame public escalationGame;
	ZoltarQuestionData public questionData;
	address public securityPoolForker;
	address public immutable truthAuction;
	ISecurityPoolFactory public securityPoolFactory;

	uint256 public totalSecurityBondAllowance;
	uint256 public completeSetCollateralAmount; // amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public poolOwnershipDenominator;
	uint256 public securityMultiplier;
	uint256 public shareTokenSupply;
	uint256 public totalLockedRepInEscalationGame;

	uint256 public totalFeesOwedToVaults;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;

	mapping(address => SecurityVault) public securityVaults;
	address[] private vaults;
	mapping(address => uint256) private vaultIndexesPlusOne;

	SystemState public systemState;

	event SecurityBondAllowanceChange(address vault, uint256 from, uint256 to);
	event PerformWithdrawRep(address vault, uint256 amount);
	event PoolRetentionRateChanged(uint256 retentionRate);
	event DepositRep(address vault, uint256 repAmount, uint256 poolOwnership);
	event RedeemShares(address redeemer, uint256 sharesAmount, uint256 ethValue);
	event UpdateVaultFees(address vault, uint256 feeIndex, uint256 unpaidEthFees);
	event RedeemFees(address vault, uint256 fees);
	event UpdateCollateralAmount(uint256 totalFeesOwedToVaults, uint256 completeSetCollateralAmount);
	event CreateCompleteSet(uint256 shareTokenSupply, uint256 completeSetsToMint, uint256 completeSetCollateralAmount);
	event PerformLiquidation(address callerVault, address targetVaultAddress, uint256 debtAmount, uint256 debtToMove, uint256 repToMove);
	event RedeemRep(address caller, address vault, uint256 repAmount);

	modifier isOperational { // TODO, system can be operational if the fork has happened after this question has finalized
		// Once a universe forks, the parent pool must freeze all operational flows permanently.
		// The continuation path lives in the outcome child pools, which can re-enter
		// `SystemState.Operational` after migration / truth-auction processing completes.
		// Post-fork claims use the dedicated migration and redemption functions instead of
		// continuing to mutate the parent pool's accounting.
		require(zoltar.getForkTime(universeId) == 0, 'zoltar forked');
		require(systemState == SystemState.Operational, 'not operational');
		_;
	}

	modifier onlyValidOracle {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'OnlyOracle');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'stale price');
		_;
	}

	modifier onlyForker {
		require(msg.sender == securityPoolForker, 'Only Forker');
		_;
	}

	constructor(address _securityPoolForker, ISecurityPoolFactory _securityPoolFactory, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, SecurityPoolOracleCoordinator _priceOracleManagerAndOperatorQueuer, IShareToken _shareToken, OpenOracle _openOracle, ISecurityPool _parent, Zoltar _zoltar, uint248 _universeId, uint256 _questionId, uint256 _securityMultiplier, address _truthAuction) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		priceOracleManagerAndOperatorQueuer = _priceOracleManagerAndOperatorQueuer;
		securityPoolForker = _securityPoolForker;
		truthAuction = _truthAuction;
		questionData = _questionData;
		if (address(parent) == address(0x0)) { // origin universe never does truthAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
		}
		shareToken = _shareToken;
		repToken = zoltar.getRepToken(universeId);
		repToken.approve(address(zoltar), type(uint256).max);
	}

	function getVaultCount() external view returns (uint256) {
		return vaults.length;
	}

	function initialEscalationGameDeposit() external pure returns (uint256) {
		return TODO_INITIAL_ESCALATION_GAME_DEPOSIT;
	}

	function getVaults(uint256 startIndex, uint256 count) external view returns (address[] memory vaultRange) {
		if (startIndex >= vaults.length || count == 0) return new address[](0);

		uint256 availableCount = vaults.length - startIndex;
		uint256 resultCount = count < availableCount ? count : availableCount;
		vaultRange = new address[](resultCount);
		for (uint256 index = 0; index < resultCount; index++) {
			vaultRange[index] = vaults[startIndex + index];
		}
	}

	// Only parent pools with a deployed escalation game should freeze their collateralized
	// operations once that game has resolved. Child pools inherit finalized outcomes from
	// fork routing but must stay operational after migration/truth-auction settlement.
	function isEscalationResolved() public view returns (bool) {
		if (address(escalationGame) == address(0x0)) return false;
		return ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this) != BinaryOutcomes.BinaryOutcome.None;
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _completeSetCollateralAmount) external {
		require(msg.sender == address(securityPoolFactory), 'only callable by securityPoolFactory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		uint256 initialOraclePrice = address(parent) == address(0x0) ? 0 : parent.priceOracleManagerAndOperatorQueuer().lastPrice();
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(initialOraclePrice);
	}

	function updateCollateralAmount() public {
		if (totalSecurityBondAllowance == 0) return;
		uint256 forkTime = zoltar.getForkTime(universeId);
		uint256 endTime = questionData.getQuestionEndDate(questionId);
		uint256 feeEndDate = forkTime == 0 ? endTime : forkTime;
		uint256 clampedCurrentTimestamp = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;
		if (lastUpdatedFeeAccumulator > clampedCurrentTimestamp) return;
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;

		uint256 newCompleteSetCollateralAmount = completeSetCollateralAmount * SecurityPoolUtils.rpow(currentRetentionRate, timeDelta, SecurityPoolUtils.PRICE_PRECISION) / SecurityPoolUtils.PRICE_PRECISION;
		uint256 delta = completeSetCollateralAmount - newCompleteSetCollateralAmount;
		totalFeesOwedToVaults += delta;
		feeIndex += delta * SecurityPoolUtils.PRICE_PRECISION / totalSecurityBondAllowance;
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
		lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;

		emit UpdateCollateralAmount(totalFeesOwedToVaults, completeSetCollateralAmount);
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

	function redeemFees(address vault) external {
		uint256 fees = securityVaults[vault].unpaidEthFees;
		securityVaults[vault].unpaidEthFees = 0;
		totalFeesOwedToVaults -= fees;
		(bool sent, ) = payable(vault).call{ value: fees }('');
		require(sent, 'failed to send Ether');
		emit RedeemFees(vault, fees);
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 repAmount) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'question resolved');
		uint256 ownershipToWithdraw = repToPoolOwnership(repAmount);
		uint256 withdrawOwnership = ownershipToWithdraw + repToPoolOwnership(SecurityPoolUtils.MIN_REP_DEPOSIT) > securityVaults[vault].poolOwnership ? securityVaults[vault].poolOwnership : ownershipToWithdraw;
		uint256 withdrawRepAmount = poolOwnershipToRep(withdrawOwnership);
		uint256 totalRepBalance = getTotalRepBalance();
		uint256 availableRepBalance = getAvailableRepBalance();

		uint256 oldRep = poolOwnershipToRep(securityVaults[vault].poolOwnership);
		require(oldRep >= securityVaults[vault].lockedRepInEscalationGame + withdrawRepAmount, 'uses locked rep');
		require((oldRep - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'local bond broken');
		require((totalRepBalance - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >= totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(), 'global bond broken');
		require(availableRepBalance >= withdrawRepAmount, 'uses locked rep');

		securityVaults[vault].poolOwnership -= withdrawOwnership;
		poolOwnershipDenominator -= withdrawOwnership;
		repToken.transfer(vault, withdrawRepAmount);
		emit PerformWithdrawRep(vault, withdrawRepAmount);
	}

	function repToPoolOwnership(uint256 repAmount) public view returns (uint256) {
		uint256 totalRepBalance = getTotalRepBalance();
		if (poolOwnershipDenominator == 0 || totalRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return repAmount * poolOwnershipDenominator / totalRepBalance;
	}

	function poolOwnershipToRep(uint256 poolOwnership) public view returns (uint256) {
		if (poolOwnershipDenominator == 0) return 0;
		return poolOwnership * getTotalRepBalance() / poolOwnershipDenominator;
	}

	function getAvailableRepBalance() public view returns (uint256) {
		// REP committed to an active escalation game still belongs to the originating vault and
		// continues to back that vaults bond exposure. It is excluded here only because it is
		// not currently withdrawable by arbitrary vaults.
		return repToken.balanceOf(address(this)) - totalLockedRepInEscalationGame;
	}

	function getTotalRepBalance() public view returns (uint256) {
		return repToken.balanceOf(address(this));
	}

	function sharesToCash(uint256 completeSetAmount) public view returns (uint256) {
		if (completeSetAmount == 0) return 0;
		if (shareTokenSupply == 0) return 0;
		return completeSetAmount * completeSetCollateralAmount / shareTokenSupply;
	}

	function cashToShares(uint256 eth) public view returns (uint256) {
		return completeSetCollateralAmount == 0 ? (eth * SecurityPoolUtils.PRICE_PRECISION) : (eth * shareTokenSupply / completeSetCollateralAmount);
	}

	function depositRep(uint256 repAmount) external isOperational {
		require(!isEscalationResolved(), 'question resolved');
		uint256 poolOwnership = repToPoolOwnership(repAmount);
		repToken.transferFrom(msg.sender, address(this), repAmount);
		_trackVault(msg.sender);
		securityVaults[msg.sender].poolOwnership += poolOwnership;
		poolOwnershipDenominator += poolOwnership;
		require(poolOwnershipToRep(securityVaults[msg.sender].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT, 'min rep');
		emit DepositRep(msg.sender, repAmount, securityVaults[msg.sender].poolOwnership);
	}

	////////////////////////////////////////
	// liquidating vault
	////////////////////////////////////////
	//price = (amount1 * PRICE_PRECISION) / amount2;
	// price = REP * PRICE_PRECISION / ETH
	// liquidation moves share of debt and rep to another pool which need to remain non-liquidable
	// this is currently very harsh, as we steal all the rep and debt from the pool
	function performLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 debtAmount,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator
	) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'question resolved');
		_trackVault(callerVault);
		updateVaultFees(targetVaultAddress);
		updateVaultFees(callerVault);

		uint256 vaultsRepDeposit;
		if (snapshotDenominator == 0) {
			vaultsRepDeposit = snapshotTargetOwnership / SecurityPoolUtils.PRICE_PRECISION;
		} else {
			vaultsRepDeposit = (snapshotTargetOwnership * snapshotTotalRep) / snapshotDenominator;
		}

		// Liquidation values a vault against its full collateral claim, which is exactly what
		// the total-balance ownership snapshot above represents.
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		require(snapshotTargetAllowance * securityMultiplier * repEthPrice > vaultsRepDeposit * SecurityPoolUtils.PRICE_PRECISION, 'not liquidatable');

		uint256 debtToMove = debtAmount > snapshotTargetAllowance ? snapshotTargetAllowance : debtAmount;
		require(debtToMove > 0, 'no debt');
		uint256 repToMove = debtToMove * vaultsRepDeposit / snapshotTargetAllowance;
		uint256 ownershipToMove = repToPoolOwnership(repToMove);
		require(
			(securityVaults[callerVault].securityBondAllowance + debtToMove) * securityMultiplier * repEthPrice <=
				poolOwnershipToRep(securityVaults[callerVault].poolOwnership + ownershipToMove) * SecurityPoolUtils.PRICE_PRECISION,
			'New pool would be liquidable!'
		);

		// Update target's allowance based on snapshot to prevent blocking via allowance changes
		securityVaults[targetVaultAddress].securityBondAllowance = snapshotTargetAllowance - debtToMove;
		securityVaults[targetVaultAddress].poolOwnership -= ownershipToMove;
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;

		// target vault needs to be above thresholds after liquidation
		require(
			poolOwnershipToRep(securityVaults[targetVaultAddress].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT ||
				securityVaults[targetVaultAddress].poolOwnership == 0,
			'target min deposit requirement'
		);
		require(
			securityVaults[targetVaultAddress].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT ||
				securityVaults[targetVaultAddress].securityBondAllowance == 0,
			'target min deposit requirement'
		);
		require(
			poolOwnershipToRep(securityVaults[callerVault].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT,
			'caller min deposit requirement'
		);
		require(
			securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT,
			'caller min deposit requirement'
		);

		emit PerformLiquidation(callerVault, targetVaultAddress, debtAmount, debtToMove, repToMove);
	}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(address callerVault, uint256 amount) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'question resolved');
		updateVaultFees(callerVault);

		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		totalSecurityBondAllowance += amount;
		totalSecurityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance = amount;

		// Ownership conversions are based on total REP balance, so this local collateral check
		// automatically includes REP currently committed to escalation.
		require(poolOwnershipToRep(securityVaults[callerVault].poolOwnership) * SecurityPoolUtils.PRICE_PRECISION > amount * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(getTotalRepBalance() * SecurityPoolUtils.PRICE_PRECISION > totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice());
		require(totalSecurityBondAllowance >= completeSetCollateralAmount, 'too many sets');
		require(securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT || securityVaults[callerVault].securityBondAllowance == 0, 'min bond');
		emit SecurityBondAllowanceChange(callerVault, oldAllowance, amount);
		updateRetentionRate();
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() payable external isOperational { // TODO, we want to be able to create complete sets in the children right away, figure accounting out
		require(!isEscalationResolved(), 'question resolved');
		require(msg.value > 0, 'need eth');
		updateCollateralAmount();
		require(totalSecurityBondAllowance >= msg.value + completeSetCollateralAmount, 'no set capacity');
		uint256 completeSetsToMint = cashToShares(msg.value);
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMint);
		shareTokenSupply += completeSetsToMint;
		completeSetCollateralAmount += msg.value;
		emit CreateCompleteSet(shareTokenSupply, completeSetsToMint, completeSetCollateralAmount);
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 completeSetAmount) external isOperational { // TODO, we want to allow people to exit, but for accounting purposes that is difficult but maybe there's a way?
		updateCollateralAmount();
		// takes in complete set and releases security bond and eth
		uint256 ethValue = sharesToCash(completeSetAmount);
		shareToken.burnCompleteSets(universeId, msg.sender, completeSetAmount);
		shareTokenSupply -= completeSetAmount;
		completeSetCollateralAmount -= ethValue;
		updateRetentionRate();
		(bool sent, ) = payable(msg.sender).call{ value: ethValue }('');
		require(sent, 'failed to send Ether');
	}

	function redeemShares() external {
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		uint256 amount = shareToken.burnTokenId(tokenId, msg.sender);
		uint256 ethValue = sharesToCash(amount);
		shareTokenSupply -= amount;
		completeSetCollateralAmount -= ethValue;
		(bool sent, ) = payable(msg.sender).call{ value: ethValue }('');
		require(sent, 'failed to send Ether');
		emit RedeemShares(msg.sender, amount, ethValue);
	}

	function redeemRep(address vault) external {
		require(systemState == SystemState.Operational, 'not operational');
		require(ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this) != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		require(securityVaults[vault].lockedRepInEscalationGame == 0, 'settle locks first');
		updateVaultFees(vault);
		uint256 vaultOwnership = securityVaults[vault].poolOwnership;
		uint256 ownershipToRedeem = vaultOwnership;
		uint256 repAmount = poolOwnershipToRep(ownershipToRedeem);
		require(repAmount > 0, 'no redeemable rep');
		securityVaults[vault].poolOwnership = 0;
		poolOwnershipDenominator -= ownershipToRedeem;
		repToken.transfer(vault, repAmount);
		emit RedeemRep(msg.sender, vault, repAmount);
	}

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, uint256[] memory parentDepositIndexes) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		require(withdrawalOutcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');

		address beneficiaryVault = address(0x0);
		uint256 totalAmountToWithdraw = 0;
		uint256 totalOriginalDepositAmount = 0;
		for (uint256 index = 0; index < parentDepositIndexes.length; index++) {
			address depositor;
			uint256 amountToWithdraw;
			uint256 originalDepositAmount;
			if (withdrawalOutcome == questionOutcome) {
				(depositor, amountToWithdraw, originalDepositAmount) = escalationGame.withdrawImportedForkDeposit(parentDepositIndexes[index], withdrawalOutcome);
			} else {
				(depositor, originalDepositAmount) = escalationGame.forfeitImportedForkDeposit(parentDepositIndexes[index], withdrawalOutcome);
			}
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
			securityVaults[depositor].lockedRepInEscalationGame -= originalDepositAmount;
			totalLockedRepInEscalationGame -= originalDepositAmount;
			totalAmountToWithdraw += amountToWithdraw;
			totalOriginalDepositAmount += originalDepositAmount;
		}
		_applyForkedEscalationSettlement(beneficiaryVault, totalAmountToWithdraw, totalOriginalDepositAmount);
	}

	function withdrawForkedEscalationDepositsWithProofs(QuestionOutcome outcome, CarriedDepositProof[] memory proofs) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		require(withdrawalOutcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');
		require(withdrawalOutcome == questionOutcome, 'use forfeit for losing outcome');

		EscalationGameCarryTree carryTreeEscalationGame = EscalationGameCarryTree(payable(address(escalationGame)));
		address beneficiaryVault = address(0x0);
		uint256 totalAmountToWithdraw = 0;
		uint256 totalOriginalDepositAmount = 0;
		for (uint256 index = 0; index < proofs.length; index++) {
			(address depositor, uint256 amountToWithdraw, uint256 originalDepositAmount) = carryTreeEscalationGame.withdrawCarriedDeposit(withdrawalOutcome, proofs[index]);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
			securityVaults[depositor].lockedRepInEscalationGame -= originalDepositAmount;
			totalLockedRepInEscalationGame -= originalDepositAmount;
			totalAmountToWithdraw += amountToWithdraw;
			totalOriginalDepositAmount += originalDepositAmount;
		}
		_applyForkedEscalationSettlement(beneficiaryVault, totalAmountToWithdraw, totalOriginalDepositAmount);
	}

	function forfeitForkedEscalationDepositsWithProofs(QuestionOutcome outcome, CarriedDepositProof[] memory proofs) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		require(withdrawalOutcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');
		require(withdrawalOutcome != questionOutcome, 'use withdraw for winning outcome');

		EscalationGameCarryTree carryTreeEscalationGame = EscalationGameCarryTree(payable(address(escalationGame)));
		address beneficiaryVault = address(0x0);
		uint256 totalOriginalDepositAmount = 0;
		for (uint256 index = 0; index < proofs.length; index++) {
			(address depositor, uint256 originalDepositAmount) = carryTreeEscalationGame.forfeitCarriedDeposit(withdrawalOutcome, proofs[index]);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
			securityVaults[depositor].lockedRepInEscalationGame -= originalDepositAmount;
			totalLockedRepInEscalationGame -= originalDepositAmount;
			totalOriginalDepositAmount += originalDepositAmount;
		}
		_applyForkedEscalationSettlement(beneficiaryVault, 0, totalOriginalDepositAmount);
	}

	////////////////////////////////////////
	// Escalation Game (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////

	function depositToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maxAmount) external isOperational {
		require(!awaitingForkContinuation, 'awaiting fork continuation');
		if (address(escalationGame) == address(0x0)) {
			uint256 endTime = questionData.getQuestionEndDate(questionId);
			require(block.timestamp > endTime, 'question active');
			escalationGame = escalationGameFactory.deployEscalationGame(TODO_INITIAL_ESCALATION_GAME_DEPOSIT, zoltar.getForkThreshold(universeId) / 2);
		} else {
			require(!escalationGame.forkContinuation() || escalationGame.forkContinuationResumed(), 'fork continuation not resumed');
		}
		uint256 depositedAmount = escalationGame.depositOnOutcome(msg.sender, outcome, maxAmount);
		securityVaults[msg.sender].lockedRepInEscalationGame += depositedAmount;
		totalLockedRepInEscalationGame += depositedAmount;
		require(poolOwnershipToRep(securityVaults[msg.sender].poolOwnership) >= securityVaults[msg.sender].lockedRepInEscalationGame, 'rep too low');
	}

	function withdrawFromEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256[] memory depositIndexes) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		uint256 forkTime = zoltar.getForkTime(universeId);
		if (forkTime > 0 && forkTime < escalationGame.getEscalationGameEndDate() && !escalationGame.hasReachedNonDecision()) {
			revert('migrate forked locks');
		}
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		address beneficiaryVault = address(0x0);
		uint256 totalAmountToWithdraw = 0;
		uint256 totalOriginalDepositAmount = 0;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			address depositor;
			uint256 amountToWithdraw;
			uint256 originalDepositAmount;
			if (outcome == questionOutcome) {
				(depositor, amountToWithdraw, originalDepositAmount) = escalationGame.withdrawDeposit(depositIndexes[index]);
			} else {
				(depositor, originalDepositAmount) = escalationGame.forfeitLosingDeposit(depositIndexes[index], outcome);
			}
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
			securityVaults[depositor].lockedRepInEscalationGame -= originalDepositAmount;
			totalLockedRepInEscalationGame -= originalDepositAmount;
			totalAmountToWithdraw += amountToWithdraw;
			totalOriginalDepositAmount += originalDepositAmount;
		}
		if (totalAmountToWithdraw > totalOriginalDepositAmount) {
			securityVaults[beneficiaryVault].poolOwnership += repToPoolOwnership(totalAmountToWithdraw - totalOriginalDepositAmount);
		} else if (totalAmountToWithdraw < totalOriginalDepositAmount) {
			securityVaults[beneficiaryVault].poolOwnership -= repToPoolOwnership(totalOriginalDepositAmount - totalAmountToWithdraw);
		}
	}

	function activateForkMode() external onlyForker {
		systemState = SystemState.PoolForked;
		updateCollateralAmount();
		currentRetentionRate = 0;
		repToken.transfer(msg.sender, repToken.balanceOf(address(this)));
	}

	function initializeForkedEscalationGame(uint256 startBond, uint256 nonDecisionThreshold, uint256 elapsedAtFork) external onlyForker {
		require(address(escalationGame) == address(0x0), 'escalation exists');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(startBond, nonDecisionThreshold, elapsedAtFork);
	}

	function initializeForkCarrySnapshot(
		bytes32[3] memory inheritedCarryRoots,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external onlyForker {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		EscalationGameCarryTree(payable(address(escalationGame))).initializeForkCarrySnapshot(
			inheritedCarryRoots,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedNullifierRoots
		);
	}

	function resumeForkedEscalationGame() external onlyForker {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		escalationGame.resumeFromFork();
	}

	function setAwaitingForkContinuation(bool shouldAwait) external onlyForker {
		awaitingForkContinuation = shouldAwait;
	}

	function setSystemState(SystemState newState) external onlyForker {
		systemState = newState;
	}

	function configureVault(address vault, uint256 poolOwnership, uint256 securityBondAllowance, uint256 vaultFeeIndex) external onlyForker {
		require(vault != address(0x0), 'invalid vault');
		_trackVault(vault);
		securityVaults[vault].poolOwnership = poolOwnership;
		securityVaults[vault].securityBondAllowance = securityBondAllowance;
		securityVaults[vault].feeIndex = vaultFeeIndex;
	}

	function addEscalationLockForForkMigration(address vault, uint256 repAmount) external onlyForker {
		require(vault != address(0x0), 'invalid vault');
		require(repAmount > 0, 'rep > 0');
		_trackVault(vault);
		securityVaults[vault].lockedRepInEscalationGame += repAmount;
		totalLockedRepInEscalationGame += repAmount;
	}

	function clearEscalationLockForForkMigration(address vault, uint256 repAmount) external onlyForker {
		require(securityVaults[vault].lockedRepInEscalationGame >= repAmount, 'locked rep low');
		require(totalLockedRepInEscalationGame >= repAmount, 'total locked low');
		securityVaults[vault].lockedRepInEscalationGame -= repAmount;
		totalLockedRepInEscalationGame -= repAmount;
	}

	function _applyForkedEscalationSettlement(address beneficiaryVault, uint256 totalAmountToWithdraw, uint256 totalOriginalDepositAmount) private {
		if (beneficiaryVault == address(0x0)) return;
		if (totalAmountToWithdraw > totalOriginalDepositAmount) {
			securityVaults[beneficiaryVault].poolOwnership += repToPoolOwnership(totalAmountToWithdraw - totalOriginalDepositAmount);
		} else if (totalAmountToWithdraw < totalOriginalDepositAmount) {
			securityVaults[beneficiaryVault].poolOwnership -= repToPoolOwnership(totalOriginalDepositAmount - totalAmountToWithdraw);
		}
	}

	function _trackVault(address vault) private {
		require(vault != address(0x0), 'invalid vault');
		if (vaultIndexesPlusOne[vault] != 0) return;
		vaults.push(vault);
		vaultIndexesPlusOne[vault] = vaults.length;
	}

	function setOwnershipDenominator(uint256 newDenominator) external onlyForker {
		poolOwnershipDenominator = newDenominator;
	}

	function setTotalShares(uint256 newTotalShares) external onlyForker {
		shareTokenSupply = newTotalShares;
	}

	function setPoolFinancials(uint256 newCollateral, uint256 newTotalBondAllowance) external onlyForker {
		require(newTotalBondAllowance >= newCollateral, 'bond low');
		completeSetCollateralAmount = newCollateral;
		totalSecurityBondAllowance = newTotalBondAllowance;
	}

	function drainAllRep() external onlyForker {
		repToken.transfer(msg.sender, repToken.balanceOf(address(this)));
	}

	function transferEth(address payable receiver, uint256 amount) external onlyForker {
		(bool sent, ) = receiver.call{ value: amount }('');
		require(sent, 'failed to send ETH');
	}

	function authorizeChildPool(ISecurityPool pool) external onlyForker {
		shareToken.authorize(pool);
	}


	receive() external payable {
		require(
			msg.sender == securityPoolForker ||
			msg.sender == truthAuction ||
			msg.sender == address(parent),
			'unauthorized sender'
		);
	}
}
