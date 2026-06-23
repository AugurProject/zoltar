// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { SecurityPoolOracleCoordinator } from './SecurityPoolOracleCoordinator.sol';
import {
	ISecurityPool,
	SecurityVault,
	SystemState,
	QuestionOutcome,
	ISecurityPoolFactory
} from './interfaces/ISecurityPool.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { EscalationGame } from './EscalationGame.sol';
import { CarriedDepositProof } from './EscalationGameTypes.sol';
import { ZoltarQuestionData } from '../ZoltarQuestionData.sol';
import { SecurityPoolForker } from './SecurityPoolForker.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is ISecurityPool {
	using SafeERC20Ops for IERC20;

	uint256 public immutable questionId;
	uint248 public immutable universeId;
	uint256 public immutable initialEscalationGameDeposit;

	Zoltar public immutable zoltar;
	ISecurityPool public immutable parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	SecurityPoolOracleCoordinator public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	EscalationGame public escalationGame;
	ZoltarQuestionData public immutable questionData;
	address public immutable securityPoolForker;
	address public immutable truthAuction;
	ISecurityPoolFactory public immutable securityPoolFactory;

	uint256 public totalSecurityBondAllowance;
	uint256 public completeSetCollateralAmount; // amount of eth that is backing complete sets, `address(this).balance - completeSetCollateralAmount` are the fees belonging to REP pool holders
	uint256 public poolOwnershipDenominator;
	uint256 public securityMultiplier;
	uint256 public shareTokenSupply;

	uint256 public totalFeesOwedToVaults;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;

	mapping(address => SecurityVault) public securityVaults;
	address[] private vaults;
	mapping(address => uint256) private vaultIndexesPlusOne;
	// Active-vault paging is newest-first so UI previews remain stable after removals
	// and can intentionally surface the most recently touched active vaults.
	uint256 private activeVaultCount;
	address private latestActiveVault;
	mapping(address => address) private olderActiveVaults;
	mapping(address => address) private newerActiveVaults;
	mapping(address => bool) private isActiveVault;

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
	event PerformLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 debtAmount,
		uint256 debtToMove,
		uint256 repToMove
	);
	event RedeemRep(address caller, address vault, uint256 repAmount);

	modifier isOperational() {
		// Once a universe forks, the parent pool freezes operational flows permanently.
		// Outcome child pools can re-enter `SystemState.Operational` after migration and
		// truth-auction processing complete. Finalized claim paths keep their own state
		// and finality guards so late unrelated forks do not block share or REP redemption.
		require(zoltar.getForkTime(universeId) == 0, 'zoltar forked');
		require(systemState == SystemState.Operational, 'not operational');
		_;
	}

	modifier onlyValidOracle() {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'OnlyOracle');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'stale price');
		_;
	}

	modifier onlyForker() {
		require(msg.sender == securityPoolForker, 'Only Forker');
		_;
	}

	constructor(
		address _securityPoolForker,
		ISecurityPoolFactory _securityPoolFactory,
		ZoltarQuestionData _questionData,
		EscalationGameFactory _escalationGameFactory,
		SecurityPoolOracleCoordinator _priceOracleManagerAndOperatorQueuer,
		IShareToken _shareToken,
		OpenOracle _openOracle,
		ISecurityPool _parent,
		Zoltar _zoltar,
		uint248 _universeId,
		uint256 _questionId,
		uint256 _securityMultiplier,
		uint256 _initialEscalationGameDeposit,
		address _truthAuction
	) {
		universeId = _universeId;
		securityPoolFactory = _securityPoolFactory;
		questionId = _questionId;
		securityMultiplier = _securityMultiplier;
		initialEscalationGameDeposit = _initialEscalationGameDeposit;
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		priceOracleManagerAndOperatorQueuer = _priceOracleManagerAndOperatorQueuer;
		securityPoolForker = _securityPoolForker;
		truthAuction = _truthAuction;
		questionData = _questionData;
		if (address(parent) == address(0x0)) {
			// origin universe never does truthAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
		}
		shareToken = _shareToken;
		repToken = zoltar.getRepToken(universeId);
		IERC20(address(repToken)).safeApprove(address(zoltar), type(uint256).max);
	}

	function getVaultCount() external view returns (uint256) {
		return vaults.length;
	}

	function getActiveVaultCount() external view returns (uint256) {
		return activeVaultCount;
	}

	function getVaults(uint256 startIndex, uint256 count) external view returns (address[] memory vaultRange) {
		return _sliceVaults(vaults, startIndex, count);
	}

	function getActiveVaults(uint256 startIndex, uint256 count) external view returns (address[] memory vaultRange) {
		return _sliceActiveVaults(startIndex, count);
	}

	function _sliceVaults(
		address[] storage sourceVaults,
		uint256 startIndex,
		uint256 count
	) private view returns (address[] memory vaultRange) {
		if (startIndex >= sourceVaults.length || count == 0) return new address[](0);

		uint256 availableCount = sourceVaults.length - startIndex;
		uint256 resultCount = count < availableCount ? count : availableCount;
		vaultRange = new address[](resultCount);
		for (uint256 index = 0; index < resultCount; index++) {
			vaultRange[index] = sourceVaults[startIndex + index];
		}
	}

	function _sliceActiveVaults(uint256 startIndex, uint256 count) private view returns (address[] memory vaultRange) {
		if (count == 0 || startIndex >= activeVaultCount) return new address[](0);

		uint256 availableCount = activeVaultCount - startIndex;
		uint256 resultCount = count < availableCount ? count : availableCount;
		vaultRange = new address[](resultCount);
		address currentVault = latestActiveVault;
		for (uint256 skipped = 0; skipped < startIndex && currentVault != address(0x0); skipped++) {
			currentVault = olderActiveVaults[currentVault];
		}
		for (uint256 index = 0; index < resultCount && currentVault != address(0x0); index++) {
			vaultRange[index] = currentVault;
			currentVault = olderActiveVaults[currentVault];
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
		require(msg.sender == address(securityPoolFactory), 'only factory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		uint256 initialOraclePrice =
			address(parent) == address(0x0) ? 0 : parent.priceOracleManagerAndOperatorQueuer().lastPrice();
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

		uint256 newCompleteSetCollateralAmount =
			(completeSetCollateralAmount *
				SecurityPoolUtils.rpow(currentRetentionRate, timeDelta, SecurityPoolUtils.PRICE_PRECISION)) /
				SecurityPoolUtils.PRICE_PRECISION;
		uint256 delta = completeSetCollateralAmount - newCompleteSetCollateralAmount;
		totalFeesOwedToVaults += delta;
		feeIndex += (delta * SecurityPoolUtils.PRICE_PRECISION) / totalSecurityBondAllowance;
		completeSetCollateralAmount = newCompleteSetCollateralAmount;
		lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;

		emit UpdateCollateralAmount(totalFeesOwedToVaults, completeSetCollateralAmount);
	}

	function updateRetentionRate() public {
		if (totalSecurityBondAllowance == 0) return;
		if (systemState != SystemState.Operational) return; // if system state is not operational do not change fees
		currentRetentionRate = SecurityPoolUtils.calculateRetentionRate(
			completeSetCollateralAmount,
			totalSecurityBondAllowance
		);
		emit PoolRetentionRateChanged(currentRetentionRate);
	}

	function updateVaultFees(address vault) public {
		updateCollateralAmount();
		uint256 fees =
			(securityVaults[vault].securityBondAllowance * (feeIndex - securityVaults[vault].feeIndex)) /
				SecurityPoolUtils.PRICE_PRECISION;
		securityVaults[vault].feeIndex = feeIndex;
		securityVaults[vault].unpaidEthFees += fees;
		_syncActiveVault(vault);
		emit UpdateVaultFees(vault, securityVaults[vault].feeIndex, securityVaults[vault].unpaidEthFees);
	}

	function redeemFees(address vault) external {
		updateVaultFees(vault);
		uint256 fees = securityVaults[vault].unpaidEthFees;
		securityVaults[vault].unpaidEthFees = 0;
		totalFeesOwedToVaults -= fees;
		_syncActiveVault(vault);
		_sendEth(payable(vault), fees);
		emit RedeemFees(vault, fees);
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 repAmount) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'question resolved');
		if (address(escalationGame) != address(0x0)) {
			require(escalationGame.escrowedRepByVault(vault) == 0, 'settle locks first');
		}
		uint256 ownershipToWithdraw = repToPoolOwnership(repAmount);
		uint256 withdrawOwnership =
			ownershipToWithdraw + repToPoolOwnership(SecurityPoolUtils.MIN_REP_DEPOSIT) >
				securityVaults[vault].poolOwnership
				? securityVaults[vault].poolOwnership
				: ownershipToWithdraw;
		uint256 withdrawRepAmount = poolOwnershipToRep(withdrawOwnership);
		uint256 totalRepBalance = getTotalRepBalance();

		uint256 oldRep = poolOwnershipToRep(securityVaults[vault].poolOwnership);
		require(oldRep >= withdrawRepAmount, 'withdraw too high');
		require(
			(oldRep - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >=
				securityVaults[vault].securityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(),
			'local bond broken'
		);
		require(
			(totalRepBalance - withdrawRepAmount) * SecurityPoolUtils.PRICE_PRECISION >=
				totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice(),
			'global bond broken'
		);

		securityVaults[vault].poolOwnership -= withdrawOwnership;
		poolOwnershipDenominator -= withdrawOwnership;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, withdrawRepAmount);
		emit PerformWithdrawRep(vault, withdrawRepAmount);
	}

	function repToPoolOwnership(uint256 repAmount) public view returns (uint256) {
		uint256 totalRepBalance = getTotalRepBalance();
		if (poolOwnershipDenominator == 0 || totalRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		return (repAmount * poolOwnershipDenominator) / totalRepBalance;
	}

	function repToPoolOwnershipRoundUp(uint256 repAmount) public view returns (uint256) {
		uint256 totalRepBalance = getTotalRepBalance();
		if (poolOwnershipDenominator == 0 || totalRepBalance == 0) return repAmount * SecurityPoolUtils.PRICE_PRECISION;
		uint256 numerator = repAmount * poolOwnershipDenominator;
		if (numerator == 0) return 0;
		return (numerator - 1) / totalRepBalance + 1;
	}

	function poolOwnershipToRep(uint256 poolOwnership) public view returns (uint256) {
		if (poolOwnershipDenominator == 0) return 0;
		return (poolOwnership * getTotalRepBalance()) / poolOwnershipDenominator;
	}

	function getTotalRepBalance() public view returns (uint256) {
		return repToken.balanceOf(address(this));
	}

	function sharesToCash(uint256 completeSetAmount) public view returns (uint256) {
		if (completeSetAmount == 0) return 0;
		if (shareTokenSupply == 0) return 0;
		return (completeSetAmount * completeSetCollateralAmount) / shareTokenSupply;
	}

	function cashToShares(uint256 eth) public view returns (uint256) {
		return
			completeSetCollateralAmount == 0
				? (eth * SecurityPoolUtils.PRICE_PRECISION)
				: ((eth * shareTokenSupply) / completeSetCollateralAmount);
	}

	function depositRep(uint256 repAmount) external isOperational {
		require(!isEscalationResolved(), 'question resolved');
		uint256 poolOwnership = repToPoolOwnership(repAmount);
		IERC20(address(repToken)).safeTransferFrom(msg.sender, address(this), repAmount);
		_trackVault(msg.sender);
		securityVaults[msg.sender].poolOwnership += poolOwnership;
		poolOwnershipDenominator += poolOwnership;
		require(
			poolOwnershipToRep(securityVaults[msg.sender].poolOwnership) >= SecurityPoolUtils.MIN_REP_DEPOSIT,
			'min rep'
		);
		_syncActiveVault(msg.sender);
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

		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		require(
			snapshotTargetAllowance * securityMultiplier * repEthPrice >
				vaultsRepDeposit * SecurityPoolUtils.PRICE_PRECISION,
			'not liquidatable'
		);

		uint256 debtToMove = debtAmount > snapshotTargetAllowance ? snapshotTargetAllowance : debtAmount;
		require(debtToMove > 0, 'no debt');
		uint256 repToMove = (debtToMove * vaultsRepDeposit) / snapshotTargetAllowance;
		uint256 ownershipToMove = repToPoolOwnership(repToMove);
		require(
			(securityVaults[callerVault].securityBondAllowance + debtToMove) * securityMultiplier * repEthPrice <=
				poolOwnershipToRep(securityVaults[callerVault].poolOwnership + ownershipToMove) *
					SecurityPoolUtils.PRICE_PRECISION,
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
		_syncActiveVault(targetVaultAddress);
		_syncActiveVault(callerVault);

		emit PerformLiquidation(callerVault, targetVaultAddress, debtAmount, debtToMove, repToMove);
	}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(
		address callerVault,
		uint256 amount
	) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'question resolved');
		updateVaultFees(callerVault);

		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		totalSecurityBondAllowance += amount;
		totalSecurityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance = amount;

		require(
			poolOwnershipToRep(securityVaults[callerVault].poolOwnership) * SecurityPoolUtils.PRICE_PRECISION >
				amount * priceOracleManagerAndOperatorQueuer.lastPrice()
		);
		require(
			getTotalRepBalance() * SecurityPoolUtils.PRICE_PRECISION >
				totalSecurityBondAllowance * priceOracleManagerAndOperatorQueuer.lastPrice()
		);
		require(totalSecurityBondAllowance >= completeSetCollateralAmount, 'too many sets');
		require(
			securityVaults[callerVault].securityBondAllowance >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT ||
				securityVaults[callerVault].securityBondAllowance == 0,
			'min bond'
		);
		_syncActiveVault(callerVault);
		emit SecurityBondAllowanceChange(callerVault, oldAllowance, amount);
		updateRetentionRate();
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() external payable isOperational {
		// Child pools mint complete sets only after migration and truth-auction
		// accounting have restored `SystemState.Operational`.
		require(!isEscalationResolved(), 'question resolved');
		require(msg.value > 0, 'need eth');
		updateCollateralAmount();
		uint256 completeSetsToMint = cashToShares(msg.value);
		uint256 nextCompleteSetCollateralAmount = completeSetCollateralAmount + msg.value;
		require(totalSecurityBondAllowance >= nextCompleteSetCollateralAmount, 'no set capacity');
		shareTokenSupply += completeSetsToMint;
		completeSetCollateralAmount = nextCompleteSetCollateralAmount;
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMint);
		emit CreateCompleteSet(shareTokenSupply, completeSetsToMint, completeSetCollateralAmount);
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 completeSetAmount) external isOperational {
		// Complete-set exits use the current collateral-per-share rate after fee
		// accrual, preserving the exchange rate for remaining complete sets.
		updateCollateralAmount();
		// takes in complete set and releases security bond and eth
		uint256 ethValue = sharesToCash(completeSetAmount);
		shareToken.burnCompleteSets(universeId, msg.sender, completeSetAmount);
		shareTokenSupply -= completeSetAmount;
		completeSetCollateralAmount -= ethValue;
		updateRetentionRate();
		_sendEth(payable(msg.sender), ethValue);
	}

	function redeemShares() external {
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		updateCollateralAmount();
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		uint256 amount = shareToken.burnTokenId(tokenId, msg.sender);
		uint256 ethValue = sharesToCash(amount);
		shareTokenSupply -= amount;
		completeSetCollateralAmount -= ethValue;
		_sendEth(payable(msg.sender), ethValue);
		emit RedeemShares(msg.sender, amount, ethValue);
	}

	function redeemRep(address vault) external {
		require(systemState == SystemState.Operational, 'not operational');
		require(
			ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this) != BinaryOutcomes.BinaryOutcome.None,
			'question not final'
		);
		uint256 escrowedRep = address(escalationGame) == address(0x0) ? 0 : escalationGame.escrowedRepByVault(vault);
		require(escrowedRep == 0, 'settle locks first');
		updateVaultFees(vault);
		uint256 vaultOwnership = securityVaults[vault].poolOwnership;
		uint256 ownershipToRedeem = vaultOwnership;
		uint256 repAmount = poolOwnershipToRep(ownershipToRedeem);
		require(repAmount > 0, 'no redeemable rep');
		securityVaults[vault].poolOwnership = 0;
		poolOwnershipDenominator -= ownershipToRedeem;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, repAmount);
		emit RedeemRep(msg.sender, vault, repAmount);
	}

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		require(withdrawalOutcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');

		EscalationGame escalationGameContract = EscalationGame(payable(address(escalationGame)));
		address beneficiaryVault = address(0x0);
		for (uint256 index = 0; index < proofs.length; index++) {
			address depositor;
			(depositor, , ) = escalationGameContract.withdrawDeposit(proofs[index], withdrawalOutcome);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
		}
		_syncActiveVault(beneficiaryVault);
	}

	////////////////////////////////////////
	// Escalation Game (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////

	function depositToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maxAmount) external isOperational {
		require(!awaitingForkContinuation, 'awaiting fork continuation');
		if (address(escalationGame) == address(0x0)) {
			uint256 endTime = questionData.getQuestionEndDate(questionId);
			require(block.timestamp > endTime, 'question active');
			escalationGame = escalationGameFactory.deployEscalationGame(
				initialEscalationGameDeposit,
				zoltar.getForkThreshold(universeId) / 2
			);
		} else {
			require(
				!escalationGame.forkContinuation() || escalationGame.forkContinuationResumed(),
				'fork continuation not resumed'
			);
		}

		(uint256 depositedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(
			outcome,
			maxAmount
		);
		require(depositedAmount > 0, 'no deposit');
		uint256 ownershipToEscrow = repToPoolOwnershipRoundUp(depositedAmount);
		uint256 currentRep = poolOwnershipToRep(securityVaults[msg.sender].poolOwnership);
		require(currentRep >= depositedAmount, 'rep too low');
		require(ownershipToEscrow > 0, 'escrow ownership too low');

		uint256 updatedPoolOwnership = securityVaults[msg.sender].poolOwnership - ownershipToEscrow;
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 postTransferRepBalance = getTotalRepBalance() - depositedAmount;
		uint256 postTransferPoolOwnershipDenominator = poolOwnershipDenominator - ownershipToEscrow;
		uint256 remainingRep =
			updatedPoolOwnership == 0
				? 0
				: (updatedPoolOwnership * postTransferRepBalance) / postTransferPoolOwnershipDenominator;
		require(
			remainingRep * SecurityPoolUtils.PRICE_PRECISION >=
				securityVaults[msg.sender].securityBondAllowance * repEthPrice,
			'local bond broken'
		);
		require(
			postTransferRepBalance * SecurityPoolUtils.PRICE_PRECISION >= totalSecurityBondAllowance * repEthPrice,
			'global bond broken'
		);
		require(remainingRep >= SecurityPoolUtils.MIN_REP_DEPOSIT || updatedPoolOwnership == 0, 'min rep');

		securityVaults[msg.sender].poolOwnership = updatedPoolOwnership;
		poolOwnershipDenominator = postTransferPoolOwnershipDenominator;
		IERC20(address(repToken)).safeTransfer(address(escalationGame), depositedAmount);
		escalationGame.recordDepositFromSecurityPool(msg.sender, outcome, depositedAmount, resultingCumulativeAmount);
		_syncActiveVault(msg.sender);
	}

	function withdrawFromEscalationGame(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256[] calldata depositIndexes
	) external {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		require(systemState == SystemState.Operational, 'not operational');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'invalid none');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		uint256 forkTime = zoltar.getForkTime(universeId);
		if (
			forkTime > 0 &&
			forkTime < escalationGame.getEscalationGameEndDate() &&
			!escalationGame.hasReachedNonDecision()
		) {
			revert('migrate forked locks');
		}
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'question not final');
		address beneficiaryVault = address(0x0);
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			address depositor;
			(depositor, , ) = escalationGame.withdrawDeposit(depositIndexes[index], outcome);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'one vault only');
		}
		_syncActiveVault(beneficiaryVault);
	}

	function activateForkMode() external onlyForker {
		systemState = SystemState.PoolForked;
		updateCollateralAmount();
		currentRetentionRate = 0;
		IERC20(address(repToken)).safeTransfer(msg.sender, repToken.balanceOf(address(this)));
	}

	function initializeForkedEscalationGame(
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 elapsedAtFork
	) external onlyForker {
		require(address(escalationGame) == address(0x0), 'escalation exists');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(
			startBond,
			nonDecisionThreshold,
			elapsedAtFork
		);
	}

	function initializeForkCarrySnapshot(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		bytes32[3] memory inheritedNullifierRoots
	) external onlyForker {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		EscalationGame(payable(address(escalationGame))).initializeForkCarrySnapshot(
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedNullifierRoots
		);
	}

	function initializeForkCarrySnapshotWithResolutionBalances(
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		uint256[3] memory inheritedResolutionBalances,
		bytes32[3] memory inheritedNullifierRoots
	) external onlyForker {
		require(address(escalationGame) != address(0x0), 'missing escalation');
		EscalationGame(payable(address(escalationGame))).initializeForkCarrySnapshotWithResolutionBalances(
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedResolutionBalances,
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

	function configureVault(
		address vault,
		uint256 poolOwnership,
		uint256 securityBondAllowance,
		uint256 vaultFeeIndex
	) external onlyForker {
		require(vault != address(0x0), 'invalid vault');
		_trackVault(vault);
		securityVaults[vault].poolOwnership = poolOwnership;
		securityVaults[vault].securityBondAllowance = securityBondAllowance;
		securityVaults[vault].feeIndex = vaultFeeIndex;
		_syncActiveVault(vault);
	}

	function _trackVault(address vault) private {
		require(vault != address(0x0), 'invalid vault');
		if (vaultIndexesPlusOne[vault] != 0) return;
		vaults.push(vault);
		vaultIndexesPlusOne[vault] = vaults.length;
	}

	function _syncActiveVault(address vault) private {
		if (vault == address(0x0)) return;
		bool shouldBeActive =
			securityVaults[vault].poolOwnership > 0 ||
				securityVaults[vault].securityBondAllowance > 0 ||
				securityVaults[vault].unpaidEthFees > 0 ||
				(address(escalationGame) != address(0x0) && escalationGame.escrowedRepByVault(vault) > 0);
		if (shouldBeActive) {
			if (isActiveVault[vault]) {
				if (latestActiveVault == vault) return;
				_detachActiveVault(vault);
				_appendActiveVault(vault);
				return;
			}
			isActiveVault[vault] = true;
			activeVaultCount++;
			_appendActiveVault(vault);
			return;
		}
		if (!isActiveVault[vault]) return;
		_detachActiveVault(vault);
		delete isActiveVault[vault];
		activeVaultCount--;
	}

	function _appendActiveVault(address vault) private {
		if (latestActiveVault != address(0x0)) {
			olderActiveVaults[vault] = latestActiveVault;
			newerActiveVaults[latestActiveVault] = vault;
		}
		latestActiveVault = vault;
	}

	function _detachActiveVault(address vault) private {
		address olderVault = olderActiveVaults[vault];
		address newerVault = newerActiveVaults[vault];
		if (newerVault != address(0x0)) {
			olderActiveVaults[newerVault] = olderVault;
		} else {
			latestActiveVault = olderVault;
		}
		if (olderVault != address(0x0)) {
			newerActiveVaults[olderVault] = newerVault;
		}
		delete olderActiveVaults[vault];
		delete newerActiveVaults[vault];
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
		IERC20(address(repToken)).safeTransfer(msg.sender, repToken.balanceOf(address(this)));
	}

	function transferRep(address receiver, uint256 amount) external onlyForker {
		IERC20(address(repToken)).safeTransfer(receiver, amount);
	}

	function transferEth(address payable receiver, uint256 amount) external onlyForker {
		_sendEth(receiver, amount);
	}

	function _sendEth(address payable receiver, uint256 amount) private {
		(bool sent, ) = receiver.call{ value: amount }('');
		require(sent, 'send ETH failed');
	}

	function authorizeChildPool(ISecurityPool pool) external onlyForker {
		shareToken.authorize(pool);
	}

	receive() external payable {
		require(
			msg.sender == securityPoolForker || msg.sender == truthAuction || msg.sender == address(parent),
			'unauthorized sender'
		);
	}
}
