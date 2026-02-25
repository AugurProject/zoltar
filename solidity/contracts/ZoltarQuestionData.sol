// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ScalarTrading } from './ScalarTrading.sol';

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

	function getQuestionId(QuestionData memory questionData, string[] calldata outcomeOptions) public pure returns (uint256) {
		return uint256(keccak256(abi.encode(questionData, outcomeOptions)));
	}

	function createQuestion(QuestionData memory questionData, string[] calldata outcomeOptions) external returns (uint256) {
		uint256 questionId = getQuestionId(questionData, outcomeOptions);
		require(questionCreatedTimestamp[questionId] == 0, 'Market already exists');
		if (outcomeOptions.length == 0) {
			// scalar
			require(questionData.displayValueMax - questionData.displayValueMin > 0, 'max need to be bigger than min and subtraction cannot overflow');
			require(questionData.numTicks > 0, 'numticks need to be positive');
		}
		questions[questionId] = questionData;
		questionCreatedTimestamp[questionId] = block.timestamp;
		outcomeLabels[questionId] = outcomeOptions; // TODO, we could check that these are unique (assume sorted) and non empty?
		return questionId;
	}

	function getMarketEndDate(uint256 questionId) external view returns (uint256) {
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

	function isValidAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		if (outcomeLabels[questionId].length == 0) { // scalar
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return true;
				return false;
			}
			return firstPart + secondPart == questions[questionId].numTicks;
		}
		if (answer == 0) return true;
		if (answer < outcomeLabels[questionId].length + 1) { // categorical
			return true;
		}
		return false;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		if (outcomeLabels[questionId].length == 0) { // scalar
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return 'Invalid';
				return 'Malformed';
			}
			if (firstPart + secondPart == questions[questionId].numTicks) {
				return ScalarTrading.getScalarOutcomeName([firstPart, secondPart], questions[questionId].answerUnit, questions[questionId].numTicks, questions[questionId].displayValueMin, questions[questionId].displayValueMax);
			}
		}
		else if (answer == 0) return 'Invalid';
		else if (answer < outcomeLabels[questionId].length + 1) { // categorical
			return outcomeLabels[questionId][answer - 1];
		}
		return 'Malformed';
	}
}
