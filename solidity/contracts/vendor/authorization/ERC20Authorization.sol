// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.35;

import { ERC20 } from '../../ERC20.sol';
import { AuthorizationSignatures } from './AuthorizationSignatures.sol';
import { IERC20PermitAuthorization, IERC3009Authorization } from './IERC20Authorization.sol';

abstract contract ERC20Authorization is ERC20, IERC20PermitAuthorization, IERC3009Authorization {
	bytes32 private constant VERSION_HASH = keccak256('1');
	bytes32 private constant PERMIT_TYPEHASH = keccak256('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)');
	bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256('TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');
	bytes32 private constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256('ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)');
	bytes32 private constant CANCEL_AUTHORIZATION_TYPEHASH = keccak256('CancelAuthorization(address authorizer,bytes32 nonce)');
	bytes32 private constant AUTHORIZATION_STORAGE_LOCATION =
		0x7c5feaa67d5910f217fc9613c49444106dcda13e374711815b0e9fc3bc2df100;

	struct AuthorizationStorage {
		mapping(address => uint256) nonces;
		mapping(address => mapping(bytes32 => bool)) authorizationStates;
	}

	event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
	event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);

	function nonces(address owner) public view returns (uint256) {
		return _authorizationStorage().nonces[owner];
	}

	function DOMAIN_SEPARATOR() public view returns (bytes32) {
		return AuthorizationSignatures.domainSeparator(keccak256(bytes(name())), VERSION_HASH, address(this));
	}

	function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) external {
		require(block.timestamp <= deadline, 'ERC2612 permit expired');
		AuthorizationStorage storage authorizationStorage = _authorizationStorage();
		uint256 nonce = authorizationStorage.nonces[owner]++;
		bytes32 structHash = keccak256(abi.encode(PERMIT_TYPEHASH, owner, spender, value, nonce, deadline));
		require(AuthorizationSignatures.recover(AuthorizationSignatures.hashTypedData(DOMAIN_SEPARATOR(), structHash), v, r, s) == owner, 'ERC2612 invalid signer');
		_approve(owner, spender, value);
	}

	function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		_transferWithAuthorization(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
	}

	function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		require(to == msg.sender, 'ERC3009 caller must be the recipient');
		_transferWithAuthorization(RECEIVE_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce, v, r, s);
	}

	function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external {
		AuthorizationStorage storage authorizationStorage = _authorizationStorage();
		require(!authorizationStorage.authorizationStates[authorizer][nonce], 'ERC3009 authorization already used');
		bytes32 structHash = keccak256(abi.encode(CANCEL_AUTHORIZATION_TYPEHASH, authorizer, nonce));
		require(AuthorizationSignatures.recover(AuthorizationSignatures.hashTypedData(DOMAIN_SEPARATOR(), structHash), v, r, s) == authorizer, 'ERC3009 invalid signer');
		authorizationStorage.authorizationStates[authorizer][nonce] = true;
		emit AuthorizationCanceled(authorizer, nonce);
	}

	function authorizationState(address authorizer, bytes32 nonce) external view returns (bool) {
		return _authorizationStorage().authorizationStates[authorizer][nonce];
	}

	function _transferWithAuthorization(bytes32 typeHash, address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) private {
		require(block.timestamp > validAfter, 'ERC3009 authorization not yet valid');
		require(block.timestamp < validBefore, 'ERC3009 authorization expired');
		AuthorizationStorage storage authorizationStorage = _authorizationStorage();
		require(!authorizationStorage.authorizationStates[from][nonce], 'ERC3009 authorization already used');
		bytes32 structHash = keccak256(abi.encode(typeHash, from, to, value, validAfter, validBefore, nonce));
		require(AuthorizationSignatures.recover(AuthorizationSignatures.hashTypedData(DOMAIN_SEPARATOR(), structHash), v, r, s) == from, 'ERC3009 invalid signer');
		authorizationStorage.authorizationStates[from][nonce] = true;
		emit AuthorizationUsed(from, nonce);
		_transfer(from, to, value);
	}

	function _authorizationStorage() private pure returns (AuthorizationStorage storage authorizationStorage) {
		bytes32 location = AUTHORIZATION_STORAGE_LOCATION;
		assembly ('memory-safe') {
			authorizationStorage.slot := location
		}
	}
}
