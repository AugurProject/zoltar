// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

/// @dev Minimal canonical token namespace for independent branch/recovery rights tests.
contract ShareTokenRecoveryTestPool {
	address public immutable shareToken;
	uint248 public immutable universeId;
	address public immutable parent;
	address public immutable portfolioCustody;
	constructor(address token, uint248 universe, address source, address authority) {
		shareToken = token;
		universeId = universe;
		parent = source;
		portfolioCustody = authority;
	}
	function securityPoolFactory() external view returns (address) {
		return address(this);
	}
	function getSecurityPoolPortfolio(address) external view returns (address) {
		return portfolioCustody;
	}
	function securityPoolForker() external view returns (address) {
		return address(this);
	}
	function systemState() external pure returns (uint8) {
		return 1;
	}
}
