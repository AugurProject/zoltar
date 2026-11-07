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
		return portfolioCustody.code.length == 0 ? address(this) : portfolioCustody;
	}
	function forkController() external view returns (address) {
		return portfolioCustody;
	}
	function settlement() external view returns (address) {
		return address(this);
	}
	function ledger() external view returns (address) {
		return address(this);
	}
	function questionId() external pure returns (uint256) {
		return 1;
	}
	function bookIds(uint248) external pure returns (uint64) {
		return 1;
	}
	function forkLogicalTime(uint248) external pure returns (uint48) {
		return 0;
	}
	function hasLiveForkRecoveryRight(uint64, uint256, uint48) external pure returns (bool) {
		return true;
	}
	function securityPoolForker() external view returns (address) {
		return address(this);
	}
	function systemState() external pure returns (uint8) {
		return 1;
	}
}
