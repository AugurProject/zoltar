// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Pagination } from './Pagination.sol';

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
			bytes32[] memory normalizedHashes = new bytes32[](outcomeOptions.length);
			for (uint256 index = 0; index < outcomeOptions.length; index++) {
				require(bytes(outcomeOptions[index]).length > 0, 'Outcome option label must not be an empty string');
				bytes32 normalizedHash = _validatedOutcomeLabelHash(bytes(outcomeOptions[index]));
				for (uint256 previousIndex; previousIndex < index; previousIndex++)
					require(normalizedHashes[previousIndex] != normalizedHash, 'Outcome labels must be unique ignoring case');
				normalizedHashes[index] = normalizedHash;
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

	/// @dev An allow-list bounds validation and excludes invisible, malformed and confusable Unicode.
	function _validatedOutcomeLabelHash(bytes memory label) private pure returns (bytes32) {
		require(label.length != 0 && label.length <= 64, 'Outcome label must use 1-64 printable ASCII characters with single interior spaces');
		for (uint256 i; i < label.length; i++) {
			uint8 character = uint8(label[i]);
			require(character >= 0x20 && character <= 0x7e && (character != 0x20 || (i != 0 && i + 1 < label.length && label[i - 1] != 0x20)), 'Outcome label must use 1-64 printable ASCII characters with single interior spaces');
			if (character >= 65 && character <= 90) label[i] = bytes1(character + 32);
		}
		require(!_isReservedOutcomeLabel(label), 'Reserved protocol outcome label');
		return keccak256(label);
	}

	function _isReservedOutcomeLabel(bytes memory label) private pure returns (bool) {
		bytes memory normalized = new bytes(label.length);
		uint256 length;
		// The caller has validated and lowercased printable ASCII. Interior spaces
		// remain significant for uniqueness, but not for reserved protocol names.
		for (uint256 i; i < label.length; i++) {
			if (label[i] != 0x20) normalized[length++] = label[i];
		}
		assembly {
			mstore(normalized, length)
		}
		bytes32 hash = keccak256(normalized);
		return hash == keccak256('invalid') || hash == keccak256('malformed');
	}

	function getQuestionCount() external view returns (uint256) {
		return questionIds.length;
	}

	function getQuestions(uint256 startIndex, uint256 numberOfEntries) external view returns (uint256[] memory returnQuestionIds) {
		uint256 iterateUntil = Pagination.sliceEnd(startIndex, numberOfEntries, questionIds.length);
		if (iterateUntil <= startIndex) return new uint256[](0);
		returnQuestionIds = new uint256[](iterateUntil - startIndex);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnQuestionIds[i - startIndex] = questionIds[i];
		}
	}

	function getQuestionEndDate(uint256 questionId) external view returns (uint256) {
		return questions[questionId].endTime;
	}

	/// @dev Bit 255 is set for a non-invalid scalar answer; bits 240..254 are
	/// reserved. Bits 120..239 and 0..119 hold the two uint120 payout numerators.
	/// This decoder only splits fields; answer validation checks reserved bits and sums.
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
		uint256 iterateUntil = Pagination.sliceEnd(startIndex, numberOfEntries, outcomeLabels[questionId].length);
		if (iterateUntil <= startIndex) return new string[](0);
		returnOutcomeLabels = new string[](iterateUntil - startIndex);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			returnOutcomeLabels[i - startIndex] = outcomeLabels[questionId][i];
		}
	}

	function isMalformedAnswerOption(uint256 questionId, uint256 answer) external view returns (bool) {
		if (outcomeLabels[questionId].length == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return true;
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return false;
				return true;
			}
			// When invalid=false (high bit set), malformed iff sum != numTicks.
			// An unregistered question has zero ticks and so no valid scalar answer.
			uint256 numTicks = questions[questionId].numTicks;
			return numTicks == 0 || uint256(firstPart) + uint256(secondPart) != numTicks;
		}
		if (answer == 0) return false;
		if (answer < outcomeLabels[questionId].length + 1) {
			// categorical
			return false;
		}
		return true;
	}

	function getAnswerOptionName(uint256 questionId, uint256 answer) external view returns (string memory) {
		if (outcomeLabels[questionId].length == 0) {
			// scalar
			if (hasNonZeroScalarReservedBits(answer)) return 'Malformed';
			(bool invalid, uint120 firstPart, uint120 secondPart) = splitUint256IntoTwoWithInvalid(answer);
			if (invalid) {
				if (firstPart == 0 && secondPart == 0) return 'Invalid';
				return 'Malformed';
			}
			uint256 sum = uint256(firstPart) + uint256(secondPart);
			if (questions[questionId].numTicks != 0 && sum == questions[questionId].numTicks) {
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
