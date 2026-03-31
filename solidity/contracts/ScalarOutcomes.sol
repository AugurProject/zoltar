// SPDX-License-Identifier: UNLICENSE
pragma solidity 0.8.33;

library ScalarOutcomes {
	uint256 internal constant DECIMALS = 18;

	function getScalarOutcomeName(uint120[2] memory payoutNumerators, string memory unit, uint256 numTicks, int256 minValue, int256 maxValue) internal pure returns (string memory) {
		require(numTicks > 0, 'numTicks=0');
		require(maxValue > minValue, 'invalid range');
		uint256 payout = uint256(payoutNumerators[1]);
		uint256 diffU;
		unchecked {
			diffU = uint256(maxValue) - uint256(minValue);
		}
		uint256 scalarValueU = mulDiv(payout, diffU, numTicks);
		int256 scalarValue = addInt256Uint256(minValue, scalarValueU);
		string memory decimalString = intToDecimalString(scalarValue, DECIMALS);
		if (bytes(unit).length == 0) return decimalString;
		return string.concat(decimalString, ' ', unit);
	}

	function addInt256Uint256(int256 value, uint256 addend) internal pure returns (int256) {
		if (value >= 0) {
			uint256 valueU = uint256(value);
			require(addend <= uint256(type(int256).max) - valueU, 'scalarValue overflow');
			return int256(valueU + addend);
		}
		uint256 absoluteValue = absoluteInt256(value);
		if (addend >= absoluteValue) {
			uint256 positiveValue = addend - absoluteValue;
			require(positiveValue <= uint256(type(int256).max), 'scalarValue overflow');
			return int256(positiveValue);
		}
		uint256 negativeValue = absoluteValue - addend;
		require(negativeValue <= uint256(type(int256).max) + 1, 'scalarValue overflow');
		if (negativeValue == uint256(type(int256).max) + 1) return type(int256).min;
		return -int256(negativeValue);
	}

	function absoluteInt256(int256 value) internal pure returns (uint256) {
		if (value >= 0) return uint256(value);
		unchecked {
			return uint256(-(value + 1)) + 1;
		}
	}

	function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
		require(denominator > 0, 'denominator=0');
		unchecked {
			uint256 prod0;
			uint256 prod1;
			assembly {
				let mm := mulmod(x, y, not(0))
				prod0 := mul(x, y)
				prod1 := sub(sub(mm, prod0), lt(mm, prod0))
			}
			if (prod1 == 0) {
				return prod0 / denominator;
			}
			require(denominator > prod1, 'mulDiv overflow');
			uint256 remainder;
			assembly {
				remainder := mulmod(x, y, denominator)
				prod1 := sub(prod1, gt(remainder, prod0))
				prod0 := sub(prod0, remainder)
			}
			uint256 twos = denominator & (~denominator + 1);
			assembly {
				denominator := div(denominator, twos)
				prod0 := div(prod0, twos)
				twos := add(div(sub(0, twos), twos), 1)
			}
			prod0 |= prod1 * twos;
			uint256 inverse = (3 * denominator) ^ 2;
			inverse *= 2 - denominator * inverse;
			inverse *= 2 - denominator * inverse;
			inverse *= 2 - denominator * inverse;
			inverse *= 2 - denominator * inverse;
			inverse *= 2 - denominator * inverse;
			inverse *= 2 - denominator * inverse;
			result = prod0 * inverse;
		}
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
