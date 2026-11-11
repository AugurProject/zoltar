// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolPortfolioNative } from './interfaces/ISecurityPoolPortfolioNative.sol';
import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { OpenOraclePriceCoordinator } from './OpenOraclePriceCoordinator.sol';
import {
	ISecurityPool,
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
import { SecurityPoolOperationsDelegate } from './SecurityPoolOperationsDelegate.sol';
import { SecurityPoolSettlementDelegate } from './SecurityPoolSettlementDelegate.sol';
import { DelegateCallForwarder } from './DelegateCallForwarder.sol';
import { ISecurityPoolDeploymentWorkerConfiguration } from './interfaces/ISecurityPoolDeploymentWorkerConfiguration.sol';
import { Math } from './openOracle/openzeppelin/contracts/utils/math/Math.sol';
import { SecurityPoolLinearFees } from './SecurityPoolLinearFees.sol';
import { SecurityPoolPortfolioAccountingDelegate } from './SecurityPoolPortfolioAccountingDelegate.sol';
import { IPortfolioSettlement } from './interfaces/IPortfolioSettlement.sol';

// Security pool for one question, one universe, one denomination (ETH)
contract SecurityPool is SecurityPoolStorage {
	using SafeERC20Ops for IERC20;
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementPortfolioTime);

	uint256 public immutable questionId;
	uint248 public immutable universeId;
	uint256 public immutable initialEscalationGameDepositAttoRep;

	Zoltar public immutable zoltar;
	ISecurityPool public immutable parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	OpenOraclePriceCoordinator public immutable openOraclePriceCoordinator;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	ZoltarQuestionData public immutable questionData;
	address public immutable securityPoolForker;
	address public immutable collateralRepairAuction;
	ISecurityPoolFactory public immutable securityPoolFactory;
	bool private immutable hasInheritedForkOutcome;
	SecurityPoolEventEmitter public immutable eventEmitter;
	address private immutable operationsDelegate;

	event EscalationGameSet(EscalationGame escalationGame);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event SystemStateSet(SystemState systemState);
	event ShareTokenSupplySet(uint256 shareTokenSupplyAttoShares);
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event CompleteSetRedeemed(address indexed redeemer, uint256 completeSetsBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event SharesRedeemed(address indexed redeemer, uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event EthReceived(address indexed sender, uint256 amountAttoEth);

	modifier isOperational() {
		// Once a universe forks, the parent pool freezes operational flows permanently.
		// Outcome child pools can re-enter `SystemState.Operational` after migration and
		// collateral-repair-auction processing complete. Finalized claim paths keep their own state
		// and finality guards so late unrelated forks do not block share or REP redemption.
		_requireUnforkedOperational(zoltar.getForkTime(universeId));
		_;
	}

	modifier onlyForker() {
		require(msg.sender == securityPoolForker, 'Only forker');
		_;
	}

	constructor(address _securityPoolForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, OpenOraclePriceCoordinator _openOraclePriceCoordinator, IShareToken _shareToken, OpenOracle _openOracle, ISecurityPool _parent, Zoltar _zoltar, uint248 _universeId, uint256 _questionId, uint256 _statoblastSecurityMultiplierBps, address _collateralRepairAuction) {
		universeId = _universeId;
		ISecurityPoolDeploymentWorkerConfiguration worker = ISecurityPoolDeploymentWorkerConfiguration(msg.sender);
		securityPoolFactory = worker.factory();
		eventEmitter = worker.eventEmitter();
		operationsDelegate = worker.operationsDelegate();
		questionId = _questionId;
		statoblastSecurityMultiplierBps = _statoblastSecurityMultiplierBps;
		repToken = _zoltar.getRepToken(_universeId);
		uint256 universeTheoreticalSupplyAttoRep = _zoltar.getUniverseTheoreticalSupplyAttoRep(_universeId);
		initialEscalationGameDepositAttoRep = SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(universeTheoreticalSupplyAttoRep);
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		openOraclePriceCoordinator = _openOraclePriceCoordinator;
		securityPoolForker = _securityPoolForker;
		collateralRepairAuction = _collateralRepairAuction;
		questionData = _questionData;
		if (address(parent) == address(0x0)) {
			// origin universe never does collateralRepairAuction
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
			address portfolio = securityPoolFactory.getSecurityPoolPortfolio(parent);
			require(portfolio != address(0), 'Portfolio missing');
			(hasInheritedForkOutcome, ) = ISecurityPoolPortfolioNative(portfolio).inheritedFixedOutcome(_universeId, _questionId);
		}
		shareToken = _shareToken;
	}

	/// @notice Returns true when the pool inherited a fixed fork outcome or its escalation game has a final question outcome.
	/// @dev A child with an inherited fixed outcome stays operational for settlement and redemption,
	/// but its finalized question must still freeze collateralized operations.
	function isEscalationResolved() public view returns (bool) {
		return
			hasInheritedForkOutcome ||
			(address(escalationGame) != address(0x0) &&
				ISecurityPoolForker(securityPoolForker).getQuestionOutcome(ISecurityPool(payable(address(this)))) !=
					BinaryOutcomes.BinaryOutcome.None);
	}

	/// @notice Active-game-only burn of REP already transferred for settlement.
	function burnEscalationWinnerHaircut(uint256) external {
		_forwardAccountingOperation();
	}
	/// @notice Binds the canonical portfolio's central capital ledger once.
	function setPortfolioCustody(address) external {
		_forwardAccountingOperation();
	}
	/// @notice Credit irrevocable REP surplus already transferred by the active game.
	function creditEscalationSurplus(uint256) external {
		_forwardAccountingOperation();
	}

	function _forwardAccountingOperation() private {
		DelegateCallForwarder.invokeWithDecodedRevert(address(eventEmitter), msg.data);
	}

	/// @notice Factory-only: initializes the question fee clock and settlement collateral.
	function setStartingParams(uint256, uint256) external {
		_forwardAccountingOperation();
	}

	/// @notice Checkpoints the portfolio settlement book; callable by anyone.
	function updateSettlementCollateral() public {
		DelegateCallForwarder.invokeWithDecodedRevert(address(eventEmitter), abi.encodeCall(SecurityPoolPortfolioAccountingDelegate.accrueSettlementCollateral, ()));
	}

	/// @notice Returns the native fee-epoch cutoff; bound portfolio fee accrual follows the central stream.
	function getFeeEpochEndTime() public view returns (uint256) {
		uint256 forkTime = zoltar.getForkTime(universeId);
		uint256 end = feeEpochEndTime;
		if (end == type(uint256).max && address(escalationGame) != address(0))
			end = escalationGame.getEscalationGameEndDate();
		return forkTime != 0 && forkTime < end ? forkTime : end;
	}

	/// @notice Refreshes the portfolio's linear fee stream.
	function updateRetentionRate() public {
		DelegateCallForwarder.invokeWithDecodedRevert(address(eventEmitter), abi.encodeCall(SecurityPoolPortfolioAccountingDelegate.updateRetentionRate, ()));
	}

	function refreshPortfolioFees() public {
		DelegateCallForwarder.invokeWithDecodedRevert(address(eventEmitter), abi.encodeCall(SecurityPoolLinearFees.refreshLinearFeeStream, ()));
	}

	function _emitPoolAccountingCheckpoint(AccountingReason reason) private {
		_emitEvent(abi.encodeCall(SecurityPoolEventEmitter.emitPoolAccountingCheckpoint, (reason)));
	}

	function _emitEvent(bytes memory eventCall) private {
		DelegateCallForwarder.invokeWithDecodedRevert(address(eventEmitter), eventCall);
	}

	/// @notice Native question ledgers hold no underwriting REP; the portfolio owns its shared capital.
	function getTotalPoolHeldAttoRep() public pure returns (uint256) {
		return 0;
	}

	/// @notice Returns zero once a game exists; otherwise the standalone underwriting limit or question cash plus available shared capacity.
	function getCurrentMintingCapacityAttoEth() public view returns (uint256) {
		if (address(escalationGame) != address(0)) return 0;
		if (portfolioCustody != address(0)) {
			// Existing consumers subtract this question's cash from the reported
			// ceiling. Shared capacity excludes pending retirement commitments.
			return
				settlementCollateralAttoEth +
				IPortfolioSettlement(address(portfolioAccounting)).availableMintCapacity(universeId);
		}
		revert('Portfolio settlement missing');
	}

	/// @notice Converts shares to settlement collateral at the current rate, rounding down.
	function attoSharesToAttoEth(uint256 amountAttoShares) public view returns (uint256) {
		return
			IPortfolioSettlement(address(portfolioAccounting)).quoteQuestionSettlement(address(this), amountAttoShares);
	}

	/// @notice Quotes the child REP paid alongside the configured collateral token when redeeming portfolio claims.
	function attoSharesToAttoRep(uint256 amountAttoShares) external view returns (uint256) {
		return
			IPortfolioSettlement(address(portfolioAccounting)).quoteQuestionRecoveryRep(address(this), amountAttoShares);
	}

	/// @notice Quotes shares for raw collateral units from the portfolio's central settlement book.
	function attoEthToAttoShares(uint256 amountAttoEth) public view returns (uint256) {
		return IPortfolioSettlement(address(portfolioAccounting)).quoteQuestionMint(address(this), amountAttoEth);
	}

	// Complete Sets
	/// @notice Mints complete sets through the authorized portfolio purchase path for `cash` raw collateral units while no escalation game exists.
	function createCompleteSet(uint256 cash) external isOperational {
		bytes memory result = DelegateCallForwarder.invokeWithDecodedRevert(operationsDelegate, abi.encodeCall(SecurityPoolSettlementDelegate.createCompleteSet, (cash)));
		uint256 completeSetsToMintAttoShares = abi.decode(result, (uint256));
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation);
		shareToken.mintCompleteSets(universeId, msg.sender, completeSetsToMintAttoShares);
		updateRetentionRate();
	}

	/// @notice Burns `amountAttoShares` complete sets from the caller and sends the matching settlement collateral in the configured token.
	/// @dev Complete-set exits use the current collateral-per-share rate after fee
	/// accrual, preserving the exchange rate for remaining complete sets.
	function redeemCompleteSet(uint256 amountAttoShares) external isOperational {
		updateSettlementCollateral();
		bytes memory result = DelegateCallForwarder.invokeWithDecodedRevert(operationsDelegate, abi.encodeCall(SecurityPoolOperationsDelegate.redeemCompleteSet, (shareToken, universeId, msg.sender, amountAttoShares)));
		uint256 settlementCollateralRedeemedAttoEth = abi.decode(result, (uint256));
		updateRetentionRate();
		emit CompleteSetRedeemed(msg.sender, amountAttoShares, settlementCollateralRedeemedAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation);
	}

	/// @notice Burns the caller's winning-outcome shares after finalization and sends their settlement collateral in the configured token.
	function redeemShares() external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		updateSettlementCollateral();
		bytes memory result = DelegateCallForwarder.invokeWithDecodedRevert(operationsDelegate, abi.encodeCall(SecurityPoolOperationsDelegate.redeemShares, (shareToken, ISecurityPoolForker(securityPoolForker), universeId, msg.sender)));
		(uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth) = abi.decode(result, (uint256, uint256));
		refreshPortfolioFees();
		emit SharesRedeemed(msg.sender, winningSharesBurnedAttoShares, settlementCollateralRedeemedAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
		_emitPoolAccountingCheckpoint(AccountingReason.CollateralReconciliation);
	}

	/// @notice Withdraws fork-carried escalation deposits after the question is final; all proofs must share one depositor.
	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(ISecurityPool(payable(address(this))));
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));

		EscalationGame escalationGameContract = EscalationGame(payable(address(escalationGame)));
		address beneficiary = address(0x0);
		for (uint256 index = 0; index < proofs.length; index++) {
			address depositor;
			(depositor, , ) = escalationGameContract.withdrawDeposit(proofs[index], withdrawalOutcome);
			if (beneficiary == address(0x0)) {
				beneficiary = depositor;
			}
			require(depositor == beneficiary, 'One depositor');
		}
	}

	// Wallet-funded reporting and fork continuation

	/// @notice Deposits REP from the caller's wallet directly into the escalation game on `outcome`, deploying the game if needed.
	/// @dev Wallet-funded deposits never acquire pool backing or capacity.
	function depositWalletRepToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		if (hasInheritedForkOutcome) revert('Forked');
		DelegateCallForwarder.invokeWithDecodedRevert(operationsDelegate, abi.encodeCall(SecurityPoolOperationsDelegate.depositWalletRepToEscalationGame, (outcome, maximumDepositAttoRep)));
	}

	/// @notice Withdraws local escalation deposits after the question is final; all indexes must share one depositor.
	/// @dev Reverts when the universe forked before the game ended without a non-decision.
	function withdrawFromEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256[] calldata depositIndexes) external {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		BinaryOutcomes.BinaryOutcome questionOutcome = ISecurityPoolForker(securityPoolForker).getQuestionOutcome(ISecurityPool(payable(address(this))));
		uint256 forkTime = zoltar.getForkTime(universeId);
		if (
			forkTime > 0 &&
			forkTime < escalationGame.getEscalationGameEndDate() &&
			!escalationGame.hasReachedNonDecision()
		) {
			revert('Migrate deposits first');
		}
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		address beneficiary = address(0x0);
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			address depositor;
			(depositor, , ) = escalationGame.withdrawDeposit(depositIndexes[index], outcome);
			if (beneficiary == address(0x0)) {
				beneficiary = depositor;
			}
			require(depositor == beneficiary, 'One depositor');
		}
	}

	/// @notice Forker-only: freezes portfolio accounting and leaves the question ledger forked.
	function activateForkMode() external onlyForker {
		if (hasInheritedForkOutcome) revert('Forked');
		portfolioAccounting.freezeForFork();
		systemState = SystemState.PoolForked;
	}

	/// @notice Forker-only: deploys the fork-continuation escalation game.
	function initializeForkedEscalationGame(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome fixedQuestionOutcome) external onlyForker {
		require(address(escalationGame) == address(0), 'Game already initialized');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome);
		emit EscalationGameSet(escalationGame);
	}

	/// @notice Forker-only: installs the next bounded outcome of the inherited carry snapshot.
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep, bytes32 nullifierRoot) external onlyForker {
		require(address(escalationGame) != address(0x0), 'Game missing');
		escalationGame.initializeForkCarryOutcome(sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep, nullifierRoot);
	}

	/// @notice Resumes a paused fork-continuation escalation game once its carry is funded; callable by anyone.
	function resumeForkedEscalationGame() external {
		DelegateCallForwarder.invokeWithDecodedRevert(operationsDelegate, abi.encodeCall(SecurityPoolOperationsDelegate.resumeForkedEscalationGame, ()));
	}

	/// @notice Forker-only: sets whether the pool awaits escalation fork continuation.
	function setAwaitingForkContinuation(bool shouldAwait) external onlyForker {
		awaitingForkContinuation = shouldAwait;
		emit AwaitingForkContinuationSet(awaitingForkContinuation);
		refreshPortfolioFees();
	}

	/// @notice Forker-only: sets the pool system state.
	function setSystemState(SystemState newState) external onlyForker {
		systemState = newState;
		emit SystemStateSet(systemState);
		refreshPortfolioFees();
	}

	/// @notice Forker-only: sets the pool's share supply.
	function setShareTokenSupplyAttoShares(uint256 newShareTokenSupplyAttoShares) external onlyForker {
		shareTokenSupplyAttoShares = newShareTokenSupplyAttoShares;
		emit ShareTokenSupplySet(shareTokenSupplyAttoShares);
	}

	/// @notice Forker-only: authorizes a child pool on the share token.
	function authorizeChildPool(ISecurityPool pool) external onlyForker {
		shareToken.authorize(pool);
	}

	/// @notice Accepts native ETH without creating a settlement-collateral claim.
	receive() external payable {
		require(portfolioCustody != address(0) || msg.sender == securityPoolForker || msg.sender == collateralRepairAuction || msg.sender == address(parent), 'Bad ETH sender');
		emit EthReceived(msg.sender, msg.value);
	}
}
