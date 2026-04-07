// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ScalarOutcomes } from './ScalarOutcomes.sol';

 contract ZoltarQuestionData {
	struct QuestionData {
		string title;
		string description;
		uint256 startTime;
		uint256 endTime;
		uint256 numTicks;
		int256 displayValueMin;
		int256 displayValueMax;
		string answerUnit;
	}

	mapping(uint256 => uint256) public questionCreatedTimestamp;
	mapping(uint256 => string[]) public outcomeLabels;
	mapping(uint256 => QuestionData) public questions;
	uint256[] public questionIds;

	function getQuestionId(QuestionData memory questionData, string[] calldata outcomeOptions) public pure returns (uint256) {
		return uint256(keccak256(abi.encode(questionData, outcomeOptions)));
	}

	function createQuestion(QuestionData memory questionData, string[] calldata outcomeOptions) external returns (uint256) {
		uint256 questionId = getQuestionId(questionData, outcomeOptions);
		require(questionCreatedTimestamp[questionId] == 0, 'Question already exists');
		if (outcomeOptions.length == 0) {
			// scalar
			require(questionData.displayValueMax > questionData.displayValueMin, 'max must be greater than min');
			require(questionData.numTicks > 0, 'numTicks needs to be positive');
		}
		else {
  			// Check that all strings are non-empty
			uint256 previous = type(uint256).max;
  			for (uint256 index = 0; index < outcomeOptions.length; index++) {
  				require(bytes(outcomeOptions[index]).length > 0, 'Empty string');
				uint256 iHash = uint256(keccak256(abi.encode(outcomeOptions[index])));
				require (iHash < previous, 'Outcome option hashes not sorted');
				previous = iHash;
			}
			outcomeLabels[questionId] = outcomeOptions;
		}
		questions[questionId] = questionData;
		questionCreatedTimestamp[questionId] = block.timestamp;
		questionIds.push(questionId);

		return questionId;
	}

	function getQuestionCount() external view returns (uint256) {
		return questionIds.length;
	}

	function getQuestions(uint256 startIndex, uint256 numberOfEntries) external view returns (uint256[] memory returnQuestionIds) {
		returnQuestionIds = new uint256[](numberOfEntries);
		uint256 iterateUntil = startIndex + numberOfEntries > questionIds.length ? questionIds.length : startIndex + numberOfEntries;
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnQuestionIds[i - startIndex] = questionIds[i];
		}
	}

	function getQuestionEndDate(uint256 questionId) external view returns (uint256) {
		return questions[questionId].endTime;
	}

	function splitUint256IntoTwoWithInvalid(uint256 value) public pure returns (bool invalid, uint120 firstPart, uint120 secondPart) {
		// Highest bit (bit 255)
		invalid = (value >> 255) == 0;
		// Middle 120 bits
		firstPart = uint120((value >> 120) & ((1 << 120) - 1));
		// Lowest 120 bits
		secondPart = uint120(value & ((1 << 120) - 1));
	}

	function getOutcomeLabels(uint256 questionId, uint256 startIndex, uint256 numberOfEntries) external view returns (string[] memory returnOutcomeLabels) {
		returnOutcomeLabels = new string[](numberOfEntries);
		uint256 iterateUntil = startIndex + numberOfEntries > outcomeLabels[questionId].length ? outcomeLabels[questionId].length : startIndex + numberOfEntries;
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnOutcomeLabels[i - startIndex] = outcomeLabels[questionId][i];
		}
	}

	function isMalformedAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		if (outcomeLabels[questionId].length == 0) { // scalar
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return false;
				return true;
			}
			// When invalid=false (high bit set), malformed iff sum != numTicks
			// Use uint256 for addition to prevent overflow when numTicks > 2^120
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			return sum != questions[questionId].numTicks;
		}
		if (answer == 0) return false;
		if (answer < outcomeLabels[questionId].length + 1) { // categorical
			return false;
		}
		return true;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		if (outcomeLabels[questionId].length == 0) { // scalar
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return 'Invalid';
				return 'Malformed';
			}
			// Use uint256 for addition to prevent overflow when numTicks > 2^120
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			if (sum == questions[questionId].numTicks) {
				return ScalarOutcomes.getScalarOutcomeName([firstPart, secondPart], questions[questionId].answerUnit, questions[questionId].numTicks, questions[questionId].displayValueMin, questions[questionId].displayValueMax);
			}
		}
		else if (answer == 0) return 'Invalid';
		else if (answer < outcomeLabels[questionId].length + 1) { // categorical
			return outcomeLabels[questionId][answer - 1];
		}
		return 'Malformed';
	}
}
