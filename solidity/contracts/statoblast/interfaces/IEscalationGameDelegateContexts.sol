// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { BinaryOutcomes } from '../BinaryOutcomes.sol';
import { SystemState } from './ISecurityPool.sol';

/// @dev Escalation game reads available to the deposit delegate while it runs in the game's context.
interface IEscalationGameDepositContext {
	function getQuestionResolution() external view returns (BinaryOutcomes.BinaryOutcome);
	function hasReachedNonDecision() external view returns (bool);
	function previewDepositOnOutcome(BinaryOutcomes.BinaryOutcome outcome, uint256 amountAttoRep) external view returns (uint256 acceptedAmountAttoRep, uint256 resultingCumulativeAmountAttoRep);
	function repToken() external view returns (address);
	function securityPool() external view returns (address);
	function getBindingCapitalAttoRep() external view returns (uint256);
	function computeTimeSinceStartFromAttritionCostAttoRep(uint256 amountAttoRep) external view returns (uint256);
	function isForkCarryFundingComplete() external view returns (bool);
}

/// @dev Security pool reads the escalation deposit delegate needs to validate deposits and authorization.
interface IEscalationGameSecurityPoolContext {
	function escalationGame() external view returns (address);
	function questionId() external view returns (uint256);
	function securityPoolForker() external view returns (address);
	function systemState() external view returns (SystemState);
	function universeId() external view returns (uint248);
	function zoltar() external view returns (address);
}
