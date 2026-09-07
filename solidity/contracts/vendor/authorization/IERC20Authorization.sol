// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

interface IERC20PermitAuthorization {
	function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external;

	function nonces(address owner) external view returns (uint256);
	function DOMAIN_SEPARATOR() external view returns (bytes32);
}

interface IERC3009Authorization {
	function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;

	function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;

	function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
	function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
}
