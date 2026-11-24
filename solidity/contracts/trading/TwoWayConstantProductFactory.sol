// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Create2Address } from '../Create2Address.sol';

import { IQuestionLedger, ISecurityPoolFactory } from '../statoblast/interfaces/IQuestionLedger.sol';
import { IShareToken } from '../statoblast/interfaces/IShareToken.sol';
import { TwoWayConstantProductPair } from './TwoWayConstantProductPair.sol';
import { PredeploymentShareSink } from './PredeploymentShareSink.sol';
import { ITwoWayConstantProductPair } from './interfaces/ITwoWayConstantProductPair.sol';
import { TwoWayConstantProductMath } from './TwoWayConstantProductMath.sol';

contract TwoWayConstantProductFactory {
	ISecurityPoolFactory public immutable securityPoolFactory;
	uint256 public immutable feeBps;
	address public immutable predeploymentShareSink;
	mapping(IQuestionLedger => ITwoWayConstantProductPair) public getPair;
	mapping(address => bool) public isPair;

	event PairCreated(IQuestionLedger indexed questionLedger, IShareToken indexed shareToken, uint248 indexed universeId, ITwoWayConstantProductPair pair, uint256 feeBps);

	constructor(ISecurityPoolFactory _securityPoolFactory, uint256 _feeBps) {
		require(address(_securityPoolFactory) != address(0), 'Security pool factory is zero');
		require(_feeBps < TwoWayConstantProductMath.BPS_DENOMINATOR, 'Invalid fee');
		securityPoolFactory = _securityPoolFactory;
		feeBps = _feeBps;
		predeploymentShareSink = address(new PredeploymentShareSink());
	}

	function createPair(IQuestionLedger pool) external returns (ITwoWayConstantProductPair pair) {
		_validateCanonicalPool(pool);
		pair = getPair[pool];
		if (address(pair) != address(0)) return pair;
		bytes32 salt = keccak256(abi.encode(pool));
		pair = ITwoWayConstantProductPair(address(new TwoWayConstantProductPair{salt: salt}(address(this), pool, feeBps, predeploymentShareSink)));
		getPair[pool] = pair;
		isPair[address(pair)] = true;
		emit PairCreated(pool, pool.shareToken(), pool.universeId(), pair, feeBps);
	}

	function predictPair(IQuestionLedger pool) external view returns (address predicted) {
		bytes32 salt = keccak256(abi.encode(pool));
		bytes32 initCodeHash = keccak256(abi.encodePacked(type(TwoWayConstantProductPair).creationCode, abi.encode(address(this), pool, feeBps, predeploymentShareSink)));
		predicted = Create2Address.predict(address(this), salt, initCodeHash);
	}

	function _validateCanonicalPool(IQuestionLedger pool) private view {
		require(address(pool) != address(0), 'Question ledger is zero');
		require(address(pool.securityPoolFactory()) == address(securityPoolFactory), 'Wrong security pool factory');
		bytes32 originId = securityPoolFactory.getQuestionLedgerOriginId(pool);
		require(address(securityPoolFactory.getQuestionLedger(originId, pool.universeId())) == address(pool), 'Noncanonical question ledger');
		require(address(pool.shareToken().canonicalQuestionLedgerByUniverse(pool.universeId())) == address(pool), 'Noncanonical share pool');
	}
}
