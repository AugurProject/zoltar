// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinator } from './OpenOraclePriceCoordinator.sol';
import {
	ISecurityPool,
	SecurityVault,
	PoolAccountingSnapshot,
	AccountingReason,
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
import { SecurityPoolEventEmitter } from './SecurityPoolEventEmitter.sol';

interface ISecurityPoolDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
}

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
	OpenOraclePriceCoordinator public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	EscalationGame public escalationGame;
	ZoltarQuestionData public immutable questionData;
	address public immutable securityPoolForker;
	address public immutable truthAuction;
	ISecurityPoolFactory public immutable securityPoolFactory;
	SecurityPoolEventEmitter private immutable eventEmitter;

	uint256 public totalSecurityBondAllowance;
	uint256 public completeSetCollateralAmount; // protocol-accounted ETH backing complete sets; raw balance can also contain fees or unsolicited surplus
	uint256 public poolOwnershipDenominator;
	uint256 public securityMultiplier;
	uint256 public shareTokenSupply;

	uint256 public totalFeesOwedToVaults;
	uint256 public lastUpdatedFeeAccumulator;
	uint256 public feeIndex;
	uint256 private feeIndexRemainder;
	// This carry is always below PRICE_PRECISION, so any residual value left here at the
	// end of accrual is strictly sub-wei and cannot strand whole ETH.
	uint256 private totalFeesOwedRemainder;
	uint256 private unallocatedFeeReserve;
	uint256 private feeEligibleSecurityBondAllowance;
	uint256 private uncheckpointedFeeEligibleAllowance;
	uint256 public currentRetentionRate;
	bool public awaitingForkContinuation;

	mapping(address => SecurityVault) public securityVaults;
	mapping(address => uint256) private vaultFeeRemainders;
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

	event PerformWithdrawRep(
		address indexed vault,
		uint256 amount,
		uint256 poolOwnership,
		uint256 poolOwnershipDenominator
	);
	event DepositRep(address indexed vault, uint256 repAmount, uint256 poolOwnership, uint256 poolOwnershipDenominator);
	event VaultLiquidated(
		address indexed callerVault,
		address indexed targetVault,
		uint256 securityBondAllowanceMoved,
		uint256 repAmountMoved
	);
	event RedeemRep(
		address indexed caller,
		address indexed vault,
		uint256 repAmount,
		uint256 poolOwnership,
		uint256 poolOwnershipDenominator
	);
	event DepositToEscalationGame(
		address indexed vault,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 depositedAmount,
		uint256 poolOwnershipEscrowed,
		uint256 poolOwnership,
		uint256 poolOwnershipDenominator,
		EscalationGame escalationGame
	);
	event PoolForkModeActivated(uint256 repTransferred, uint256 currentRetentionRate, SystemState systemState);
	event EscalationGameSet(EscalationGame escalationGame);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event SystemStateSet(SystemState systemState);
	event OwnershipDenominatorSet(uint256 poolOwnershipDenominator);
	event ShareTokenSupplySet(uint256 shareTokenSupply);

	modifier isOperational() {
		// Once a universe forks, the parent pool freezes operational flows permanently.
		// Outcome child pools can re-enter `SystemState.Operational` after migration and
		// truth-auction processing complete. Finalized claim paths keep their own state
		// and finality guards so late unrelated forks do not block share or REP redemption.
		require(zoltar.getForkTime(universeId) == 0, 'Forked');
		require(systemState == SystemState.Operational, 'Pool inactive');
		_;
	}

	modifier onlyValidOracle() {
		require(msg.sender == address(priceOracleManagerAndOperatorQueuer), 'Only coord');
		require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'Stale price');
		_;
	}

	modifier onlyForker() {
		require(msg.sender == securityPoolForker, 'Only forker');
		_;
	}

	constructor(
		address _securityPoolForker,
		ZoltarQuestionData _questionData,
		EscalationGameFactory _escalationGameFactory,
		OpenOraclePriceCoordinator _priceOracleManagerAndOperatorQueuer,
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
		ISecurityPoolDeploymentWorkerConfiguration worker = ISecurityPoolDeploymentWorkerConfiguration(msg.sender);
		securityPoolFactory = worker.factory();
		eventEmitter = worker.eventEmitter();
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

	function securityPoolEventEmitter() external view returns (address) {
		return address(eventEmitter);
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
		require(msg.sender == address(securityPoolFactory), 'Only factory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		completeSetCollateralAmount = _completeSetCollateralAmount;
		uint256 initialOraclePrice =
			address(parent) == address(0x0) ? 0 : parent.priceOracleManagerAndOperatorQueuer().lastPrice();
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(initialOraclePrice);
		_emitPoolAccountingCheckpoint(AccountingReason.PoolInitialization, address(0x0));
	}

	function updateCollateralAmount() public {
		uint256 forkTime = zoltar.getForkTime(universeId);
		uint256 endTime = questionData.getQuestionEndDate(questionId);
		uint256 feeEndDate = forkTime == 0 ? endTime : forkTime;
		uint256 clampedCurrentTimestamp = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;
		if (lastUpdatedFeeAccumulator > clampedCurrentTimestamp) return;
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;
		if (feeEligibleSecurityBondAllowance == 0) {
			_clearFeeIndexRemainder();
			lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;
			_emitPoolAccountingCheckpoint(AccountingReason.Accrual, address(0x0));
			return;
		}

		uint256 feeIndexDelta;
		uint256 creditedFees;
		(feeIndexDelta, feeIndexRemainder, creditedFees, totalFeesOwedRemainder) = SecurityPoolUtils
			.calculateFeeAccrual(
				completeSetCollateralAmount,
				currentRetentionRate,
				timeDelta,
				feeIndexRemainder,
				feeEligibleSecurityBondAllowance,
				totalFeesOwedRemainder
			);
		feeIndex += feeIndexDelta;
		if (feeIndexDelta > 0) uncheckpointedFeeEligibleAllowance = feeEligibleSecurityBondAllowance;
		unallocatedFeeReserve += creditedFees;
		completeSetCollateralAmount -= creditedFees;
		lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;

		_emitPoolAccountingCheckpoint(AccountingReason.Accrual, address(0x0));
	}

	function updateRetentionRate() public {
		if (totalSecurityBondAllowance == 0) return;
		if (systemState != SystemState.Operational) return; // if system state is not operational do not change fees
		uint256 nextRetentionRate = SecurityPoolUtils.calculateRetentionRate(
			completeSetCollateralAmount,
			totalSecurityBondAllowance
		);
		if (nextRetentionRate == currentRetentionRate) return;
		currentRetentionRate = nextRetentionRate;
		_emitPoolAccountingCheckpoint(AccountingReason.RetentionRateChange, address(0x0));
	}

	function totalAccruedFees() external view returns (uint256) {
		return totalFeesOwedToVaults + unallocatedFeeReserve;
	}

	function getPoolAccountingSnapshot() external view returns (PoolAccountingSnapshot memory) {
		assembly ('memory-safe') {
			let snapshot := mload(0x40)
			mstore(snapshot, sload(2))
			mstore(add(snapshot, 0x20), sload(1))
			mstore(add(snapshot, 0x40), sload(12))
			mstore(add(snapshot, 0x60), sload(6))
			mstore(add(snapshot, 0x80), sload(11))
			mstore(add(snapshot, 0xa0), sload(8))
			mstore(add(snapshot, 0xc0), sload(9))
			mstore(add(snapshot, 0xe0), sload(10))
			mstore(add(snapshot, 0x100), sload(13))
			mstore(add(snapshot, 0x120), sload(7))
			mstore(add(snapshot, 0x140), sload(14))
			return(snapshot, 0x160)
		}
	}

	function getVaultFeeRemainder(address vault) external view returns (uint256) {
		return vaultFeeRemainders[vault];
	}

	function _emitPoolAccountingCheckpoint(AccountingReason reason, address vault) private {
		_emitEvent(abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (reason, vault)));
	}

	function _emitVaultAccountingCheckpoint(address vault) private {
		_emitEvent(abi.encodeCall(SecurityPoolEventEmitter.emitVaultAccountingCheckpoint, (vault)));
	}

	function _emitEvent(bytes memory eventCall) private {
		(bool success, bytes memory returnData) = address(eventEmitter).delegatecall(eventCall);
		if (!success) {
			assembly ('memory-safe') {
				revert(add(returnData, 0x20), mload(returnData))
			}
		}
	}

	function updateVaultFees(address vault) public {
		updateCollateralAmount();
		uint256 previousVaultFeeIndex = securityVaults[vault].feeIndex;
		uint256 previousVaultFeeRemainder = vaultFeeRemainders[vault];
		(uint256 fees, uint256 nextRemainder) = SecurityPoolUtils.calculateVaultFee(
			securityVaults[vault].securityBondAllowance,
			feeIndex - securityVaults[vault].feeIndex,
			previousVaultFeeRemainder
		);
		bool vaultAccountingChanged =
			previousVaultFeeIndex != feeIndex || previousVaultFeeRemainder != nextRemainder || fees != 0;
		bool poolAccountingChanged = fees != 0;
		vaultFeeRemainders[vault] = nextRemainder;
		securityVaults[vault].feeIndex = feeIndex;
		if (previousVaultFeeIndex != feeIndex) {
			uint256 securityBondAllowance = securityVaults[vault].securityBondAllowance;
			uncheckpointedFeeEligibleAllowance -= securityBondAllowance;
			if (securityBondAllowance != 0) poolAccountingChanged = true;
		}
		unallocatedFeeReserve -= fees;
		totalFeesOwedToVaults += fees;
		securityVaults[vault].unpaidEthFees += fees;
		if (uncheckpointedFeeEligibleAllowance == 0 && systemState == SystemState.PoolForked) {
			if (unallocatedFeeReserve != 0) poolAccountingChanged = true;
			completeSetCollateralAmount += unallocatedFeeReserve;
			unallocatedFeeReserve = 0;
		}
		_syncActiveVault(vault);
		if (vaultAccountingChanged) _emitVaultAccountingCheckpoint(vault);
		if (poolAccountingChanged) _emitPoolAccountingCheckpoint(AccountingReason.VaultCheckpoint, vault);
	}

	function redeemFees(address vault) external {
		updateVaultFees(vault);
		uint256 fees = securityVaults[vault].unpaidEthFees;
		if (fees == 0) return;
		securityVaults[vault].unpaidEthFees = 0;
		totalFeesOwedToVaults -= fees;
		_syncActiveVault(vault);
		_emitVaultAccountingCheckpoint(vault);
		_emitPoolAccountingCheckpoint(AccountingReason.FeeRedemption, vault);
		_sendEth(payable(vault), fees);
	}

	function _clearFeeIndexRemainder() internal {
		// This carry is scoped to the allowance denominator that produced it.
		// Collateral already retains the undistributed value, so once allowance
		// ownership changes the old denominator-specific remainder must not be
		// attributed to the new allowance holders.
		feeIndexRemainder = 0;
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function performWithdrawRep(address vault, uint256 repAmount) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'Resolved');
		if (address(escalationGame) != address(0x0)) {
			require(escalationGame.escrowedRepByVault(vault) == 0, 'Escrow');
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
		require(oldRep >= withdrawRepAmount, 'Withdraw REP');
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		_requireVaultBondCoverage(oldRep - withdrawRepAmount, securityVaults[vault].securityBondAllowance, repEthPrice);
		_requirePoolBondCoverage(totalRepBalance - withdrawRepAmount, totalSecurityBondAllowance, repEthPrice);

		securityVaults[vault].poolOwnership -= withdrawOwnership;
		poolOwnershipDenominator -= withdrawOwnership;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, withdrawRepAmount);
		emit PerformWithdrawRep(
			vault,
			withdrawRepAmount,
			securityVaults[vault].poolOwnership,
			poolOwnershipDenominator
		);
		_emitVaultAccountingCheckpoint(vault);
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

	function _requireVaultBondCoverage(
		uint256 vaultRepAmount,
		uint256 securityBondAllowance,
		uint256 repEthPrice
	) private pure {
		require(
			vaultRepAmount * SecurityPoolUtils.PRICE_PRECISION >= securityBondAllowance * repEthPrice,
			'Vault bond'
		);
	}

	function _requirePoolBondCoverage(
		uint256 totalRepBalanceValue,
		uint256 totalSecurityBondAllowanceValue,
		uint256 repEthPrice
	) private pure {
		require(
			totalRepBalanceValue * SecurityPoolUtils.PRICE_PRECISION >= totalSecurityBondAllowanceValue * repEthPrice,
			'Pool bond'
		);
	}

	function _requireVaultAllowanceBackedByRep(
		uint256 vaultRepAmount,
		uint256 securityBondAllowance,
		uint256 repEthPrice
	) private pure {
		require(
			vaultRepAmount * SecurityPoolUtils.PRICE_PRECISION > securityBondAllowance * repEthPrice,
			'Vault allow'
		);
	}

	function _requirePoolAllowanceBackedByRep(
		uint256 totalRepBalanceValue,
		uint256 totalSecurityBondAllowanceValue,
		uint256 repEthPrice
	) private pure {
		require(
			totalRepBalanceValue * SecurityPoolUtils.PRICE_PRECISION > totalSecurityBondAllowanceValue * repEthPrice,
			'Pool allow'
		);
	}

	function _requireMinimumVaultRep(
		uint256 repAmount,
		bool allowZeroBalance,
		string memory errorMessage
	) private pure {
		require(repAmount >= SecurityPoolUtils.MIN_REP_DEPOSIT || (allowZeroBalance && repAmount == 0), errorMessage);
	}

	function _requireMinimumSecurityBondAllowance(
		uint256 amount,
		bool allowZeroBalance,
		string memory errorMessage
	) private pure {
		require(amount >= SecurityPoolUtils.MIN_SECURITY_BOND_DEBT || (allowZeroBalance && amount == 0), errorMessage);
	}

	function _requireCapacityNotExceeded(
		uint256 totalSecurityBondAllowanceValue,
		uint256 collateralAmount
	) private pure {
		require(totalSecurityBondAllowanceValue >= collateralAmount, 'Over capacity');
	}

	function sharesToCash(uint256 completeSetAmount) public view returns (uint256) {
		if (completeSetAmount == 0) return 0;
		if (shareTokenSupply == 0) return 0;
		return (completeSetAmount * completeSetCollateralAmount) / shareTokenSupply;
	}

	function cashToShares(uint256 eth) public view returns (uint256) {
		if (shareTokenSupply == 0) {
			require(completeSetCollateralAmount == 0, 'Exchange rate undefined');
			return eth * SecurityPoolUtils.PRICE_PRECISION;
		}
		require(completeSetCollateralAmount > 0, 'Exchange rate undefined');
		return (eth * shareTokenSupply) / completeSetCollateralAmount;
	}

	function depositRep(uint256 repAmount) external isOperational {
		require(!isEscalationResolved(), 'Resolved');
		uint256 poolOwnership = repToPoolOwnership(repAmount);
		IERC20(address(repToken)).safeTransferFrom(msg.sender, address(this), repAmount);
		_trackVault(msg.sender);
		securityVaults[msg.sender].poolOwnership += poolOwnership;
		poolOwnershipDenominator += poolOwnership;
		_requireMinimumVaultRep(
			poolOwnershipToRep(securityVaults[msg.sender].poolOwnership),
			false,
			'Vault REP below minimum'
		);
		_syncActiveVault(msg.sender);
		emit DepositRep(msg.sender, repAmount, securityVaults[msg.sender].poolOwnership, poolOwnershipDenominator);
		_emitVaultAccountingCheckpoint(msg.sender);
	}

	////////////////////////////////////////
	// liquidating vault
	////////////////////////////////////////
	//price = (amount1 * PRICE_PRECISION) / amount2;
	// price = REP * PRICE_PRECISION / ETH
	// Liquidation moves debt to the caller vault and seizes unlocked REP from the
	// target at a fixed bonus over market value, subject to the target and caller
	// minimum debt floors plus the minimum unlocked REP floor on the target.
	function performLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 debtAmount,
		uint256 snapshotTargetOwnership,
		uint256 snapshotTargetAllowance,
		uint256 snapshotTotalRep,
		uint256 snapshotDenominator
	) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'Resolved');
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
			'Target safe'
		);

		(uint256 debtToMove, uint256 repToMove, uint256 ownershipToMove) = SecurityPoolUtils
			.calculateLiquidationTransfer(
				snapshotTargetOwnership,
				snapshotTargetAllowance,
				snapshotTotalRep,
				snapshotDenominator,
				debtAmount,
				repEthPrice,
				securityVaults[targetVaultAddress].poolOwnership,
				getTotalRepBalance(),
				poolOwnershipDenominator
			);
		require(debtToMove > 0, 'No liq');
		require(
			debtToMove * securityMultiplier * repEthPrice > repToMove * SecurityPoolUtils.PRICE_PRECISION,
			'No gain'
		);
		require(
			(securityVaults[callerVault].securityBondAllowance + debtToMove) * securityMultiplier * repEthPrice <=
				poolOwnershipToRep(securityVaults[callerVault].poolOwnership + ownershipToMove) *
					SecurityPoolUtils.PRICE_PRECISION,
			'Caller bad'
		);

		// Update target's allowance based on snapshot to prevent blocking via allowance changes
		_clearFeeIndexRemainder();
		securityVaults[targetVaultAddress].securityBondAllowance = snapshotTargetAllowance - debtToMove;
		securityVaults[targetVaultAddress].poolOwnership -= ownershipToMove;
		securityVaults[callerVault].securityBondAllowance += debtToMove;
		securityVaults[callerVault].poolOwnership += ownershipToMove;

		// target vault needs to be above thresholds after liquidation
		_requireMinimumVaultRep(
			poolOwnershipToRep(securityVaults[targetVaultAddress].poolOwnership),
			securityVaults[targetVaultAddress].poolOwnership == 0 &&
				securityVaults[targetVaultAddress].securityBondAllowance == 0,
			'Target REP'
		);
		_requireMinimumSecurityBondAllowance(
			securityVaults[targetVaultAddress].securityBondAllowance,
			securityVaults[targetVaultAddress].securityBondAllowance == 0,
			'Target debt'
		);
		_requireMinimumVaultRep(poolOwnershipToRep(securityVaults[callerVault].poolOwnership), false, 'Caller REP');
		_requireMinimumSecurityBondAllowance(securityVaults[callerVault].securityBondAllowance, false, 'Caller debt');
		_syncActiveVault(targetVaultAddress);
		_syncActiveVault(callerVault);

		emit VaultLiquidated(callerVault, targetVaultAddress, debtToMove, repToMove);
		_emitVaultAccountingCheckpoint(targetVaultAddress);
		_emitVaultAccountingCheckpoint(callerVault);
		_emitPoolAccountingCheckpoint(AccountingReason.AllowanceChange, callerVault);
	}

	////////////////////////////////////////
	// set security bond allowance
	////////////////////////////////////////

	function performSetSecurityBondsAllowance(
		address callerVault,
		uint256 amount
	) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'Resolved');
		updateVaultFees(callerVault);

		uint256 oldAllowance = securityVaults[callerVault].securityBondAllowance;
		_clearFeeIndexRemainder();
		totalSecurityBondAllowance += amount;
		totalSecurityBondAllowance -= oldAllowance;
		feeEligibleSecurityBondAllowance += amount;
		feeEligibleSecurityBondAllowance -= oldAllowance;
		securityVaults[callerVault].securityBondAllowance = amount;

		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		_requireVaultAllowanceBackedByRep(
			poolOwnershipToRep(securityVaults[callerVault].poolOwnership),
			amount,
			repEthPrice
		);
		_requirePoolAllowanceBackedByRep(getTotalRepBalance(), totalSecurityBondAllowance, repEthPrice);
		_requireCapacityNotExceeded(totalSecurityBondAllowance, completeSetCollateralAmount);
		_requireMinimumSecurityBondAllowance(amount, amount == 0, 'Bond min');
		_syncActiveVault(callerVault);
		updateRetentionRate();
		_emitVaultAccountingCheckpoint(callerVault);
		_emitPoolAccountingCheckpoint(AccountingReason.AllowanceChange, callerVault);
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() external payable isOperational {
		// Child pools mint complete sets only after migration and truth-auction
		// accounting have restored `SystemState.Operational`.
		require(!awaitingForkContinuation, 'Fork await');
		require(msg.value > 0 && !isEscalationResolved(), 'Resolved');
		updateCollateralAmount();
		uint256 completeSetsToMint = cashToShares(msg.value);
		require(completeSetsToMint > 0, 'Exchange rate undefined');
		uint256 nextCompleteSetCollateralAmount = completeSetCollateralAmount + msg.value;
		_requireCapacityNotExceeded(totalSecurityBondAllowance, nextCompleteSetCollateralAmount);
		shareTokenSupply += completeSetsToMint;
		completeSetCollateralAmount = nextCompleteSetCollateralAmount;
		emit CompleteSetCreated(
			msg.sender,
			msg.value,
			completeSetsToMint,
			shareTokenSupply,
			completeSetCollateralAmount
		);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMint);
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
		emit CompleteSetRedeemed(
			msg.sender,
			completeSetAmount,
			ethValue,
			shareTokenSupply,
			completeSetCollateralAmount
		);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(payable(msg.sender), ethValue);
	}

	function redeemShares() external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		updateCollateralAmount();
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		(uint256 amount, uint256 remainingWinningShareSupply) = shareToken.burnTokenIdAndGetRemainingSupply(
			tokenId,
			msg.sender
		);
		uint256 winningShareSupply = remainingWinningShareSupply + amount;
		uint256 ethValue = winningShareSupply == 0 ? 0 : (amount * completeSetCollateralAmount) / winningShareSupply;
		shareTokenSupply = remainingWinningShareSupply;
		completeSetCollateralAmount -= ethValue;
		emit SharesRedeemed(msg.sender, amount, ethValue, shareTokenSupply, completeSetCollateralAmount);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(payable(msg.sender), ethValue);
	}

	function redeemRep(address vault) external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(
			ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this) != BinaryOutcomes.BinaryOutcome.None,
			'Question open'
		);
		uint256 escrowedRep = address(escalationGame) == address(0x0) ? 0 : escalationGame.escrowedRepByVault(vault);
		require(escrowedRep == 0, 'Escrow locked');
		updateVaultFees(vault);
		uint256 vaultOwnership = securityVaults[vault].poolOwnership;
		uint256 ownershipToRedeem = vaultOwnership;
		uint256 repAmount = poolOwnershipToRep(ownershipToRedeem);
		require(repAmount > 0, 'No redeemable REP');
		securityVaults[vault].poolOwnership = 0;
		poolOwnershipDenominator -= ownershipToRedeem;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, repAmount);
		emit RedeemRep(msg.sender, vault, repAmount, securityVaults[vault].poolOwnership, poolOwnershipDenominator);
		_emitVaultAccountingCheckpoint(vault);
	}

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		require(withdrawalOutcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome');

		EscalationGame escalationGameContract = EscalationGame(payable(address(escalationGame)));
		address beneficiaryVault = address(0x0);
		for (uint256 index = 0; index < proofs.length; index++) {
			address depositor;
			(depositor, , ) = escalationGameContract.withdrawDeposit(proofs[index], withdrawalOutcome);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'One vault');
		}
		_syncActiveVault(beneficiaryVault);
	}

	////////////////////////////////////////
	// Escalation Game (migrate vault (oi+rep), truth truthAuction)
	////////////////////////////////////////

	function depositToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maxAmount) external isOperational {
		require(!awaitingForkContinuation, 'Fork await');
		if (address(escalationGame) == address(0x0)) {
			uint256 endTime = questionData.getQuestionEndDate(questionId);
			require(block.timestamp > endTime, 'Question active');
			escalationGame = escalationGameFactory.deployEscalationGame(
				initialEscalationGameDeposit,
				zoltar.getForkThreshold(universeId) / 2
			);
			emit EscalationGameSet(escalationGame);
		} else {
			require(!escalationGame.forkContinuation() || escalationGame.forkResumedAt() != 0, 'Fork paused');
		}

		(uint256 depositedAmount, uint256 resultingCumulativeAmount) = escalationGame.previewDepositOnOutcome(
			outcome,
			maxAmount
		);
		require(depositedAmount > 0, 'No escalation deposit');
		if (totalSecurityBondAllowance > 0) {
			require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'Stale price');
		}
		uint256 ownershipToEscrow = repToPoolOwnershipRoundUp(depositedAmount);
		uint256 currentRep = poolOwnershipToRep(securityVaults[msg.sender].poolOwnership);
		require(currentRep >= depositedAmount, 'REP too low');
		require(ownershipToEscrow > 0, 'Escrow too low');

		uint256 updatedPoolOwnership = securityVaults[msg.sender].poolOwnership - ownershipToEscrow;
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 postTransferRepBalance = getTotalRepBalance() - depositedAmount;
		uint256 postTransferPoolOwnershipDenominator = poolOwnershipDenominator - ownershipToEscrow;
		uint256 remainingRep =
			updatedPoolOwnership == 0
				? 0
				: (updatedPoolOwnership * postTransferRepBalance) / postTransferPoolOwnershipDenominator;
		_requireVaultBondCoverage(remainingRep, securityVaults[msg.sender].securityBondAllowance, repEthPrice);
		_requirePoolBondCoverage(postTransferRepBalance, totalSecurityBondAllowance, repEthPrice);
		_requireMinimumVaultRep(remainingRep, updatedPoolOwnership == 0, 'Vault REP below minimum');
		securityVaults[msg.sender].poolOwnership = updatedPoolOwnership;
		poolOwnershipDenominator = postTransferPoolOwnershipDenominator;
		IERC20(address(repToken)).safeTransfer(address(escalationGame), depositedAmount);
		escalationGame.recordDepositFromSecurityPool(msg.sender, outcome, depositedAmount, resultingCumulativeAmount);
		_syncActiveVault(msg.sender);
		emit DepositToEscalationGame(
			msg.sender,
			outcome,
			depositedAmount,
			ownershipToEscrow,
			securityVaults[msg.sender].poolOwnership,
			poolOwnershipDenominator,
			escalationGame
		);
		_emitVaultAccountingCheckpoint(msg.sender);
	}

	function withdrawFromEscalationGame(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256[] calldata depositIndexes
	) external {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Invalid outcome');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(this);
		uint256 forkTime = zoltar.getForkTime(universeId);
		if (
			forkTime > 0 &&
			forkTime < escalationGame.getEscalationGameEndDate() &&
			!escalationGame.hasReachedNonDecision()
		) {
			revert('Migrate deposits first');
		}
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		address beneficiaryVault = address(0x0);
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			address depositor;
			(depositor, , ) = escalationGame.withdrawDeposit(depositIndexes[index], outcome);
			if (beneficiaryVault == address(0x0)) {
				beneficiaryVault = depositor;
			}
			require(depositor == beneficiaryVault, 'One vault');
		}
		_syncActiveVault(beneficiaryVault);
	}

	function activateForkMode() external onlyForker {
		systemState = SystemState.PoolForked;
		updateCollateralAmount();
		uint256 repTransferred = repToken.balanceOf(address(this));
		IERC20(address(repToken)).safeTransfer(msg.sender, repTransferred);
		emit PoolForkModeActivated(repTransferred, currentRetentionRate, systemState);
		_emitPoolAccountingCheckpoint(AccountingReason.ForkActivation, address(0x0));
	}

	function initializeForkedEscalationGame(
		uint256 startBond,
		uint256 nonDecisionThreshold,
		uint256 elapsedAtFork
	) external onlyForker {
		require(address(escalationGame) == address(0x0), 'Game set');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(
			startBond,
			nonDecisionThreshold,
			elapsedAtFork
		);
		emit EscalationGameSet(escalationGame);
	}

	function initializeForkCarrySnapshotWithResolutionBalances(
		address sourceGame,
		bytes32 snapshotId,
		bytes32[64][3] memory inheritedCarryPeaks,
		uint256[3] memory inheritedCarryLeafCounts,
		uint256[3] memory inheritedCarryTotals,
		uint256[3] memory inheritedResolutionBalances,
		bytes32[3] memory inheritedNullifierRoots
	) external onlyForker {
		require(address(escalationGame) != address(0x0), 'Game missing');
		EscalationGame(payable(address(escalationGame))).initializeForkCarrySnapshotWithResolutionBalances(
			sourceGame,
			snapshotId,
			inheritedCarryPeaks,
			inheritedCarryLeafCounts,
			inheritedCarryTotals,
			inheritedResolutionBalances,
			inheritedNullifierRoots
		);
	}

	function resumeForkedEscalationGame() external onlyForker {
		require(address(escalationGame) != address(0x0), 'Game missing');
		escalationGame.resumeFromFork();
	}

	function setAwaitingForkContinuation(bool shouldAwait) external onlyForker {
		awaitingForkContinuation = shouldAwait;
		emit AwaitingForkContinuationSet(awaitingForkContinuation);
	}

	function setSystemState(SystemState newState) external onlyForker {
		systemState = newState;
		emit SystemStateSet(systemState);
	}

	function configureVault(
		address vault,
		uint256 poolOwnership,
		uint256 securityBondAllowance,
		uint256 vaultFeeIndex
	) external onlyForker {
		require(vault != address(0x0), 'Zero vault');
		_trackVault(vault);
		securityVaults[vault].poolOwnership = poolOwnership;
		if (securityVaults[vault].securityBondAllowance != securityBondAllowance) {
			_clearFeeIndexRemainder();
		}
		securityVaults[vault].securityBondAllowance = securityBondAllowance;
		securityVaults[vault].feeIndex = vaultFeeIndex;
		_syncActiveVault(vault);
		_emitVaultAccountingCheckpoint(vault);
		_emitPoolAccountingCheckpoint(AccountingReason.AllowanceChange, vault);
	}

	function addFeeEligibleSecurityBondAllowance(address vault, uint256 amount) external onlyForker {
		feeEligibleSecurityBondAllowance += amount;
		require(feeEligibleSecurityBondAllowance <= totalSecurityBondAllowance, 'Fee allowance high');
		_clearFeeIndexRemainder();
		_emitVaultAccountingCheckpoint(vault);
		_emitPoolAccountingCheckpoint(AccountingReason.AuctionClaim, vault);
	}

	function _trackVault(address vault) private {
		require(vault != address(0x0), 'Zero vault');
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
		emit OwnershipDenominatorSet(poolOwnershipDenominator);
	}

	function setTotalShares(uint256 newTotalShares) external onlyForker {
		shareTokenSupply = newTotalShares;
		emit ShareTokenSupplySet(shareTokenSupply);
	}

	function setPoolFinancials(
		uint256 newCollateral,
		uint256 newTotalBondAllowance,
		uint256 newFeeEligibleBondAllowance
	) external onlyForker {
		require(newTotalBondAllowance >= newCollateral, 'Bond low');
		require(newFeeEligibleBondAllowance <= newTotalBondAllowance, 'Fee allowance high');
		completeSetCollateralAmount = newCollateral;
		totalSecurityBondAllowance = newTotalBondAllowance;
		feeEligibleSecurityBondAllowance = newFeeEligibleBondAllowance;
		lastUpdatedFeeAccumulator = block.timestamp;
		_clearFeeIndexRemainder();
		_emitPoolAccountingCheckpoint(AccountingReason.ForkFinalization, address(0x0));
	}

	function transferEth(address payable receiver, uint256 amount) external onlyForker {
		uint256 feeLiabilities = totalFeesOwedToVaults + unallocatedFeeReserve;
		require(
			feeLiabilities <= address(this).balance &&
				amount <= address(this).balance - feeLiabilities &&
				amount <= completeSetCollateralAmount,
			'Collateral low'
		);
		completeSetCollateralAmount -= amount;
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(receiver, amount);
	}

	function _sendEth(address payable receiver, uint256 amount) private {
		(bool sent, ) = receiver.call{ value: amount }('');
		require(sent, 'ETH failed');
	}

	function authorizeChildPool(ISecurityPool pool) external onlyForker {
		shareToken.authorize(pool);
	}

	receive() external payable {
		require(
			msg.sender == securityPoolForker || msg.sender == truthAuction || msg.sender == address(parent),
			'Bad ETH sender'
		);
	}
}
