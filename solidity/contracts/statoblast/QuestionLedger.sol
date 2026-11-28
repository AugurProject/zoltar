// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';
import { ISecurityPoolNative } from './interfaces/ISecurityPoolNative.sol';
import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { Constants } from '../Constants.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { SharedPoolPriceFeed } from './SharedPoolPriceFeed.sol';
import {
	IQuestionLedger,
	AccountingReason,
	SystemState,
	QuestionOutcome,
	ISecurityPoolFactory
} from './interfaces/IQuestionLedger.sol';
import { OpenOracle } from './openOracle/OpenOracle.sol';
import { SecurityPoolUtils } from './SecurityPoolUtils.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { EscalationGame } from './EscalationGame.sol';
import { CarriedDepositProof } from './EscalationGameTypes.sol';
import { ZoltarQuestionData } from '../ZoltarQuestionData.sol';
import { IQuestionForker } from './interfaces/IQuestionForker.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { QuestionLedgerStorage } from './QuestionLedgerStorage.sol';
import { QuestionLedgerDelegate } from './QuestionLedgerDelegate.sol';
import { DelegateCall } from './DelegateCall.sol';
import { IQuestionLedgerDeployerConfiguration } from './interfaces/IQuestionLedgerDeployerConfiguration.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';

interface IQuestionAdmissionHost {
	function questionAdmissionPolicy() external view returns (ISecurityPoolQuestionAdmissionPolicy);
	function originUniverseId() external view returns (uint248);
}

interface ICompletePurchaseFunding {
	function completePurchaseFunding(uint256 fee, uint256 premium) external;
}

// Question ledger for one question and one universe, settled in its configured collateral token.
contract QuestionLedger is QuestionLedgerStorage {
	using SafeERC20Ops for IERC20;
	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementSecurityPoolTime);

	/// @notice Seconds between the first report and activation of an ordinary escalation game.
	uint256 public constant initialReportingResponseWindow = Constants.FORK_RESPONSE_DELAY;

	uint256 public immutable questionId;
	uint248 public immutable universeId;
	uint256 public immutable initialEscalationGameDepositAttoRep;
	uint256 public immutable statoblastSecurityMultiplierBps;

	Zoltar public immutable zoltar;
	IQuestionLedger public immutable parent;
	IShareToken public immutable shareToken;
	ReputationToken public immutable repToken;
	SharedPoolPriceFeed public immutable priceFeed;
	OpenOracle public immutable openOracle;
	EscalationGameFactory public immutable escalationGameFactory;
	ZoltarQuestionData public immutable questionData;
	address public immutable questionForker;
	ISecurityPoolFactory public immutable securityPoolFactory;
	bool private immutable hasInheritedForkOutcome;
	/// @dev Fixed delegatecall target for accounting and operations; it shares this contract's storage layout.
	address private immutable delegate;

	event EscalationGameSet(EscalationGame escalationGame);
	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event SystemStateSet(SystemState systemState);
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event CompleteSetRedeemed(address indexed redeemer, uint256 completeSetsBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);
	event SharesRedeemed(address indexed redeemer, uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	modifier isOperational() {
		// Once a universe forks, the parent pool freezes operational flows permanently.
		// Outcome child pools can re-enter `SystemState.Operational` after migration
		// completes. Finalized claim paths keep their own state
		// and finality guards so late unrelated forks do not block share or REP redemption.
		_requireUnforkedOperational(zoltar.getForkTime(universeId));
		_;
	}

	modifier onlyForker() {
		require(msg.sender == questionForker, 'Only forker');
		_;
	}

	constructor(address _questionForker, ZoltarQuestionData _questionData, EscalationGameFactory _escalationGameFactory, SharedPoolPriceFeed _priceFeed, IShareToken _shareToken, OpenOracle _openOracle, IQuestionLedger _parent, Zoltar _zoltar, uint248 _universeId, uint256 _questionId, uint256 _statoblastSecurityMultiplierBps) {
		universeId = _universeId;
		IQuestionLedgerDeployerConfiguration deployer = IQuestionLedgerDeployerConfiguration(msg.sender);
		securityPoolFactory = deployer.factory();
		delegate = deployer.delegate();
		questionId = _questionId;
		statoblastSecurityMultiplierBps = _statoblastSecurityMultiplierBps;
		repToken = _zoltar.getRepToken(_universeId);
		uint256 universeTheoreticalSupplyAttoRep = _zoltar.getUniverseTheoreticalSupplyAttoRep(_universeId);
		initialEscalationGameDepositAttoRep = SecurityPoolUtils.calculateInitialEscalationDepositAttoRep(universeTheoreticalSupplyAttoRep);
		zoltar = _zoltar;
		parent = _parent;
		openOracle = _openOracle;
		escalationGameFactory = _escalationGameFactory;
		priceFeed = _priceFeed;
		questionForker = _questionForker;
		questionData = _questionData;
		if (address(parent) == address(0x0)) {
			systemState = SystemState.Operational;
		} else {
			systemState = SystemState.ForkMigration;
			address securityPool = securityPoolFactory.securityPoolOf(parent);
			require(securityPool != address(0), 'Security pool missing');
			(hasInheritedForkOutcome, ) = ISecurityPoolNative(securityPool).inheritedFixedOutcome(_universeId, _questionId);
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
				IQuestionForker(questionForker).getQuestionOutcome(IQuestionLedger(payable(address(this)))) !=
					BinaryOutcomes.BinaryOutcome.None);
	}

	/// @notice Active-game-only burn of REP already transferred for settlement.
	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.burnEscalationWinnerHaircut, (amountAttoRep)));
	}
	/// @notice Binds the canonical security pool's central capital ledger once.
	function setSecurityPoolCustody(address custody) external {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.setSecurityPoolCustody, (custody)));
	}
	/// @notice Credit irrevocable REP surplus already transferred by the active game.
	function creditEscalationSurplus(uint256 amountAttoRep) external {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.creditEscalationSurplus, (amountAttoRep)));
	}

	/// @dev Delegatecall preserves the original caller; authorization lives in each named target method.
	function _delegate(bytes memory callData) private returns (bytes memory) {
		return DelegateCall.invoke(delegate, callData);
	}

	/// @notice Factory-only: initializes the question fee clock.
	function setStartingParams() external {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.setStartingParams, ()));
	}

	/// @notice Checkpoints the security pool settlement book; callable by anyone.
	function updateSettlementCollateral() public {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.accrueSettlementCollateral, ()));
	}

	/// @notice Refreshes the security pool's linear fee stream.
	function refreshSecurityPoolFees() public {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.refreshSettlement, ()));
	}

	function _emitQuestionLedgerAccountingCheckpoint(AccountingReason reason) private {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.emitQuestionLedgerAccountingCheckpoint, (reason)));
	}

	/// @notice Additional collateral this question may mint, excluding its existing cash.
	function additionalMintCapacityAttoEth() public view returns (uint256) {
		if (address(escalationGame) != address(0) || block.timestamp >= questionData.getQuestionEndDate(questionId))
			return 0;
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		address authority = securityPoolFactory.securityPoolOf(IQuestionLedger(payable(address(this))));
		IQuestionAdmissionHost host = IQuestionAdmissionHost(authority);
		if (!host.questionAdmissionPolicy().isQuestionAllowed(authority, host.originUniverseId(), questionId)) return 0;
		return ISecurityPoolSettlement(address(securityPoolAccounting)).availableMintCapacity(universeId);
	}

	/// @notice Converts shares to settlement collateral at the current rate, rounding down.
	function attoSharesToAttoEth(uint256 amountAttoShares) public view returns (uint256) {
		return
			ISecurityPoolSettlement(address(securityPoolAccounting)).quoteQuestionSettlement(address(this), amountAttoShares);
	}

	/// @notice Quotes the child REP paid alongside the configured collateral token when redeeming security pool claims.
	function attoSharesToAttoRep(uint256 amountAttoShares) external view returns (uint256) {
		return
			ISecurityPoolSettlement(address(securityPoolAccounting)).quoteQuestionRecoveryRep(address(this), amountAttoShares);
	}

	/// @notice Quotes shares for raw collateral units from the security pool's central settlement book.
	function attoEthToAttoShares(uint256 amountAttoEth) public view returns (uint256) {
		return ISecurityPoolSettlement(address(securityPoolAccounting)).quoteQuestionMint(address(this), amountAttoEth);
	}

	// Complete Sets
	/// @notice Mints complete sets through the authorized security pool purchase path for `cash` raw collateral units while no escalation game exists.
	function createCompleteSet(uint256 cash, address recipient, uint256 minimumShares, uint256 fee, uint256 premium) external isOperational returns (uint256 completeSetsToMintAttoShares) {
		bytes memory result = _delegate(abi.encodeCall(QuestionLedgerDelegate.createCompleteSet, (cash)));
		completeSetsToMintAttoShares = abi.decode(result, (uint256));
		require(completeSetsToMintAttoShares > 0 && completeSetsToMintAttoShares >= minimumShares, 'Minimum shares not met');
		_emitQuestionLedgerAccountingCheckpoint(AccountingReason.CollateralReconciliation);
		refreshSecurityPoolFees();
		ICompletePurchaseFunding(msg.sender).completePurchaseFunding(fee, premium);
		shareToken.mintCompleteSets(universeId, recipient, completeSetsToMintAttoShares);
	}

	/// @notice Burns `amountAttoShares` complete sets from the caller and sends the matching settlement collateral in the configured token.
	/// @dev Complete-set exits use the current collateral-per-share rate after fee
	/// accrual, preserving the exchange rate for remaining complete sets.
	function redeemCompleteSet(uint256 amountAttoShares) external isOperational {
		updateSettlementCollateral();
		bytes memory result = _delegate(abi.encodeCall(QuestionLedgerDelegate.redeemCompleteSet, (shareToken, universeId, msg.sender, amountAttoShares)));
		uint256 settlementCollateralRedeemedAttoEth = abi.decode(result, (uint256));
		refreshSecurityPoolFees();
		emit CompleteSetRedeemed(msg.sender, amountAttoShares, settlementCollateralRedeemedAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
		_emitQuestionLedgerAccountingCheckpoint(AccountingReason.CollateralReconciliation);
	}

	/// @notice Burns the caller's winning-outcome shares after finalization and sends their settlement collateral in the configured token.
	function redeemShares() external {
		require(systemState == SystemState.Operational, 'Pool inactive');
		updateSettlementCollateral();
		bytes memory result = _delegate(abi.encodeCall(QuestionLedgerDelegate.redeemShares, (shareToken, IQuestionForker(questionForker), universeId, msg.sender)));
		(uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth) = abi.decode(result, (uint256, uint256));
		refreshSecurityPoolFees();
		emit SharesRedeemed(msg.sender, winningSharesBurnedAttoShares, settlementCollateralRedeemedAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
		_emitQuestionLedgerAccountingCheckpoint(AccountingReason.CollateralReconciliation);
	}

	/// @notice Withdraws fork-carried escalation deposits after the question is final; all proofs must share one depositor.
	function withdrawForkedEscalationDeposits(QuestionOutcome outcome, CarriedDepositProof[] calldata proofs) external {
		require(_operationalQuestionOutcome() != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		BinaryOutcomes.BinaryOutcome withdrawalOutcome = BinaryOutcomes.BinaryOutcome(uint8(outcome));
		address beneficiary;
		for (uint256 index = 0; index < proofs.length; index++) {
			(address depositor, , ) = escalationGame.withdrawDeposit(proofs[index], withdrawalOutcome);
			beneficiary = _requireOneDepositor(beneficiary, depositor);
		}
	}

	function _operationalQuestionOutcome() private view returns (BinaryOutcomes.BinaryOutcome) {
		require(address(escalationGame) != address(0x0), 'Game missing');
		require(systemState == SystemState.Operational, 'Pool inactive');
		return IQuestionForker(questionForker).getQuestionOutcome(IQuestionLedger(payable(address(this))));
	}

	function _requireOneDepositor(address beneficiary, address depositor) private pure returns (address) {
		require(beneficiary == address(0x0) || depositor == beneficiary, 'One depositor');
		return depositor;
	}

	// Wallet-funded reporting and fork continuation

	/// @notice Deposits REP from the caller's wallet directly into the escalation game on `outcome`, deploying the game if needed.
	/// @dev Wallet-funded deposits never acquire pool backing or capacity.
	function depositWalletRepToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_depositWalletRep(outcome, maximumDepositAttoRep, false);
	}

	/// @notice Reverts unless the deposit leads outright or fills its non-decision threshold.
	function depositWalletRepToEscalationGameWithLead(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		_depositWalletRep(outcome, maximumDepositAttoRep, true);
	}

	function _depositWalletRep(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, bool requireLead) private {
		if (hasInheritedForkOutcome) revert('Forked');
		_delegate(abi.encodeCall(QuestionLedgerDelegate.depositWalletRep, (outcome, maximumDepositAttoRep, requireLead)));
	}

	/// @notice Withdraws local escalation deposits after the question is final; all indexes must share one depositor.
	/// @dev Reverts when the universe forked before the game ended without a non-decision.
	function withdrawFromEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256[] calldata depositIndexes) external {
		BinaryOutcomes.BinaryOutcome questionOutcome = _operationalQuestionOutcome();
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'No outcome');
		uint256 forkTime = zoltar.getForkTime(universeId);
		if (
			forkTime > 0 &&
			forkTime <= escalationGame.getEscalationGameEndDate() &&
			!escalationGame.hasReachedNonDecision()
		) {
			revert('Deposits carry to child games');
		}
		require(questionOutcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		address beneficiary;
		for (uint256 index = 0; index < depositIndexes.length; index++) {
			(address depositor, , ) = escalationGame.withdrawDeposit(depositIndexes[index], outcome);
			beneficiary = _requireOneDepositor(beneficiary, depositor);
		}
	}

	/// @notice Forker-only: freezes security pool accounting and leaves the question ledger forked.
	function activateForkMode() external onlyForker {
		if (hasInheritedForkOutcome) revert('Forked');
		securityPoolAccounting.freezeForFork();
		// The forker may repeat this call; only the transition itself is a state change.
		if (systemState == SystemState.PoolForked) return;
		systemState = SystemState.PoolForked;
		emit SystemStateSet(systemState);
	}

	/// @notice Forker-only: deploys the fork-continuation escalation game.
	function initializeForkedEscalationGame(uint256 startBondAttoRep, uint256 nonDecisionThresholdAttoRep, int256 elapsedAtFork, BinaryOutcomes.BinaryOutcome fixedQuestionOutcome) external onlyForker {
		require(address(escalationGame) == address(0), 'Game already initialized');
		escalationGame = escalationGameFactory.deployEscalationGameFromFork(startBondAttoRep, nonDecisionThresholdAttoRep, elapsedAtFork, fixedQuestionOutcome);
		emit EscalationGameSet(escalationGame);
	}

	/// @notice Forker-only: installs the next bounded outcome of the inherited carry snapshot.
	function initializeForkCarryOutcome(address sourceGame, bytes32 snapshotId, bytes32[64] memory peaks, uint256 leafCount, uint256 carryTotalAttoRep, uint256 resolutionBalanceAttoRep) external onlyForker {
		escalationGame.initializeForkCarryOutcome(sourceGame, snapshotId, peaks, leafCount, carryTotalAttoRep, resolutionBalanceAttoRep);
	}

	/// @notice Resumes a paused fork-continuation escalation game once its carry is funded; callable by anyone.
	function resumeForkedEscalationGame() external {
		_delegate(abi.encodeCall(QuestionLedgerDelegate.resumeForkedEscalationGame, ()));
	}

	/// @notice Forker-only: marks the pool as awaiting escalation fork continuation.
	function markAwaitingForkContinuation() external onlyForker {
		awaitingForkContinuation = true;
		emit AwaitingForkContinuationSet(true);
		refreshSecurityPoolFees();
	}

	/// @notice Forker-only: sets the pool system state.
	function setSystemState(SystemState newState) external onlyForker {
		systemState = newState;
		emit SystemStateSet(systemState);
		refreshSecurityPoolFees();
	}

	/// @notice Forker-only: authorizes a child pool on the share token.
	function authorizeChildQuestionLedger(IQuestionLedger pool) external onlyForker {
		shareToken.authorize(pool);
	}
}
