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
import { SecurityPoolStorage } from './SecurityPoolStorage.sol';
import { SecurityPoolLiquidationDelegate } from './SecurityPoolLiquidationDelegate.sol';

interface ISecurityPoolDeploymentWorkerConfiguration {
	function factory() external view returns (ISecurityPoolFactory);
	function eventEmitter() external view returns (SecurityPoolEventEmitter);
}

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is SecurityPoolStorage {
	using SafeERC20Ops for IERC20;
	event PoolAccountingCheckpoint(
		AccountingReason reason,
		address indexed vault,
		uint256 settlementCollateralAttoEth,
		uint256 totalCoverageCommitmentAttoEth,
		uint256 feeEligibleCoverageCommitmentAttoEth,
		uint256 totalClaimableVaultFeesAttoEth,
		uint256 unallocatedAccruedFeesAttoEth,
		uint256 feeIndex,
		uint256 feeIndexRemainder,
		uint256 totalFeesOwedRemainder,
		uint256 uncheckpointedFeeEligibleCoverageCommitmentAttoEth,
		uint256 lastUpdatedFeeAccumulator,
		uint256 currentRetentionRate
	);
	event VaultAccountingCheckpoint(
		address indexed vault,
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 claimableFeesAttoEth,
		uint256 feeIndex,
		uint256 vaultFeeRemainder,
		uint256 resultingTotalRepBackingUnits,
		uint256 resultingFeeEligibleCoverageCommitmentAttoEth
	);

	uint256 public immutable questionId;
	uint248 public immutable universeId;
	uint256 public immutable initialEscalationGameDepositAttoRep;

	Zoltar public immutable zoltar;
	ISecurityPool public immutable parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	OpenOraclePriceCoordinator public immutable priceOracleManagerAndOperatorQueuer;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	ZoltarQuestionData public immutable questionData;
	address public immutable securityPoolForker;
	address public immutable truthAuction;
	ISecurityPoolFactory public immutable securityPoolFactory;
	bool private immutable hasInheritedForkOutcome;
	SecurityPoolEventEmitter private immutable eventEmitter;
	address private immutable liquidationDelegate;
	// settlementCollateralAttoEth is protocol-accounted ETH backing complete sets;
	// the raw balance can also contain fees or unsolicited surplus.
	// Remaining per-outcome economic claims. After a fork this includes both
	// materialized child ERC-1155 balances and source entitlements that can still
	// materialize in this branch.
	// This carry is always below PRICE_PRECISION, so any residual value left here at the
	// end of accrual is strictly sub-attoETH and cannot strand whole ETH.
	// Active-vault paging is newest-first so UI previews remain stable after removals
	// and can intentionally surface the most recently touched active vaults.

	event RepWithdrawnFromVault(
		address indexed vault,
		uint256 amountAttoRep,
		uint256 repBackingUnits,
		uint256 totalRepBackingUnits
	);
	event RepDepositedToVault(
		address indexed vault,
		uint256 attoRepAmount,
		uint256 repBackingUnits,
		uint256 totalRepBackingUnits
	);
	event VaultLiquidated(
		address indexed callerVault,
		address indexed targetVault,
		uint256 coverageCommitmentTransferredAttoEth,
		uint256 vaultRepBackingTransferredAttoRep
	);
	event VaultBadDebtRecorded(
		address indexed targetVault,
		uint256 badDebtAttoEth,
		uint256 resultingVaultBadDebtAttoEth,
		uint256 resultingTotalBadDebtAttoEth
	);
	event RepRedeemedFromVault(
		address indexed caller,
		address indexed vault,
		uint256 attoRepAmount,
		uint256 repBackingUnits,
		uint256 totalRepBackingUnits
	);
	event DepositToEscalationGame(
		address indexed vault,
		BinaryOutcomes.BinaryOutcome indexed outcome,
		uint256 depositedAmountAttoRep,
		uint256 backingUnitsEscrowed,
		uint256 repBackingUnits,
		uint256 totalRepBackingUnits,
		EscalationGame escalationGame
	);
	event PoolForkModeActivated(uint256 repTransferredAttoRep, uint256 currentRetentionRate, SystemState systemState);
	event EscalationGameSet(EscalationGame escalationGame);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event SystemStateSet(SystemState systemState);
	event TotalRepBackingUnitsSet(uint256 totalRepBackingUnits);
	event ShareTokenSupplySet(uint256 shareTokenSupplyAttoShares);
	event CompleteSetCreated(
		address indexed creator,
		uint256 settlementCollateralProvidedAttoEth,
		uint256 completeSetsMintedAttoShares,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);
	event CompleteSetRedeemed(
		address indexed redeemer,
		uint256 completeSetsBurnedAttoShares,
		uint256 settlementCollateralRedeemedAttoEth,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);
	event SharesRedeemed(
		address indexed redeemer,
		uint256 winningSharesBurnedAttoShares,
		uint256 settlementCollateralRedeemedAttoEth,
		uint256 resultingShareTokenSupplyAttoShares,
		uint256 resultingSettlementCollateralAttoEth
	);

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
		uint256 _statoblastSecurityMultiplierBps,
		uint256 _initialEscalationGameDepositAttoRep,
		address _truthAuction
	) {
		universeId = _universeId;
		ISecurityPoolDeploymentWorkerConfiguration worker = ISecurityPoolDeploymentWorkerConfiguration(msg.sender);
		securityPoolFactory = worker.factory();
		eventEmitter = worker.eventEmitter();
		liquidationDelegate = address(new SecurityPoolLiquidationDelegate());
		questionId = _questionId;
		statoblastSecurityMultiplierBps = _statoblastSecurityMultiplierBps;
		initialEscalationGameDepositAttoRep = _initialEscalationGameDepositAttoRep;
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
			hasInheritedForkOutcome =
				securityPoolFactory.getSecurityPoolHasInheritedForkOutcome(parent) ||
				zoltar.forkQuestionMatches(parent.universeId(), questionId);
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
		return
			ISecurityPoolForker(securityPoolForker).getQuestionOutcome(ISecurityPool(payable(address(this)))) !=
			BinaryOutcomes.BinaryOutcome.None;
	}

	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external {
		if (msg.sender != address(escalationGame)) revert();
		zoltar.burnRep(universeId, amountAttoRep);
	}

	function setStartingParams(uint256 _currentRetentionRate, uint256 _settlementCollateralAttoEth) external {
		require(msg.sender == address(securityPoolFactory), 'Only factory');
		lastUpdatedFeeAccumulator = block.timestamp;
		currentRetentionRate = _currentRetentionRate;
		settlementCollateralAttoEth = _settlementCollateralAttoEth;
		uint256 initialOraclePrice =
			address(parent) == address(0x0) ? 0 : parent.priceOracleManagerAndOperatorQueuer().lastPrice();
		priceOracleManagerAndOperatorQueuer.setRepEthPrice(initialOraclePrice);
		_emitPoolAccountingCheckpoint(AccountingReason.PoolInitialization, address(0x0));
	}

	function updateSettlementCollateral() public {
		uint256 forkTime = zoltar.getForkTime(universeId);
		uint256 endTime = questionData.getQuestionEndDate(questionId);
		uint256 feeEndDate = forkTime == 0 ? endTime : forkTime;
		uint256 clampedCurrentTimestamp = block.timestamp > feeEndDate ? feeEndDate : block.timestamp;
		if (lastUpdatedFeeAccumulator > clampedCurrentTimestamp) return;
		uint256 timeDelta = clampedCurrentTimestamp - lastUpdatedFeeAccumulator;
		if (timeDelta == 0) return;
		if (feeEligibleCoverageCommitmentAttoEth == 0) {
			_clearFeeIndexRemainder();
			lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;
			_emitPoolAccountingCheckpoint(AccountingReason.Accrual, address(0x0));
			return;
		}

		uint256 feeIndexDelta;
		uint256 creditedFeesAttoEth;
		(feeIndexDelta, feeIndexRemainder, creditedFeesAttoEth, totalFeesOwedRemainder) = SecurityPoolUtils
			.calculateFeeAccrual(
				settlementCollateralAttoEth,
				currentRetentionRate,
				timeDelta,
				feeIndexRemainder,
				feeEligibleCoverageCommitmentAttoEth,
				totalFeesOwedRemainder
			);
		feeIndex += feeIndexDelta;
		if (feeIndexDelta > 0)
			uncheckpointedFeeEligibleCoverageCommitmentAttoEth = feeEligibleCoverageCommitmentAttoEth;
		unallocatedAccruedFeesAttoEth += creditedFeesAttoEth;
		settlementCollateralAttoEth -= creditedFeesAttoEth;
		lastUpdatedFeeAccumulator = feeEndDate < block.timestamp ? feeEndDate : block.timestamp;

		_emitPoolAccountingCheckpoint(AccountingReason.Accrual, address(0x0));
	}

	function updateRetentionRate() public {
		if (systemState != SystemState.Operational) return; // if system state is not operational do not change fees
		uint256 nextRetentionRate = SecurityPoolUtils.calculateRetentionRate(
			settlementCollateralAttoEth,
			feeEligibleCoverageCommitmentAttoEth
		);
		if (nextRetentionRate == currentRetentionRate) return;
		currentRetentionRate = nextRetentionRate;
		_emitPoolAccountingCheckpoint(AccountingReason.RetentionRateChange, address(0x0));
	}

	function totalAccruedFeesAttoEth() external view returns (uint256) {
		return totalClaimableVaultFeesAttoEth + unallocatedAccruedFeesAttoEth;
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
		updateSettlementCollateral();
		uint256 previousVaultFeeIndex = securityVaults[vault].feeIndex;
		uint256 previousVaultFeeRemainder = vaultFeeRemainders[vault];
		(uint256 fees, uint256 nextRemainder) = SecurityPoolUtils.calculateVaultFee(
			securityVaults[vault].coverageCommitmentAttoEth,
			feeIndex - securityVaults[vault].feeIndex,
			previousVaultFeeRemainder
		);
		bool vaultAccountingChanged =
			previousVaultFeeIndex != feeIndex || previousVaultFeeRemainder != nextRemainder || fees != 0;
		bool poolAccountingChanged = fees != 0;
		vaultFeeRemainders[vault] = nextRemainder;
		securityVaults[vault].feeIndex = feeIndex;
		if (previousVaultFeeIndex != feeIndex) {
			uint256 coverageCommitmentAttoEth = securityVaults[vault].coverageCommitmentAttoEth;
			uncheckpointedFeeEligibleCoverageCommitmentAttoEth -= coverageCommitmentAttoEth;
			if (coverageCommitmentAttoEth != 0) poolAccountingChanged = true;
		}
		unallocatedAccruedFeesAttoEth -= fees;
		totalClaimableVaultFeesAttoEth += fees;
		securityVaults[vault].claimableFeesAttoEth += fees;
		if (uncheckpointedFeeEligibleCoverageCommitmentAttoEth == 0 && systemState == SystemState.PoolForked) {
			if (unallocatedAccruedFeesAttoEth != 0) poolAccountingChanged = true;
			settlementCollateralAttoEth += unallocatedAccruedFeesAttoEth;
			unallocatedAccruedFeesAttoEth = 0;
		}
		_syncActiveVault(vault);
		if (vaultAccountingChanged) _emitVaultAccountingCheckpoint(vault);
		if (poolAccountingChanged) _emitPoolAccountingCheckpoint(AccountingReason.VaultCheckpoint, vault);
	}

	function redeemFees(address vault) external {
		updateVaultFees(vault);
		uint256 fees = securityVaults[vault].claimableFeesAttoEth;
		if (fees == 0) return;
		securityVaults[vault].claimableFeesAttoEth = 0;
		totalClaimableVaultFeesAttoEth -= fees;
		_syncActiveVault(vault);
		_emitVaultAccountingCheckpoint(vault);
		_emitPoolAccountingCheckpoint(AccountingReason.FeeRedemption, vault);
		_sendEth(payable(vault), fees);
	}

	function _clearFeeIndexRemainder() internal {
		// This carry is scoped to the coverage-commitment denominator that produced it.
		// Settlement collateral already retains the undistributed value, so once coverage commitment
		// backingUnits changes the old denominator-specific remainder must not be
		// attributed to the newly eligible vaults.
		feeIndexRemainder = 0;
	}

	////////////////////////////////////////
	// withdrawing rep
	////////////////////////////////////////

	function withdrawRepFromVault(address vault, uint256 attoRepAmount) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'Resolved');
		if (address(escalationGame) != address(0x0)) {
			require(escalationGame.disputeStakedRepByVaultAttoRep(vault) == 0, 'Escrow');
		}
		uint256 backingUnitsToWithdraw = attoRepToBackingUnits(attoRepAmount);
		uint256 withdrawBackingUnits =
			backingUnitsToWithdraw + attoRepToBackingUnits(SecurityPoolUtils.MIN_REP_DEPOSIT_ATTO_REP) >
				securityVaults[vault].repBackingUnits
				? securityVaults[vault].repBackingUnits
				: backingUnitsToWithdraw;
		uint256 withdrawRepAmountAttoRep = backingUnitsToAttoRep(withdrawBackingUnits);
		uint256 totalPoolHeldRepBalanceAttoRep = getTotalPoolHeldAttoRep();

		uint256 previousVaultRepBackingAttoRep = backingUnitsToAttoRep(securityVaults[vault].repBackingUnits);
		require(previousVaultRepBackingAttoRep >= withdrawRepAmountAttoRep, 'Withdraw REP');
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 vaultDisputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		_requireVaultCoverage(
			previousVaultRepBackingAttoRep - withdrawRepAmountAttoRep,
			vaultDisputeStakedAttoRep,
			securityVaults[vault].coverageCommitmentAttoEth,
			repEthPrice
		);
		_requirePoolCoverage(
			totalPoolHeldRepBalanceAttoRep - withdrawRepAmountAttoRep,
			_getTotalDisputeStakedRep(),
			totalCoverageCommitmentAttoEth,
			repEthPrice
		);

		securityVaults[vault].repBackingUnits -= withdrawBackingUnits;
		totalRepBackingUnits -= withdrawBackingUnits;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, withdrawRepAmountAttoRep);
		emit RepWithdrawnFromVault(
			vault,
			withdrawRepAmountAttoRep,
			securityVaults[vault].repBackingUnits,
			totalRepBackingUnits
		);
		_emitVaultAccountingCheckpoint(vault);
	}

	function attoRepToBackingUnits(uint256 attoRepAmount) public view returns (uint256) {
		uint256 totalPoolHeldRepBalanceAttoRep = getTotalPoolHeldAttoRep();
		if (totalRepBackingUnits == 0 || totalPoolHeldRepBalanceAttoRep == 0)
			return attoRepAmount * SecurityPoolUtils.PRICE_PRECISION;
		return (attoRepAmount * totalRepBackingUnits) / totalPoolHeldRepBalanceAttoRep;
	}

	function attoRepToBackingUnitsRoundUp(uint256 attoRepAmount) public view returns (uint256) {
		uint256 totalPoolHeldRepBalanceAttoRep = getTotalPoolHeldAttoRep();
		if (totalRepBackingUnits == 0 || totalPoolHeldRepBalanceAttoRep == 0)
			return attoRepAmount * SecurityPoolUtils.PRICE_PRECISION;
		uint256 numerator = attoRepAmount * totalRepBackingUnits;
		if (numerator == 0) return 0;
		return (numerator - 1) / totalPoolHeldRepBalanceAttoRep + 1;
	}

	function backingUnitsToAttoRep(uint256 repBackingUnits) public view returns (uint256) {
		if (totalRepBackingUnits == 0) return 0;
		return (repBackingUnits * getTotalPoolHeldAttoRep()) / totalRepBackingUnits;
	}

	function getTotalPoolHeldAttoRep() public view returns (uint256) {
		return repToken.balanceOf(address(this));
	}

	function _getTotalDisputeStakedRep() private view returns (uint256) {
		return address(escalationGame) == address(0x0) ? 0 : escalationGame.totalDisputeStakedAttoRep();
	}

	function _requireVaultCoverage(
		uint256 poolHeldVaultRepBackingAttoRep,
		uint256 disputeStakedRepAmountAttoRep,
		uint256 coverageCommitmentAttoEth,
		uint256 repEthPrice
	) private view {
		require(
			SecurityPoolUtils.isVaultHealthy(
				poolHeldVaultRepBackingAttoRep,
				disputeStakedRepAmountAttoRep,
				coverageCommitmentAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Vault backing insufficient'
		);
	}

	function _requirePoolCoverage(
		uint256 totalPoolHeldAttoRep,
		uint256 totalDisputeStakedAttoRep,
		uint256 totalCoverageCommitmentAttoEthValue,
		uint256 repEthPrice
	) private view {
		if (
			!SecurityPoolUtils.isVaultHealthy(
				totalPoolHeldAttoRep,
				totalDisputeStakedAttoRep,
				totalCoverageCommitmentAttoEthValue,
				repEthPrice,
				statoblastSecurityMultiplierBps
			)
		) revert();
	}

	function _requireMinimumVaultRep(
		uint256 attoRepAmount,
		bool allowZeroBalance,
		string memory errorMessage
	) private pure {
		require(
			attoRepAmount >= SecurityPoolUtils.MIN_REP_DEPOSIT_ATTO_REP ||
				(allowZeroBalance && attoRepAmount == 0),
			errorMessage
		);
	}

	function _requireMinimumCoverageCommitmentAttoEth(
		uint256 amountAttoEth,
		bool allowZeroBalance,
		string memory errorMessage
	) private pure {
		require(
			amountAttoEth >= SecurityPoolUtils.MIN_COVERAGE_COMMITMENT_ATTO_ETH ||
				(allowZeroBalance && amountAttoEth == 0),
			errorMessage
		);
	}

	function _requireCapacityNotExceeded(
		uint256 totalCoverageCommitmentAttoEthValue,
		uint256 settlementCollateralAttoEthValue
	) private pure {
		require(totalCoverageCommitmentAttoEthValue >= settlementCollateralAttoEthValue, 'Over capacity');
	}

	function attoSharesToAttoEth(uint256 amountAttoShares) public view returns (uint256) {
		if (amountAttoShares == 0) return 0;
		if (shareTokenSupplyAttoShares == 0) return 0;
		return (amountAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares;
	}

	function attoEthToAttoShares(uint256 amountAttoEth) public view returns (uint256) {
		if (shareTokenSupplyAttoShares == 0) {
			require(settlementCollateralAttoEth == 0, 'Exchange rate undefined');
			return amountAttoEth * SecurityPoolUtils.PRICE_PRECISION;
		}
		require(settlementCollateralAttoEth > 0, 'Exchange rate undefined');
		return (amountAttoEth * shareTokenSupplyAttoShares) / settlementCollateralAttoEth;
	}

	function depositRepToVault(uint256 attoRepAmount) external isOperational {
		require(!isEscalationResolved(), 'Resolved');
		uint256 repBackingUnits = attoRepToBackingUnits(attoRepAmount);
		IERC20(address(repToken)).safeTransferFrom(msg.sender, address(this), attoRepAmount);
		_trackVault(msg.sender);
		securityVaults[msg.sender].repBackingUnits += repBackingUnits;
		totalRepBackingUnits += repBackingUnits;
		_requireMinimumVaultRep(
			backingUnitsToAttoRep(securityVaults[msg.sender].repBackingUnits),
			false,
			'Vault REP below minimum'
		);
		_syncActiveVault(msg.sender);
		emit RepDepositedToVault(
			msg.sender,
			attoRepAmount,
			securityVaults[msg.sender].repBackingUnits,
			totalRepBackingUnits
		);
		_emitVaultAccountingCheckpoint(msg.sender);
	}

	////////////////////////////////////////
	// liquidating vault
	////////////////////////////////////////
	//price = (amount1 * PRICE_PRECISION) / amount2;
	// price = REP * PRICE_PRECISION / ETH
	// Liquidation transfers only coverage commitment whose complete 5%-bonus award is funded by
	// target vault REP backing. Earned fees and dispute-staked REP stay with the target. A maximum
	// request records any uncovered remainder as realized bad debt, denominated in attoETH and borne
	// by the target vault and pool as a non-recoverable accounting writeoff.
	function performLiquidation(
		address callerVault,
		address targetVaultAddress,
		uint256 requestedCommitmentTransferAttoEth,
		uint256 snapshotTargetBackingUnits,
		uint256 snapshotTargetCoverageCommitmentAttoEth,
		uint256 snapshotTotalPoolHeldAttoRep,
		uint256 snapshotTotalRepBackingUnits
	) external isOperational onlyValidOracle {
		// The coordinator still commits these queue-time values for its distance
		// check. Pool execution intentionally uses the live rate so an unsolicited
		// ERC-20 transfer cannot cancel liquidation.
		assembly ('memory-safe') {
			pop(snapshotTotalPoolHeldAttoRep)
			pop(snapshotTotalRepBackingUnits)
		}
		require(!isEscalationResolved(), 'Resolved');
		updateVaultFees(targetVaultAddress);
		updateVaultFees(callerVault);

		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 coverageCommitmentToTransferAttoEth;
		uint256 vaultAttoRepBackingToTransfer;
		uint256 badDebtAttoEth;
		address delegate = liquidationDelegate;
		bytes4 selector = SecurityPoolLiquidationDelegate.performBundledLiquidation.selector;
		assembly ('memory-safe') {
			let pointer := mload(0x40)
			mstore(pointer, selector)
			mstore(add(pointer, 0x04), callerVault)
			mstore(add(pointer, 0x24), targetVaultAddress)
			mstore(add(pointer, 0x44), requestedCommitmentTransferAttoEth)
			mstore(add(pointer, 0x64), snapshotTargetBackingUnits)
			mstore(add(pointer, 0x84), snapshotTargetCoverageCommitmentAttoEth)
			mstore(add(pointer, 0xa4), repEthPrice)
			if iszero(delegatecall(gas(), delegate, pointer, 0xc4, pointer, 0x60)) {
				returndatacopy(pointer, 0, returndatasize())
				revert(pointer, returndatasize())
			}
			coverageCommitmentToTransferAttoEth := mload(pointer)
			vaultAttoRepBackingToTransfer := mload(add(pointer, 0x20))
			badDebtAttoEth := mload(add(pointer, 0x40))
		}

		if (coverageCommitmentToTransferAttoEth != 0) {
			_trackVault(callerVault);
		}
		_syncActiveVault(targetVaultAddress);
		if (coverageCommitmentToTransferAttoEth != 0) _syncActiveVault(callerVault);

		if (coverageCommitmentToTransferAttoEth != 0)
			emit VaultLiquidated(
				callerVault,
				targetVaultAddress,
				coverageCommitmentToTransferAttoEth,
				vaultAttoRepBackingToTransfer
			);
		_emitVaultAccountingCheckpoint(targetVaultAddress);
		if (coverageCommitmentToTransferAttoEth != 0) _emitVaultAccountingCheckpoint(callerVault);
		_emitPoolAccountingCheckpoint(AccountingReason.CoverageCommitmentChange, callerVault);
	}

	////////////////////////////////////////
	// set coverage commitment
	////////////////////////////////////////

	function executeCoverageCommitmentUpdate(
		address callerVault,
		uint256 amountAttoEth
	) external isOperational onlyValidOracle {
		require(!isEscalationResolved(), 'Resolved');
		updateVaultFees(callerVault);

		uint256 previousCoverageCommitmentAttoEth = securityVaults[callerVault].coverageCommitmentAttoEth;
		_clearFeeIndexRemainder();
		totalCoverageCommitmentAttoEth += amountAttoEth;
		totalCoverageCommitmentAttoEth -= previousCoverageCommitmentAttoEth;
		feeEligibleCoverageCommitmentAttoEth += amountAttoEth;
		feeEligibleCoverageCommitmentAttoEth -= previousCoverageCommitmentAttoEth;
		securityVaults[callerVault].coverageCommitmentAttoEth = amountAttoEth;

		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 vaultDisputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(callerVault);
		require(
			SecurityPoolUtils.isVaultHealthy(
				backingUnitsToAttoRep(securityVaults[callerVault].repBackingUnits),
				vaultDisputeStakedAttoRep,
				amountAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Vault commitment'
		);
		require(
			SecurityPoolUtils.isVaultHealthy(
				getTotalPoolHeldAttoRep(),
				_getTotalDisputeStakedRep(),
				totalCoverageCommitmentAttoEth,
				repEthPrice,
				statoblastSecurityMultiplierBps
			),
			'Pool commitment'
		);
		_requireCapacityNotExceeded(feeEligibleCoverageCommitmentAttoEth, settlementCollateralAttoEth);
		_requireMinimumCoverageCommitmentAttoEth(amountAttoEth, amountAttoEth == 0, 'Commitment min');
		_syncActiveVault(callerVault);
		updateRetentionRate();
		_emitVaultAccountingCheckpoint(callerVault);
		_emitPoolAccountingCheckpoint(AccountingReason.CoverageCommitmentChange, callerVault);
	}

	////////////////////////////////////////
	// Complete Sets
	////////////////////////////////////////
	function createCompleteSet() external payable isOperational {
		// Child pools mint complete sets only after migration and truth-auction
		// accounting have restored `SystemState.Operational`.
		require(!awaitingForkContinuation, 'Fork await');
		require(msg.value > 0 && !isEscalationResolved(), 'Resolved');
		updateSettlementCollateral();
		uint256 completeSetsToMintAttoShares = attoEthToAttoShares(msg.value);
		require(completeSetsToMintAttoShares > 0, 'Exchange rate undefined');
		uint256 nextSettlementCollateralAttoEth = settlementCollateralAttoEth + msg.value;
		// CoverageCommitmentAttoEth reserved for unclaimed truth-auction bids has no accountable vault
		// and cannot secure new open interest until the winner claims it.
		_requireCapacityNotExceeded(feeEligibleCoverageCommitmentAttoEth, nextSettlementCollateralAttoEth);
		shareTokenSupplyAttoShares += completeSetsToMintAttoShares;
		settlementCollateralAttoEth = nextSettlementCollateralAttoEth;
		emit CompleteSetCreated(
			msg.sender,
			msg.value,
			completeSetsToMintAttoShares,
			shareTokenSupplyAttoShares,
			settlementCollateralAttoEth
		);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMintAttoShares);
		updateRetentionRate();
	}

	function redeemCompleteSet(uint256 amountAttoShares) external isOperational {
		// Complete-set exits use the current collateral-per-share rate after fee
		// accrual, preserving the exchange rate for remaining complete sets.
		updateSettlementCollateral();
		// Burns a complete set and releases its attoETH settlement collateral.
		uint256 settlementCollateralRedeemedAttoEth = attoSharesToAttoEth(amountAttoShares);
		shareToken.burnCompleteSets(universeId, msg.sender, amountAttoShares);
		shareTokenSupplyAttoShares -= amountAttoShares;
		settlementCollateralAttoEth -= settlementCollateralRedeemedAttoEth;
		updateRetentionRate();
		emit CompleteSetRedeemed(
			msg.sender,
			amountAttoShares,
			settlementCollateralRedeemedAttoEth,
			shareTokenSupplyAttoShares,
			settlementCollateralAttoEth
		);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(payable(msg.sender), settlementCollateralRedeemedAttoEth);
	}

	function redeemShares() external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		BinaryOutcomes.BinaryOutcome outcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(
			ISecurityPool(payable(address(this)))
		);
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question open');
		updateSettlementCollateral();
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		(uint256 winningSharesBurnedAttoShares, ) = shareToken.burnTokenIdAndGetRemainingSupply(tokenId, msg.sender);
		uint256 settlementCollateralRedeemedAttoEth =
			shareTokenSupplyAttoShares == 0
				? 0
				: (winningSharesBurnedAttoShares * settlementCollateralAttoEth) / shareTokenSupplyAttoShares;
		shareTokenSupplyAttoShares -= winningSharesBurnedAttoShares;
		settlementCollateralAttoEth -= settlementCollateralRedeemedAttoEth;
		emit SharesRedeemed(
			msg.sender,
			winningSharesBurnedAttoShares,
			settlementCollateralRedeemedAttoEth,
			shareTokenSupplyAttoShares,
			settlementCollateralAttoEth
		);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(payable(msg.sender), settlementCollateralRedeemedAttoEth);
	}

	function redeemRepFromVault(address vault) external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(
			ISecurityPoolForker(securityPoolForker).getQuestionOutcome(ISecurityPool(payable(address(this)))) !=
				BinaryOutcomes.BinaryOutcome.None,
			'Question open'
		);
		uint256 disputeStakedAttoRep =
			address(escalationGame) == address(0x0) ? 0 : escalationGame.disputeStakedRepByVaultAttoRep(vault);
		require(disputeStakedAttoRep == 0, 'Escrow locked');
		updateVaultFees(vault);
		uint256 vaultBackingUnits = securityVaults[vault].repBackingUnits;
		uint256 backingUnitsToRedeem = vaultBackingUnits;
		uint256 attoRepAmount = backingUnitsToAttoRep(backingUnitsToRedeem);
		require(attoRepAmount > 0, 'No redeemable REP');
		securityVaults[vault].repBackingUnits = 0;
		totalRepBackingUnits -= backingUnitsToRedeem;
		_syncActiveVault(vault);
		IERC20(address(repToken)).safeTransfer(vault, attoRepAmount);
		emit RepRedeemedFromVault(
			msg.sender,
			vault,
			attoRepAmount,
			securityVaults[vault].repBackingUnits,
			totalRepBackingUnits
		);
		_emitVaultAccountingCheckpoint(vault);
	}

	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(
			ISecurityPool(payable(address(this)))
		);
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

	function depositToEscalationGame(
		BinaryOutcomes.BinaryOutcome outcome,
		uint256 maximumDepositAttoRep
	) external isOperational {
		require(!hasInheritedForkOutcome, 'Resolved');
		require(!awaitingForkContinuation, 'Fork await');
		if (address(escalationGame) == address(0x0)) {
			uint256 endTime = questionData.getQuestionEndDate(questionId);
			require(block.timestamp > endTime, 'Question active');
			escalationGame = escalationGameFactory.deployEscalationGame(
				initialEscalationGameDepositAttoRep,
				zoltar.getNonDecisionThresholdAttoRep(universeId)
			);
			emit EscalationGameSet(escalationGame);
		} else {
			require(!escalationGame.forkContinuation() || escalationGame.forkResumedAt() != 0, 'Fork paused');
		}

		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = escalationGame.previewDepositOnOutcome(
			outcome,
			maximumDepositAttoRep
		);
		require(depositedAttoRep > 0, 'No deposit');
		if (totalCoverageCommitmentAttoEth > 0) {
			require(priceOracleManagerAndOperatorQueuer.isPriceValid(), 'Stale price');
		}
		uint256 backingUnitsToEscrow = attoRepToBackingUnitsRoundUp(depositedAttoRep);
		uint256 currentVaultRepBackingAttoRep = backingUnitsToAttoRep(securityVaults[msg.sender].repBackingUnits);
		require(currentVaultRepBackingAttoRep >= depositedAttoRep, 'REP too low');
		require(backingUnitsToEscrow > 0, 'Escrow low');

		uint256 updatedRepBackingUnits = securityVaults[msg.sender].repBackingUnits - backingUnitsToEscrow;
		uint256 repEthPrice = priceOracleManagerAndOperatorQueuer.lastPrice();
		uint256 postTransferPoolHeldRepBalanceAttoRep = getTotalPoolHeldAttoRep() - depositedAttoRep;
		uint256 postTransferTotalRepBackingUnits = totalRepBackingUnits - backingUnitsToEscrow;
		uint256 remainingAttoRep =
			updatedRepBackingUnits == 0
				? 0
				: (updatedRepBackingUnits * postTransferPoolHeldRepBalanceAttoRep) / postTransferTotalRepBackingUnits;
		uint256 vaultDisputeStakedAttoRep =
			escalationGame.disputeStakedRepByVaultAttoRep(msg.sender) + depositedAttoRep;
		uint256 totalDisputeStakedAttoRep = escalationGame.totalDisputeStakedAttoRep() + depositedAttoRep;
		_requireVaultCoverage(
			remainingAttoRep,
			vaultDisputeStakedAttoRep,
			securityVaults[msg.sender].coverageCommitmentAttoEth,
			repEthPrice
		);
		_requirePoolCoverage(
			postTransferPoolHeldRepBalanceAttoRep,
			totalDisputeStakedAttoRep,
			totalCoverageCommitmentAttoEth,
			repEthPrice
		);
		_requireMinimumVaultRep(remainingAttoRep, updatedRepBackingUnits == 0, 'Vault REP below minimum');
		securityVaults[msg.sender].repBackingUnits = updatedRepBackingUnits;
		totalRepBackingUnits = postTransferTotalRepBackingUnits;
		IERC20(address(repToken)).safeTransfer(address(escalationGame), depositedAttoRep);
		escalationGame.recordDepositFromSecurityPool(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
		_syncActiveVault(msg.sender);
		emit DepositToEscalationGame(
			msg.sender,
			outcome,
			depositedAttoRep,
			backingUnitsToEscrow,
			securityVaults[msg.sender].repBackingUnits,
			totalRepBackingUnits,
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
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(
			ISecurityPool(payable(address(this)))
		);
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
		require(!hasInheritedForkOutcome, 'Resolved');
		systemState = SystemState.PoolForked;
		updateSettlementCollateral();
		uint256 repTransferredAttoRep = repToken.balanceOf(address(this));
		IERC20(address(repToken)).safeTransfer(msg.sender, repTransferredAttoRep);
		address game = address(escalationGame);
		if (game != address(0x0)) {
			// Keep the internal drain call data-free on failure so this contract remains
			// deployable under the EIP-170 runtime limit.
			assembly ('memory-safe') {
				mstore(0x00, shl(224, 0x3c250020))
				mstore(0x04, caller())
				if iszero(call(gas(), game, 0, 0x00, 0x24, 0x00, 0x00)) {
					revert(0x00, 0x00)
				}
			}
		}
		emit PoolForkModeActivated(repTransferredAttoRep, currentRetentionRate, systemState);
		_emitPoolAccountingCheckpoint(AccountingReason.ForkActivation, address(0x0));
	}

	function initializeForkedEscalationGame(
		uint256 startBondAttoRep,
		uint256 nonDecisionThresholdAttoRep,
		uint256 elapsedAtFork,
		BinaryOutcomes.BinaryOutcome fixedQuestionOutcome
	) external onlyForker {
		require(address(escalationGame) == address(0x0), 'Game set');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(
			startBondAttoRep,
			nonDecisionThresholdAttoRep,
			elapsedAtFork,
			fixedQuestionOutcome
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

	function resumeForkedEscalationGame() external {
		address delegate = liquidationDelegate;
		bytes4 selector = SecurityPoolLiquidationDelegate.resumeForkedEscalationGame.selector;
		assembly ('memory-safe') {
			mstore(0, selector)
			if iszero(delegatecall(gas(), delegate, 0, 4, 0, 0)) {
				returndatacopy(0, 0, returndatasize())
				revert(0, returndatasize())
			}
		}
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
		uint256 repBackingUnits,
		uint256 coverageCommitmentAttoEth,
		uint256 vaultFeeIndex
	) external onlyForker {
		require(vault != address(0x0), 'Zero vault');
		_trackVault(vault);
		securityVaults[vault].repBackingUnits = repBackingUnits;
		if (securityVaults[vault].coverageCommitmentAttoEth != coverageCommitmentAttoEth) {
			_clearFeeIndexRemainder();
		}
		securityVaults[vault].coverageCommitmentAttoEth = coverageCommitmentAttoEth;
		securityVaults[vault].feeIndex = vaultFeeIndex;
		_syncActiveVault(vault);
		_emitVaultAccountingCheckpoint(vault);
		_emitPoolAccountingCheckpoint(AccountingReason.CoverageCommitmentChange, vault);
	}

	function addFeeEligibleCoverageCommitmentAttoEth(address vault, uint256 amountAttoEth) external onlyForker {
		feeEligibleCoverageCommitmentAttoEth += amountAttoEth;
		require(feeEligibleCoverageCommitmentAttoEth <= totalCoverageCommitmentAttoEth, 'Fee high');
		_clearFeeIndexRemainder();
		updateRetentionRate();
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
			securityVaults[vault].repBackingUnits > 0 ||
				securityVaults[vault].coverageCommitmentAttoEth > 0 ||
				securityVaults[vault].claimableFeesAttoEth > 0 ||
				(address(escalationGame) != address(0x0) && escalationGame.disputeStakedRepByVaultAttoRep(vault) > 0);
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

	function setTotalRepBackingUnits(uint256 newDenominator) external onlyForker {
		totalRepBackingUnits = newDenominator;
		emit TotalRepBackingUnitsSet(totalRepBackingUnits);
	}

	function setTotalSharesAttoShares(uint256 newTotalSharesAttoShares) external onlyForker {
		shareTokenSupplyAttoShares = newTotalSharesAttoShares;
		emit ShareTokenSupplySet(shareTokenSupplyAttoShares);
	}

	function setPoolFinancials(
		uint256 newSettlementCollateralAttoEth,
		uint256 newTotalCoverageCommitmentAttoEth,
		uint256 newFeeEligibleCoverageCommitmentAttoEth
	) external onlyForker {
		require(newTotalCoverageCommitmentAttoEth >= newSettlementCollateralAttoEth, 'Commitment low');
		require(newFeeEligibleCoverageCommitmentAttoEth <= newTotalCoverageCommitmentAttoEth, 'Fee high');
		settlementCollateralAttoEth = newSettlementCollateralAttoEth;
		totalCoverageCommitmentAttoEth = newTotalCoverageCommitmentAttoEth;
		feeEligibleCoverageCommitmentAttoEth = newFeeEligibleCoverageCommitmentAttoEth;
		lastUpdatedFeeAccumulator = block.timestamp;
		_clearFeeIndexRemainder();
		_emitPoolAccountingCheckpoint(AccountingReason.ForkFinalization, address(0x0));
	}

	function transferEth(address payable receiver, uint256 amountAttoEth) external onlyForker {
		uint256 feeLiabilitiesAttoEth = totalClaimableVaultFeesAttoEth + unallocatedAccruedFeesAttoEth;
		require(
			feeLiabilitiesAttoEth <= address(this).balance &&
				amountAttoEth <= address(this).balance - feeLiabilitiesAttoEth &&
				amountAttoEth <= settlementCollateralAttoEth,
			'Collateral low'
		);
		settlementCollateralAttoEth -= amountAttoEth;
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation, address(0x0));
		_sendEth(receiver, amountAttoEth);
	}

	function _sendEth(address payable receiver, uint256 amountAttoEth) private {
		(bool sent, ) = receiver.call{ value: amountAttoEth }('');
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
