// SPDX-License-Identifier: UNLICENSE
pragma solidity 0.8.33;

library ScalarTrading {
	uint256 internal constant DECIMALS = 18;

	function getTradeInterval(int256 minValue, int256 maxValue, uint256 numTicks) internal pure returns (int256) {
		require(numTicks > 0, 'numTicks=0');
		require(maxValue > minValue, 'invalid range');
		return (maxValue - minValue) / int256(numTicks);
	}

	function getScalarOutcomeName(uint120[2] memory payoutNumerators, string memory unit, uint256 numTicks, int256 minValue, int256 maxValue) external pure returns (string memory) {
		int256 tradeInterval = getTradeInterval(minValue, maxValue, numTicks);
		int256 scalarValue = minValue + int256(uint256(payoutNumerators[1])) * tradeInterval;
		string memory decimalString = intToDecimalString(scalarValue, DECIMALS);
		if (bytes(unit).length == 0) return decimalString;
		return string.concat(decimalString, ' ', unit);
	}

	function intToDecimalString(int256 value, uint256 decimals) internal pure returns (string memory) {
		bool isNegative = value < 0;
		require(value != type(int256).min, 'int256 min');
		uint256 absoluteValue = value < 0 ? uint256(-value) : uint256(value);
		uint256 base = 10 ** decimals;
		uint256 integerPart = absoluteValue / base;
		uint256 fractionalPart = absoluteValue % base;
		string memory integerString = uintToString(integerPart);
		if (fractionalPart == 0) return isNegative ? string.concat('-', integerString) : integerString;
		bytes memory fractionalBytes = bytes(zeroPadLeft(uintToString(fractionalPart), decimals));
		uint256 trimIndex = fractionalBytes.length;
		while (trimIndex > 0 && fractionalBytes[trimIndex - 1] == bytes1('0')) {
			trimIndex--;
		}
		bytes memory trimmed = new bytes(trimIndex);
		for (uint256 index = 0; index < trimIndex; index++) {
			trimmed[index] = fractionalBytes[index];
		}
		string memory result = string.concat(integerString, '.', string(trimmed));
		return isNegative ? string.concat('-', result) : result;
	}

	function zeroPadLeft(string memory value, uint256 totalLength) internal pure returns (string memory) {
		bytes memory valueBytes = bytes(value);
		if (valueBytes.length >= totalLength) return value;
		bytes memory padded = new bytes(totalLength);
		uint256 paddingLength = totalLength - valueBytes.length;
		for (uint256 index = 0; index < paddingLength; index++) {
			padded[index] = bytes1('0');
		}
		for (uint256 index = 0; index < valueBytes.length; index++) {
			padded[paddingLength + index] = valueBytes[index];
		}
		return string(padded);
	}

	function uintToString(uint256 absoluteValue) internal pure returns (string memory) {
		if (absoluteValue == 0) return '0';
		uint256 tempValue = absoluteValue;
		uint256 digits;
		while (tempValue != 0) {
			digits++;
			tempValue /= 10;
		}
		bytes memory buffer = new bytes(digits);
		while (absoluteValue != 0) {
			digits--;
			buffer[digits] = bytes1(uint8(48 + uint8(absoluteValue % 10)));
			absoluteValue /= 10;
		}
		return string(buffer);
	}
}
