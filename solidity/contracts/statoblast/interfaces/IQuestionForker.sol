// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger } from './IQuestionLedger.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
interface IQuestionForker {
	function initiateQuestionLedgerFork(IQuestionLedger questionLedger) external;
	function preparePortfolioQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger);
	function materializePortfolioQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger);
	function createChildUniverse(IQuestionLedger questionLedger, uint256 outcomeIndex) external;
	function forkZoltarWithOwnEscalationGame(IQuestionLedger questionLedger) external;
	function getQuestionOutcome(IQuestionLedger questionLedger) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
