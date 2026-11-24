// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Unsigned base-10 formatting shared by token metadata and outcome labels.
library DecimalStrings {
	function toString(uint256 absoluteValue) internal pure returns (string memory) {
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
