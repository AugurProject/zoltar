// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @notice Authenticates recent canonical execution-block headers and extracts
/// the fields needed to prove an OpenOracle dispute opportunity.
library ExecutionBlockHeaderProof {
	struct Header {
		uint256 number;
		uint256 gasLimit;
		uint256 gasUsed;
		uint256 timestamp;
		uint256 baseFee;
	}

	function parseAndVerify(bytes calldata encodedHeader) internal view returns (Header memory header) {
		(uint256 cursor, uint256 payloadEnd) = _decodeList(encodedHeader);
		uint256 fieldIndex;
		bool foundBaseFee;
		while (cursor < payloadEnd) {
			(uint256 valueOffset, uint256 valueLength, uint256 nextCursor) = _decodeString(
				encodedHeader,
				cursor,
				payloadEnd
			);
			if (fieldIndex == 8) header.number = _decodeUint(encodedHeader, valueOffset, valueLength);
			else if (fieldIndex == 9) header.gasLimit = _decodeUint(encodedHeader, valueOffset, valueLength);
			else if (fieldIndex == 10) header.gasUsed = _decodeUint(encodedHeader, valueOffset, valueLength);
			else if (fieldIndex == 11) header.timestamp = _decodeUint(encodedHeader, valueOffset, valueLength);
			else if (fieldIndex == 15) {
				header.baseFee = _decodeUint(encodedHeader, valueOffset, valueLength);
				foundBaseFee = true;
			}
			cursor = nextCursor;
			fieldIndex++;
		}
		require(cursor == payloadEnd, 'Execution header RLP has trailing data');
		require(foundBaseFee, 'Execution header does not contain a base fee');
		require(header.number < block.number, 'Execution header must be historical');
		require(block.number - header.number <= 256, 'Execution header is outside blockhash history');
		require(blockhash(header.number) == keccak256(encodedHeader), 'Execution header is not canonical');
	}

	function _decodeList(bytes calldata encoded) private pure returns (uint256 payloadOffset, uint256 payloadEnd) {
		require(encoded.length > 0, 'Execution header RLP is empty');
		uint8 prefix = uint8(encoded[0]);
		require(prefix >= 0xc0, 'Execution header RLP must be a list');
		uint256 payloadLength;
		if (prefix <= 0xf7) {
			payloadOffset = 1;
			payloadLength = prefix - 0xc0;
		} else {
			uint256 lengthOfLength = prefix - 0xf7;
			require(
				lengthOfLength <= 8 && 1 + lengthOfLength <= encoded.length,
				'Execution header list length is invalid'
			);
			require(uint8(encoded[1]) != 0, 'Execution header list length is not canonical');
			payloadLength = _readBigEndian(encoded, 1, lengthOfLength);
			require(payloadLength > 55, 'Execution header list length is not canonical');
			payloadOffset = 1 + lengthOfLength;
		}
		payloadEnd = payloadOffset + payloadLength;
		require(payloadEnd == encoded.length, 'Execution header RLP length mismatch');
	}

	function _decodeString(
		bytes calldata encoded,
		uint256 cursor,
		uint256 payloadEnd
	) private pure returns (uint256 valueOffset, uint256 valueLength, uint256 nextCursor) {
		require(cursor < payloadEnd, 'Execution header field is missing');
		uint8 prefix = uint8(encoded[cursor]);
		if (prefix < 0x80) {
			return (cursor, 1, cursor + 1);
		}
		if (prefix <= 0xb7) {
			valueLength = prefix - 0x80;
			valueOffset = cursor + 1;
			nextCursor = valueOffset + valueLength;
			require(nextCursor <= payloadEnd, 'Execution header field exceeds list');
			if (valueLength == 1)
				require(uint8(encoded[valueOffset]) >= 0x80, 'Execution header field is not canonical');
			return (valueOffset, valueLength, nextCursor);
		}
		require(prefix <= 0xbf, 'Nested execution header RLP is invalid');
		uint256 lengthOfLength = prefix - 0xb7;
		require(
			lengthOfLength <= 8 && cursor + 1 + lengthOfLength <= payloadEnd,
			'Execution header field length is invalid'
		);
		require(uint8(encoded[cursor + 1]) != 0, 'Execution header field length is not canonical');
		valueLength = _readBigEndian(encoded, cursor + 1, lengthOfLength);
		require(valueLength > 55, 'Execution header field length is not canonical');
		valueOffset = cursor + 1 + lengthOfLength;
		nextCursor = valueOffset + valueLength;
		require(nextCursor <= payloadEnd, 'Execution header field exceeds list');
	}

	function _decodeUint(bytes calldata encoded, uint256 offset, uint256 length) private pure returns (uint256 value) {
		require(length <= 32, 'Execution header integer is too large');
		if (length == 0) return 0;
		require(uint8(encoded[offset]) != 0, 'Execution header integer is not canonical');
		return _readBigEndian(encoded, offset, length);
	}

	function _readBigEndian(
		bytes calldata encoded,
		uint256 offset,
		uint256 length
	) private pure returns (uint256 value) {
		for (uint256 index = 0; index < length; index++) {
			value = (value << 8) | uint8(encoded[offset + index]);
		}
	}
}
