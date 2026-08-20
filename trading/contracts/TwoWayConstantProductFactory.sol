// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { ISecurityPool, ISecurityPoolFactory } from '../../solidity/contracts/statoblast/interfaces/ISecurityPool.sol';
import { IShareToken } from '../../solidity/contracts/statoblast/interfaces/IShareToken.sol';
import { TwoWayConstantProductPair } from './TwoWayConstantProductPair.sol';
import { PredeploymentShareSink } from './PredeploymentShareSink.sol';
import { ITwoWayConstantProductPair } from './interfaces/ITwoWayConstantProductPair.sol';

contract TwoWayConstantProductFactory {
	ISecurityPoolFactory public immutable securityPoolFactory;
	uint256 public immutable feeBps;
	address public immutable predeploymentShareSink;
	mapping(ISecurityPool => ITwoWayConstantProductPair) public getPair;
	mapping(address => bool) public isPair;

	event PairCreated(
		ISecurityPool indexed securityPool,
		IShareToken indexed shareToken,
		uint248 indexed universeId,
		ITwoWayConstantProductPair pair,
		uint256 feeBps
	);

	constructor(ISecurityPoolFactory _securityPoolFactory, uint256 _feeBps) {
		require(address(_securityPoolFactory) != address(0), 'Security pool factory is zero');
		require(_feeBps < 10_000, 'Invalid fee');
		securityPoolFactory = _securityPoolFactory;
		feeBps = _feeBps;
		predeploymentShareSink = address(new PredeploymentShareSink());
	}

	function createPair(ISecurityPool pool) external returns (ITwoWayConstantProductPair pair) {
		_validateCanonicalPool(pool);
		pair = getPair[pool];
		if (address(pair) != address(0)) return pair;
		bytes32 salt = keccak256(abi.encode(pool));
		pair = ITwoWayConstantProductPair(
			address(new TwoWayConstantProductPair{ salt: salt }(address(this), pool, feeBps, predeploymentShareSink))
		);
		getPair[pool] = pair;
		isPair[address(pair)] = true;
		emit PairCreated(pool, pool.shareToken(), pool.universeId(), pair, feeBps);
	}

	function predictPair(ISecurityPool pool) external view returns (address predicted) {
		bytes32 salt = keccak256(abi.encode(pool));
		bytes32 initCodeHash = keccak256(
			abi.encodePacked(
				type(TwoWayConstantProductPair).creationCode,
				abi.encode(address(this), pool, feeBps, predeploymentShareSink)
			)
		);
		predicted = address(
			uint160(uint256(keccak256(abi.encodePacked(bytes1(0xff), address(this), salt, initCodeHash))))
		);
	}

	function _validateCanonicalPool(ISecurityPool pool) private view {
		require(address(pool) != address(0), 'Security pool is zero');
		require(address(pool.securityPoolFactory()) == address(securityPoolFactory), 'Wrong security pool factory');
		bytes32 originId = securityPoolFactory.getSecurityPoolOriginId(pool);
		require(
			address(securityPoolFactory.getSecurityPool(originId, pool.universeId())) == address(pool),
			'Noncanonical security pool'
		);
		require(
			address(pool.shareToken().canonicalPoolByUniverse(pool.universeId())) == address(pool),
			'Noncanonical share pool'
		);
	}
}
