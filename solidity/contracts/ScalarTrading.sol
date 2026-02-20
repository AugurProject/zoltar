// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

library ScalarTrading {
	int256 internal constant MIN_TRADE_INTERVAL = 10 ** 14;
	int256 internal constant TRADE_INTERVAL_VALUE = 10 ** 19;
	uint256 internal constant DECIMALS = 18;

	function getTradeInterval(int256 displayRange, uint256 numTicks) internal pure returns (int256) {
		int256 displayAmount = (TRADE_INTERVAL_VALUE * (10 ** 18)) / displayRange;
		int256 displayInterval = MIN_TRADE_INTERVAL;
		while (displayInterval < displayAmount) {
			displayInterval = displayInterval * 10;
		}
		return (displayInterval * displayRange) / int256(uint256(numTicks)) / (10 ** 18);
	}

	function getScalarOutcomeName(uint120[2] memory payoutNumerators, string memory unit, uint256 numTicks, int256 minValue, int256 maxValue) external pure returns (string memory) {
		int256 tradeInterval = getTradeInterval(maxValue - minValue, numTicks);
		int256 scalarValue = (int256(uint256(payoutNumerators[1])) + minValue) * tradeInterval;
		string memory decimalString = intToDecimalString(scalarValue, DECIMALS);
		if (bytes(unit).length == 0) return decimalString;
		return string.concat(decimalString, ' ', unit);
	}

	function intToDecimalString(int256 value, uint256 decimals) internal pure returns (string memory) {
		bool isNegative = value < 0;
		uint256 absoluteValue = value < 0 ? uint256(-value) : uint256(value);

		uint256 integerPart = absoluteValue / (10 ** decimals);
		uint256 fractionalPart = absoluteValue % (10 ** decimals);

		string memory integerString = uintToString(integerPart);
		if (fractionalPart == 0) return isNegative ? string.concat('-', integerString) : integerString;
		bytes memory fractionalBytes = bytes(zeroPadLeft(uintToString(fractionalPart), uint256(decimals)));

		int256 trimIndex = int256(fractionalBytes.length);
		while (trimIndex > 0 && fractionalBytes[uint256(trimIndex - 1)] == bytes1('0')) {
			trimIndex = trimIndex - 1;
		}

		bytes memory trimmedFractional = new bytes(uint256(trimIndex));
		for (int256 index = 0; index < trimIndex; index++) {
			trimmedFractional[uint256(index)] = fractionalBytes[uint256(index)];
		}

		string memory result = string.concat(integerString, '.', string(trimmedFractional));
		if (isNegative) return string.concat('-', result);
		return result;
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
			tempValue = tempValue / 10;
		}

		bytes memory buffer = new bytes(uint256(digits));
		while (absoluteValue != 0) {
			digits -= 1;
			buffer[uint256(digits)] = bytes1(uint8(48 + uint8(absoluteValue % 10)));
			absoluteValue = absoluteValue / 10;
		}
		return string(buffer);
	}
}
