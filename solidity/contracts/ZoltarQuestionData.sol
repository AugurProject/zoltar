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
		string[] outcomeLabels; // TODO, do we need to cap this somehow?
		int256 displayValueMin;
		int256 displayValueMax;
		string answerUnit;
	}

	mapping(uint256 => uint256) questionCreatedTimestamp;
	mapping(uint256 => QuestionData) questions;

	function getQuestionId(QuestionData memory questionData) public pure returns (uint256) {
		return uint256(keccak256(abi.encode(questionData)));
	}

	function createQuestion(QuestionData memory questionData) external returns (uint256) {
		uint256 questionId = getQuestionId(questionData);
		require(questionCreatedTimestamp[questionId] == 0, 'Market already exists');
		questions[questionId] = questionData;
		questionCreatedTimestamp[questionId] = block.timestamp;
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

	function isValidAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		if (questions[questionId].outcomeLabels.length == 0) { // scalar
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return true;
				return false;
			}
			return firstPart + secondPart == questions[questionId].numTicks;
		}
		if (answer == 0) return true;
		if (answer < questions[questionId].outcomeLabels.length + 1) { // categorical
			return true;
		}
		return false;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		if (questions[questionId].outcomeLabels.length == 0) { // scalar
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
		else if (answer < questions[questionId].outcomeLabels.length + 1) { // categorical
			return questions[questionId].outcomeLabels[answer - 1];
		}
		return 'Malformed';
	}
}
