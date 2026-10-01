// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Narrow Zoltar fork-state reads used by Statoblast delegates.
interface IZoltarForkState {
	function getNonDecisionThresholdAttoRep(uint248 universeId) external view returns (uint256);
	function getForkTime(uint248 universeId) external view returns (uint256);
}

/// @dev Narrow question-data read used by Statoblast delegates.
interface IQuestionEndTime {
	function getQuestionEndDate(uint256 questionId) external view returns (uint256);
}
