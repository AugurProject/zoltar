// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, SystemState } from './interfaces/ISecurityPool.sol';
import { SecurityPoolSettlementDelegate } from './SecurityPoolSettlementDelegate.sol';
import { IERC20 } from '../IERC20.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { BinaryOutcomes } from './BinaryOutcomes.sol';
import { ISecurityPoolForker } from './interfaces/ISecurityPoolForker.sol';
import { EscalationGame } from './EscalationGame.sol';
import { EscalationGameFactory } from './factories/EscalationGameFactory.sol';
import { IShareToken } from './interfaces/IShareToken.sol';
import { IQuestionEndTime, IZoltarForkState } from './interfaces/IZoltarForkState.sol';

interface ISecurityPoolRepDepositContext {
	function escalationGameFactory() external view returns (EscalationGameFactory);
	function initialEscalationGameDepositAttoRep() external view returns (uint256);
	function questionId() external view returns (uint256);
	function questionData() external view returns (address);
	function repToken() external view returns (address);
	function universeId() external view returns (uint248);
	function refreshPortfolioFees() external;
	function zoltar() external view returns (address);
}

contract SecurityPoolOperationsDelegate is SecurityPoolSettlementDelegate {
	using SafeERC20Ops for IERC20;

	event AwaitingForkContinuationSet(bool awaitingForkContinuation);

	/// @notice Decodes an `Error(string)` revert payload into its reason, or returns a generic failure message.
	function decodeError(bytes calldata result) external pure returns (string memory reason) {
		if (result.length < 68 || bytes4(result[:4]) != bytes4(keccak256('Error(string)')))
			return 'Delegate call failed';
		return abi.decode(result[4:], (string));
	}

	event EscalationGameSet(EscalationGame escalationGame);

	/// @notice Pool delegatecall target: deposits the caller's wallet REP into the escalation game, deploying the game if needed.
	function depositWalletRepToEscalationGame(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external {
		ISecurityPoolRepDepositContext pool = ISecurityPoolRepDepositContext(address(this));
		IZoltarForkState zoltar = IZoltarForkState(pool.zoltar());
		uint248 universeId = pool.universeId();
		_requireUnforkedOperational(zoltar.getForkTime(universeId));
		require(!awaitingForkContinuation, 'Fork await');
		if (address(escalationGame) == address(0)) {
			require(block.timestamp >= IQuestionEndTime(pool.questionData()).getQuestionEndDate(pool.questionId()), 'Question active');
			escalationGame = pool.escalationGameFactory().deployEscalationGame(pool.initialEscalationGameDepositAttoRep(), zoltar.getNonDecisionThresholdAttoRep(universeId));
			emit EscalationGameSet(escalationGame);
		}
		require(!escalationGame.forkContinuation() || (portfolioCustody != address(0) && escalationGame.forkResumedAt() != 0), 'Fork game');
		(uint256 depositedAttoRep, uint256 resultingCumulativeAttoRep) = escalationGame.previewDepositOnOutcome(outcome, maximumDepositAttoRep);
		// Wallet funding enters dispute escrow directly and never acquires pool backing or capacity.
		IERC20(pool.repToken()).safeTransferFrom(msg.sender, address(escalationGame), depositedAttoRep);
		escalationGame.recordDepositFromSecurityPool(msg.sender, outcome, depositedAttoRep, resultingCumulativeAttoRep);
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
		ISecurityPoolRepDepositContext(address(this)).refreshPortfolioFees();
	}

	/// @notice Pool delegatecall target: burns `redeemer`'s winning shares and returns the settlement collateral owed.
	function redeemShares(IShareToken shareToken, ISecurityPoolForker forker, uint248 universeId, address redeemer) external returns (uint256 winningSharesBurnedAttoShares, uint256 settlementCollateralRedeemedAttoEth) {
		BinaryOutcomes.BinaryOutcome outcome = forker.getQuestionOutcome(ISecurityPool(payable(address(this))));
		require(outcome != BinaryOutcomes.BinaryOutcome.None, 'Question not final');
		uint256 tokenId = shareToken.getTokenId(universeId, outcome);
		(winningSharesBurnedAttoShares, ) = shareToken.burnTokenIdAndGetRemainingSupply(tokenId, redeemer);
		return (winningSharesBurnedAttoShares, _redeemPortfolioSettlement(redeemer, winningSharesBurnedAttoShares));
	}

	/// @notice Pool delegatecall target: burns `redeemer`'s complete sets and returns the settlement collateral owed.
	function redeemCompleteSet(IShareToken shareToken, uint248 universeId, address redeemer, uint256 amountAttoShares) external returns (uint256 settlementCollateralRedeemedAttoEth) {
		shareToken.burnCompleteSets(universeId, redeemer, amountAttoShares);
		return _redeemPortfolioSettlement(redeemer, amountAttoShares);
	}
}
