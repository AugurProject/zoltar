// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger, AccountingReason, SystemState } from './interfaces/IQuestionLedger.sol';
import { QuestionLedgerStorage } from './QuestionLedgerStorage.sol';
import { ISecurityPoolAccounting } from './interfaces/ISecurityPoolAccounting.sol';
import { ISecurityPoolSettlement } from './interfaces/ISecurityPoolSettlement.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { IQuestionForker } from './interfaces/IQuestionForker.sol';
import { EscalationGame } from './EscalationGame.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { ZoltarQuestionData } from '../ZoltarQuestionData.sol';

interface IQuestionLedgerRepDepositContext {
	function escalationGameFactory() external view returns (EscalationGameFactory);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
	function questionId() external view returns (uint256);
	function questionData() external view returns (address);
	function repToken() external view returns (address);
	function universeId() external view returns (uint248);
	function refreshSecurityPoolFees() external;
	function zoltar() external view returns (address);
}

interface ISecurityPoolPurchaseAuthority {
	function services() external view returns (address);
}

/// @notice The single fixed delegatecall target for every QuestionLedger operation kept out of its runtime:
/// native fee accounting, security pool credits, checkpoint events, complete sets, redemptions and wallet reporting.
/// @dev Shares QuestionLedger's exact storage layout. Delegatecall preserves the original caller;
/// authorization lives in each target method.
contract QuestionLedgerDelegate is QuestionLedgerStorage {
	using SafeERC20Ops for IERC20;

	event QuestionAccountingCheckpoint(AccountingReason reason, uint256 settlementCollateralAttoEth, uint256 shareTokenSupplyAttoShares, uint256 lastSettlementSecurityPoolTime);

	function setStartingParams() external {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(msg.sender == address(pool.securityPoolFactory()), 'Only factory');
		// Bootstrap placeholder until security pool binding checkpoints the central security pool clock.
		lastSettlementSecurityPoolTime = block.timestamp;
		_emitAccountingCheckpoint(AccountingReason.PoolInitialization);
	}

	function emitQuestionLedgerAccountingCheckpoint(AccountingReason reason) external payable {
		_emitAccountingCheckpoint(reason);
	}

	function _emitAccountingCheckpoint(AccountingReason reason) private {
		emit QuestionAccountingCheckpoint(reason, settlementCollateralAttoEth, shareTokenSupplyAttoShares, lastSettlementSecurityPoolTime);
	}

	/// @notice Mirror the central book after accruing fees and reserving any matured claim for this question.
	function synchronizeSettlement() public payable {
		_synchronizeSettlement(false);
	}

	/// @notice Synchronize a reporting change and the question's prospective central fee stream.
	function refreshSettlement() external payable {
		_synchronizeSettlement(true);
	}

	function _synchronizeSettlement(bool refresh) private {
		require(securityPoolCustody != address(0), 'Security pool settlement missing');
		ISecurityPoolSettlement settlement = ISecurityPoolSettlement(address(securityPoolAccounting));
		uint48 securityPoolTime;
		(shareTokenSupplyAttoShares, settlementCollateralAttoEth, securityPoolTime) = refresh
			? settlement.refreshQuestionSettlement()
			: settlement.checkpointQuestionSettlement();
		lastSettlementSecurityPoolTime = securityPoolTime;
	}

	/// @notice Pool delegate target; payable because delegatecall retains the outer call value.
	function accrueSettlementCollateral() external payable {
		uint256 previousTimestamp = lastSettlementSecurityPoolTime;
		synchronizeSettlement();
		if (lastSettlementSecurityPoolTime != previousTimestamp) _emitAccountingCheckpoint(AccountingReason.Accrual);
	}

	function setSecurityPoolCustody(address custody) external {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(msg.sender == pool.securityPoolFactory().securityPoolOf(pool), 'Only security pool');
		require(custody != address(0) && securityPoolCustody == address(0), 'Custody already bound');
		securityPoolCustody = custody;
		securityPoolAccounting = ISecurityPoolAccounting(msg.sender);
		pool.refreshSecurityPoolFees();
	}

	function creditEscalationSurplus(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		IERC20(address(IQuestionLedger(payable(address(this))).repToken())).safeTransfer(address(securityPoolAccounting), amountAttoRep);
		ISecurityPoolSettlement(address(securityPoolAccounting)).onQuestionRepIncome(amountAttoRep);
	}

	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external {
		require(msg.sender == address(escalationGame), 'Only escalation game');
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		Zoltar zoltar = pool.zoltar();
		IERC20 token = IERC20(address(pool.repToken()));
		if (address(token) == address(zoltar.genesisReputationToken()))
			token.safeApprove(address(zoltar), amountAttoRep);
		zoltar.burnRep(pool.universeId(), amountAttoRep);
	}

	event AwaitingForkContinuationSet(bool awaitingForkContinuation);
	event EscalationGameSet(EscalationGame escalationGame);
	event CompleteSetCreated(address indexed creator, uint256 settlementCollateralProvidedAttoEth, uint256 completeSetsMintedAttoShares, uint256 resultingShareTokenSupplyAttoShares, uint256 resultingSettlementCollateralAttoEth);

	function createCompleteSet(uint256 cash) external returns (uint256 completeSetsToMintAttoShares) {
		IQuestionLedger pool = IQuestionLedger(payable(address(this)));
		require(!awaitingForkContinuation, 'Fork await');
		if (securityPoolCustody != address(0)) {
			address securityPool = pool.securityPoolFactory().securityPoolOf(pool);
			require(msg.sender == ISecurityPoolPurchaseAuthority(securityPool).services(), 'Use security pool purchase');
		}
		require(address(escalationGame) == address(0), 'Escalation mint closed');
		if (cash == 0 || pool.isEscalationResolved()) revert('Settlement unavailable');
		require(block.timestamp < pool.questionData().getQuestionEndDate(pool.questionId()), 'Question ended');
		if (securityPoolCustody != address(0)) {
			(
				completeSetsToMintAttoShares,
				shareTokenSupplyAttoShares,
				settlementCollateralAttoEth
			) = ISecurityPoolSettlement(address(securityPoolAccounting)).mintQuestionSettlement(cash);
			emit CompleteSetCreated(msg.sender, cash, completeSetsToMintAttoShares, shareTokenSupplyAttoShares, settlementCollateralAttoEth);
			return completeSetsToMintAttoShares;
		}
		revert('Security pool settlement missing');
	}

	function _redeemSecurityPoolSettlement(address recipient, uint256 burnedShares) private returns (uint256 paidCashAttoEth) {
		if (burnedShares == 0) return 0;
		(paidCashAttoEth, shareTokenSupplyAttoShares, settlementCollateralAttoEth) = ISecurityPoolSettlement(address(securityPoolAccounting)).redeemQuestionSettlement(recipient, burnedShares);
	}

	/// @notice Pool delegatecall target: deposits the caller's wallet REP into the escalation game, deploying the game if needed.
	/// @dev With `requireLead`, reverts unless the deposit leads outright or fills its non-decision threshold.
	function depositWalletRep(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep, bool requireLead) external {
		IQuestionLedgerRepDepositContext pool = IQuestionLedgerRepDepositContext(address(this));
		Zoltar zoltar = Zoltar(pool.zoltar());
		uint248 universeId = pool.universeId();
		_requireUnforkedOperational(zoltar.getForkTime(universeId));
		require(!awaitingForkContinuation, 'Fork await');
		if (address(escalationGame) == address(0)) {
			require(block.timestamp >= ZoltarQuestionData(pool.questionData()).getQuestionEndDate(pool.questionId()), 'Question active');
			escalationGame = pool.escalationGameFactory().deployEscalationGame(pool.initialEscalationGameDepositAttoRep(), zoltar.getNonDecisionThresholdAttoRep(universeId));
			emit EscalationGameSet(escalationGame);
		}
		require(!escalationGame.forkContinuation() || (securityPoolCustody != address(0) && escalationGame.forkResumedAt() != 0), 'Fork game');
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = requireLead
			? escalationGame.previewLeadingDepositOnOutcome(outcome, maximumDepositAttoRep)
			: escalationGame.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
		// Wallet funding enters dispute escrow directly and never acquires pool backing or capacity.
		IERC20(pool.repToken()).safeTransferFrom(msg.sender, address(escalationGame), depositedAttoRep);
		escalationGame.recordDepositFromQuestionLedger(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
	}

	/// @notice Pool delegatecall target: resumes the paused fork-continuation escalation game and clears the awaiting flag.
	/// @dev This is permissionless for liveness. The immutable carry commitment was
	/// installed during child initialization, so resumption does no unbounded work.
	function resumeForkedEscalationGame() external {
		if (!awaitingForkContinuation || systemState != SystemState.Operational)
			revert('Fork continuation unavailable');
		escalationGame.resumeFromFork();
		if (escalationGame.forkResumedAt() == 0) return;
		awaitingForkContinuation = false;
		emit AwaitingForkContinuationSet(false);
		IQuestionLedgerRepDepositContext(address(this)).refreshSecurityPoolFees();
	}

	/// @notice Pool delegatecall target: burns `redeemer`'s winning shares and returns the settlement collateral owed.
	function redeemShares(IShareToken shareToken, IQuestionForker forker, uint248 universeId, address redeemer) external returns (uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth) {
		BinaryOutcomes.BinaryOutcome outcome = forker.getQuestionOutcome(IQuestionLedger(payable(address(this))));
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		(winningSharesBurnedAttoShares, ) = shareToken.burnTokenIdAndGetRemainingSupply(tokenId, redeemer);
		return (winningSharesBurnedAttoShares, _redeemSecurityPoolSettlement(redeemer, winningSharesBurnedAttoShares));
	}

	/// @notice Pool delegatecall target: burns `redeemer`'s complete sets and returns the settlement collateral owed.
	function redeemCompleteSet(IShareToken shareToken, uint248 universeId, address redeemer, uint256 amountAttoShares) external returns (uint256 settlementCollateralRedeemedAttoEth) {
		shareToken.burnCompleteSets(universeId, redeemer, amountAttoShares);
		return _redeemSecurityPoolSettlement(redeemer, amountAttoShares);
	}
}
