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

	// Each mapping is keyed by the question ID returned by getQuestionId.
	mapping(uint256 => uint256) public questionCreatedTimestamp;
	mapping(uint256 => string[]) private outcomeLabels;
	mapping(uint256 => QuestionData) public questions;
	uint256[] private questionIds;

	event QuestionCreated(uint256 indexed questionId, uint256 createdTimestamp, QuestionData questionData, string[] outcomeOptions);

	function getQuestionId(QuestionData memory questionData, string[] calldata outcomeOptions) public pure returns (uint256) {
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
			uint256 previous = type(uint256).max;
			for (uint256 index = 0; index < outcomeOptions.length; index++) {
				require(bytes(outcomeOptions[index]).length > 0, 'Outcome option label must not be an empty string');
				require(!_isReservedOutcomeLabel(bytes(outcomeOptions[index])), 'Reserved protocol outcome label');
				uint256 iHash = uint256(keccak256(abi.encode(outcomeOptions[index])));
				require(iHash < previous, 'Outcome option hashes must be provided in descending sorted order');
				previous = iHash;
			}
			outcomeLabels[questionId] = outcomeOptions;
		}
		questions[questionId] = questionData;
		questionCreatedTimestamp[questionId] = block.timestamp;
		questionIds.push(questionId);
		emit QuestionCreated(questionId, questionCreatedTimestamp[questionId], questionData, outcomeOptions);

		return questionId;
	}

	function _isReservedOutcomeLabel(bytes memory label) private pure returns (bool) {
		bytes memory normalized = new bytes(label.length);
		uint256 length;
		for (uint256 i; i < label.length; ) {
			uint256 whitespaceLength = _outcomeWhitespaceLength(label, i);
			if (whitespaceLength != 0) {
				i += whitespaceLength;
				continue;
			}
			uint8 character = uint8(label[i++]);
			normalized[length++] = bytes1(character >= 65 && character <= 90 ? character + 32 : character);
		}
		assembly {
			mstore(normalized, length)
		}
		bytes32 hash = keccak256(normalized);
		return hash == keccak256('invalid') || hash == keccak256('malformed');
	}

	function _outcomeWhitespaceLength(bytes memory label, uint256 index) private pure returns (uint256) {
		uint8 first = uint8(label[index]);
		if (first <= 0x20) return 1;
		if (index + 1 >= label.length) return 0;
		uint8 second = uint8(label[index + 1]);
		if (first == 0xc2 && (second == 0x85 || second == 0xa0 || second == 0xad)) return 2;
		if (index + 2 >= label.length) return 0;
		uint8 third = uint8(label[index + 2]);
		if (first == 0xe1 && second == 0x9a && third == 0x80) return 3;
		if (first == 0xe2) {
			if (second == 0x80 && ((third >= 0x80 && third <= 0x8f) || (third >= 0xa8 && third <= 0xaf))) return 3;
			if (second == 0x81 && (third == 0x9f || third == 0xa0 || (third >= 0xa6 && third <= 0xa9))) return 3;
		}
		if (first == 0xe3 && second == 0x80 && third == 0x80) return 3;
		if (first == 0xef && second == 0xbb && third == 0xbf) return 3;
		return 0;
	}

	function getQuestionCount() external view returns (uint256) {
		return questionIds.length;
	}

	function getQuestions(uint256 startIndex, uint256 numberOfEntries) external view returns (uint256[] memory returnQuestionIds) {
		uint256 iterateUntil = _sliceEnd(startIndex, numberOfEntries, questionIds.length);
		if (iterateUntil <= startIndex) return new uint256[](0);
		returnQuestionIds = new uint256[](iterateUntil - startIndex);
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

	function hasNonZeroScalarReservedBits(uint256 answer) public pure returns (bool) {
		return answer & SCALAR_RESERVED_BITS_MASK != 0;
	}

	function getOutcomeLabels(uint256 questionId, uint256 startIndex, uint256 numberOfEntries) external view returns (string[] memory returnOutcomeLabels) {
		uint256 iterateUntil = _sliceEnd(startIndex, numberOfEntries, outcomeLabels[questionId].length);
		if (iterateUntil <= startIndex) return new string[](0);
		returnOutcomeLabels = new string[](iterateUntil - startIndex);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnOutcomeLabels[i - startIndex] = outcomeLabels[questionId][i];
		}
	}

	function _sliceEnd(uint256 startIndex, uint256 count, uint256 total) internal pure returns (uint256) {
		if (startIndex >= total || count == 0) return startIndex;
		uint256 availableCount = total - startIndex;
		if (count >= availableCount) return total;
		return startIndex + count;
	}

	function isMalformedAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		if (questionCreatedTimestamp[questionId] == 0) return true;
		if (outcomeLabels[questionId].length == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return true;
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return false;
				return true;
			}
			// When invalid=false (high bit set), malformed iff sum != numTicks
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			return sum != questions[questionId].numTicks;
		}
		if (answer == 0) return false;
		if (answer < outcomeLabels[questionId].length + 1) {
			// categorical
			return false;
		}
		return true;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		if (questionCreatedTimestamp[questionId] == 0) return 'Malformed';
		if (outcomeLabels[questionId].length == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return 'Malformed';
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return 'Invalid';
				return 'Malformed';
			}
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			if (sum == questions[questionId].numTicks) {
				return
					ScalarOutcomes.getScalarOutcomeName([firstPart, secondPart], questions[questionId].answerUnit, questions[questionId].numTicks, questions[questionId].displayValueMin, questions[questionId].displayValueMax);
			}
		} else if (answer == 0) return 'Invalid';
		else if (answer < outcomeLabels[questionId].length + 1) {
			// categorical
			return outcomeLabels[questionId][answer - 1];
		}
		return 'Malformed';
	}
}
