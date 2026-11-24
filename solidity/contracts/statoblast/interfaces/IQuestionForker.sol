// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IQuestionLedger } from './IQuestionLedger.sol';
import { BinaryOutcomes } from '../BinaryOutcomes.sol';
interface IQuestionForker {
	function initiateQuestionLedgerFork(IQuestionLedger questionLedger) external;
	function prepareSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger);
	function materializeSecurityPoolQuestion(IQuestionLedger source, uint248 targetUniverse) external returns (IQuestionLedger);
	function createChildUniverse(IQuestionLedger questionLedger, uint256 outcomeIndex) external;
	function forkZoltarWithOwnEscalationGame(IQuestionLedger questionLedger) external;
	function getOwnForkAdmissionShortfall(IQuestionLedger questionLedger) external view returns (address reporterLedger, uint256 shortfallAttoRep);
	function getQuestionOutcome(IQuestionLedger questionLedger) external view returns (BinaryOutcomes.BinaryOutcome outcome);
}
