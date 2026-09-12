// SPDX-License-Identifier: MIT
pragma solidity 0.8.35;

import { ERC20 } from '../ERC20.sol';
import { AuthorizationSignatures } from '../vendor/authorization/AuthorizationSignatures.sol';

/**
 * @dev ERC-2612 support adapted from OpenZeppelin Contracts v5.2.0 ERC20Permit.
 * The repository's vendored OpenZeppelin ERC20 supplies the ledger, allowance,
 * transfer, mint, and burn behavior. AuthorizationSignatures supplies the
 * OpenZeppelin-derived EIP-712 and ECDSA operations. The local adaptation uses
 * descriptive revert strings and the repository's Solidity version.
 */
abstract contract TradingLiquidityToken is ERC20 {
	bytes32 private constant VERSION_HASH = keccak256('1');
	bytes32 private constant PERMIT_TYPEHASH = keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
	mapping(address => uint256) public nonces;

	constructor() ERC20('Zoltar Two-Way LP', 'Z2LP') {}

	function DOMAIN_SEPARATOR() public view returns (bytes32) {
		return AuthorizationSignatures.domainSeparator(keccak256(bytes(name())), VERSION_HASH, address(this));
	}

	function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
		require(block.timestamp <= deadline, 'ERC2612 permit expired');
		uint256 nonce = nonces[owner]++;
		bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
		require(AuthorizationSignatures.recover(AuthorizationSignatures.hashTypedData(DOMAIN_SEPARATOR(), structHash), v, r, s) == owner, 'ERC2612 invalid signer');
		_approve(owner, spender, value);
	}
}
