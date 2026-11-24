// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { SystemState } from './IQuestionLedger.sol';

/// @dev Escalation game reads available to the deposit delegate while it runs in the game's context.
interface IEscalationGameDepositContext {
	function getQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function getFinalQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function getEscalationGameEndDate() external view returns (uint256);
	function hasReachedNonDecision() external view returns (bool);
	function previewDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external view returns (uint256 acceptedAmountAttoRep, uint256 resultingCumulativeAmountAttoRep);
	function previewLeadingDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 maximumDepositAttoRep) external view returns (uint256 acceptedAmountAttoRep, uint256 resultingCumulativeAmountAttoRep);
	function repToken() external view returns (address);
	function questionLedger() external view returns (address);
	function computeCurveFinalityElapsed() external view returns (uint256);
	function getBindingCapitalAttoRep() external view returns (uint256);
	function totalCostAttoRep() external view returns (uint256);
	function computeTimeSinceStartFromAttritionCostAttoRep(uint256 amountAttoRep) external view returns (uint256);
	function isForkCarryFundingComplete() external view returns (bool);
}

/// @dev Question ledger reads the escalation deposit delegate needs to validate deposits and authorization.
interface IEscalationGameQuestionLedgerContext {
	function escalationGame() external view returns (address);
	function questionId() external view returns (uint256);
	function questionForker() external view returns (address);
	function systemState() external view returns (SystemState);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (address);
	function creditEscalationSurplus(uint256 amountAttoRep) external;
	function refreshSecurityPoolFees() external;
	function burnEscalationWinnerHaircut(uint256 amountAttoRep) external;
}
