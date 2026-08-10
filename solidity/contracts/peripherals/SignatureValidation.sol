// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

interface IERC1271 {
	function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}

library SignatureValidation {
	bytes4 internal constant ERC1271_MAGIC_VALUE = IERC1271.isValidSignature.selector;
	uint256 private constant SECP256K1_HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

	function isValidSignatureNow(address signer, bytes32 digest, bytes calldata signature) internal view returns (bool) {
		if (signer.code.length != 0) {
			(bool success, bytes memory result) = signer.staticcall(abi.encodeCall(IERC1271.isValidSignature, (digest, signature)));
			return success && result.length >= 32 && bytes4(result) == ERC1271_MAGIC_VALUE;
		}
		if (signature.length != 65) return false;
		bytes32 r;
		bytes32 s;
		uint8 v;
		assembly ('memory-safe') {
			r := calldataload(signature.offset)
			s := calldataload(add(signature.offset, 0x20))
			v := byte(0, calldataload(add(signature.offset, 0x40)))
		}
		if (uint256(s) > SECP256K1_HALF_ORDER || (v != 27 && v != 28)) return false;
		address recovered = ecrecover(digest, v, r, s);
		return recovered != address(0) && recovered == signer;
	}
}
