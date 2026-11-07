// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPoolQuestionAdmissionPolicy } from './interfaces/ISecurityPoolQuestionAdmissionPolicy.sol';

/// @notice Curated, permanently fixed question membership for one origin universe.
/// @dev There is no administrator or mutation API. A portfolio can deploy its allowed ledgers lazily.
contract SecurityPoolFixedAdmissionPolicy is ISecurityPoolQuestionAdmissionPolicy {
	uint248 public immutable universeId;
	uint256[] private questions;

	constructor(uint248 _universeId, uint256[] memory questionIds) {
		require(questionIds.length > 0, 'Question list empty');
		universeId = _universeId;
		for (uint256 index; index < questionIds.length; index++) {
			uint256 questionId = questionIds[index];
			require(index == 0 || questionId > questionIds[index - 1], 'Choose increasing unique questions');
			questions.push(questionId);
		}
	}

	function isQuestionAllowed(address, uint248 requestedUniverseId, uint256 questionId) external view returns (bool) {
		if (requestedUniverseId != universeId) return false;
		uint256 low;
		uint256 high = questions.length;
		while (low < high) {
			uint256 middle = low + (high - low) / 2;
			uint256 candidate = questions[middle];
			if (candidate == questionId) return true;
			if (candidate < questionId) low = middle + 1;
			else high = middle;
		}
		return false;
	}

	function questionCount() external view returns (uint256) {
		return questions.length;
	}

	function getQuestions(uint256 startIndex, uint256 count) external view returns (uint256[] memory page) {
		require(count <= 64 && startIndex <= questions.length, 'Invalid page');
		if (count > questions.length - startIndex) count = questions.length - startIndex;
		page = new uint256[](count);
		for (uint256 index; index < count; index++) page[index] = questions[startIndex + index];
	}
}
