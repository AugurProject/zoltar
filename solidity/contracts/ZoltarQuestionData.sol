// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ScalarOutcomes } from './ScalarOutcomes.sol';

contract ZoltarQuestionData {
	uint256 private constant SCALAR_RESERVED_BITS_MASK = ((uint256(1) << 15) - 1) << 240;

	struct QuestionData {
		string title;
		string description;
		uint48 startTime;
		uint48 endTime;
		uint120 numTicks;
		int256 displayValueMin;
		int256 displayValueMax;
		string answerUnit;
	}
	struct ProtocolQuestionData {
		uint48 startTime;
		uint48 endTime;
		uint120 numTicks;
		uint32 outcomeCount;
		bool isBinary;
	}

	mapping(uint256 => uint256) public questionCreatedTimestamp;
	mapping(uint256 => QuestionData) public questions;
	mapping(uint256 => ProtocolQuestionData) public protocolQuestions;

	event QuestionCreated(uint256 indexed questionId, uint256 createdTimestamp, QuestionData questionData, string[] outcomeOptions);

	function getQuestionId(QuestionData memory questionData, string[] calldata outcomeOptions) public pure returns (uint256) {
		if (outcomeOptions.length != 0) {
			return
				uint256(keccak256(abi.encode(questionData.startTime, questionData.endTime, keccak256(abi.encode(questionData.title, questionData.description, outcomeOptions)))));
		}
		return uint256(keccak256(abi.encode(questionData, outcomeOptions)));
	}

	function createQuestion(QuestionData memory questionData, string[] calldata outcomeOptions) external returns (uint256) {
		uint256 questionId = getQuestionId(questionData, outcomeOptions);
		require(questionCreatedTimestamp[questionId] == 0, 'Question already exists and cannot be created twice');
		require(questionData.endTime >= questionData.startTime, 'Question end time must be on or after the start time');
		if (outcomeOptions.length == 0) {
			// scalar
			require(questionData.displayValueMax > questionData.displayValueMin, 'Scalar question display max must be greater than display min');
			require(questionData.numTicks > 0, 'Scalar question numTicks must be positive');
		} else {
			require(outcomeOptions.length <= type(uint32).max, 'Categorical question has too many outcomes');
			require(questionData.numTicks == 0, 'Categorical question numTicks must be zero');
			require(questionData.displayValueMin == 0 && questionData.displayValueMax == 0, 'Categorical question display range must be zero');
			require(bytes(questionData.answerUnit).length == 0, 'Categorical question answer unit must be empty');
			// Check that all strings are non-empty
			uint256 previous = type(uint256).max;
			for (uint256 index = 0; index < outcomeOptions.length; index++) {
				require(bytes(outcomeOptions[index]).length > 0, 'Outcome option label must not be an empty string');
				uint256 iHash = uint256(keccak256(abi.encode(outcomeOptions[index])));
				require(iHash < previous, 'Outcome option hashes must be provided in descending sorted order');
				previous = iHash;
			}
		}
		bool isBinary =
			outcomeOptions.length == 2 &&
				keccak256(bytes(outcomeOptions[0])) == keccak256(bytes('Yes')) &&
				keccak256(bytes(outcomeOptions[1])) == keccak256(bytes('No'));
		protocolQuestions[questionId] = ProtocolQuestionData(questionData.startTime, questionData.endTime, questionData.numTicks, uint32(outcomeOptions.length), isBinary);
		if (outcomeOptions.length == 0) questions[questionId] = questionData;
		questionCreatedTimestamp[questionId] = block.timestamp;
		emit QuestionCreated(questionId, questionCreatedTimestamp[questionId], questionData, outcomeOptions);

		return questionId;
	}

	function splitUint256IntoTwoWithInvalid(uint256 value) public pure returns (bool invalid, uint120 firstPart, uint120 secondPart) {
		// Highest bit (bit 255)
		invalid = (value >> 255) == 0;
		// Middle 120 bits
		firstPart = uint120((value >> 120) & ((1 << 120) - 1));
		// Lowest 120 bits
		secondPart = uint120(value & ((1 << 120) - 1));
	}

	function getQuestionEndDate(uint256 questionId) external view returns (uint256) {
		return protocolQuestions[questionId].endTime;
	}

	function hasNonZeroScalarReservedBits(uint256 answer) public pure returns (bool) {
		return answer & SCALAR_RESERVED_BITS_MASK != 0;
	}

	function isMalformedAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		ProtocolQuestionData memory protocolQuestion = protocolQuestions[questionId];
		if (protocolQuestion.outcomeCount == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return true;
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return false;
				return true;
			}
			// When invalid=false (high bit set), malformed iff sum != numTicks
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			return sum != protocolQuestion.numTicks;
		}
		if (answer == 0) return false;
		if (answer < uint256(protocolQuestion.outcomeCount) + 1) {
			// categorical
			return false;
		}
		return true;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		ProtocolQuestionData memory protocolQuestion = protocolQuestions[questionId];
		if (protocolQuestion.outcomeCount == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return 'Malformed';
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return 'Invalid';
				return 'Malformed';
			}
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			if (sum == protocolQuestion.numTicks) {
				return
					ScalarOutcomes.getScalarOutcomeName([firstPart, secondPart], questions[questionId].answerUnit, questions[questionId].numTicks, questions[questionId].displayValueMin, questions[questionId].displayValueMax);
			}
		} else {
			if (answer == 0) return 'Invalid';
			if (answer < uint256(protocolQuestion.outcomeCount) + 1) return 'Categorical outcome';
		}
		return 'Malformed';
	}
}
