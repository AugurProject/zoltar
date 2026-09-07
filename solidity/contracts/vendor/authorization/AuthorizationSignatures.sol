// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

/// @notice EIP-712 hashing and strict ECDSA recovery shared by token authorization implementations.
/// @dev Adapted from OpenZeppelin Contracts v5.2.0 EIP712, ECDSA, and MessageHashUtils.
/// See README.md in this directory for provenance and local modifications.
library AuthorizationSignatures {
	bytes32 internal constant EIP712_DOMAIN_TYPEHASH =
		keccak256('EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)');
	uint256 private constant SECP256K1_HALF_ORDER =
		0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

	function domainSeparator(bytes32 nameHash, bytes32 versionHash, address verifyingContract)
		internal
		view
		returns (bytes32)
	{
		return keccak256(abi.encode(EIP712_DOMAIN_TYPEHASH, nameHash, versionHash, block.chainid, verifyingContract));
	}

	function hashTypedData(bytes32 domainSeparator_, bytes32 structHash) internal pure returns (bytes32) {
		return keccak256(abi.encodePacked(hex'1901', domainSeparator_, structHash));
	}

	function recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) internal pure returns (address signer) {
		require(uint256(s) <= SECP256K1_HALF_ORDER, 'Authorization signature has invalid s');
		require(v == 27 || v == 28, 'Authorization signature has invalid v');
		signer = ecrecover(digest, v, r, s);
		require(signer != address(0), 'Authorization signature is invalid');
	}
}
