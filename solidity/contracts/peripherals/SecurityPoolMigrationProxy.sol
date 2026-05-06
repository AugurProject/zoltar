// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import { ReputationToken } from '../ReputationToken.sol';
import { Zoltar } from '../Zoltar.sol';

contract SecurityPoolMigrationProxy {
	Zoltar public immutable zoltar;
	ReputationToken public immutable parentRepToken;
	uint248 public immutable universeId;
	address public immutable owner;

	constructor(Zoltar _zoltar, ReputationToken _parentRepToken, uint248 _universeId, address _owner) {
		zoltar = _zoltar;
		parentRepToken = _parentRepToken;
		universeId = _universeId;
		owner = _owner;
		_parentRepToken.approve(address(_zoltar), type(uint256).max);
	}

	modifier onlyOwner {
		require(msg.sender == owner, 'only owner');
		_;
	}

	function lockRep(uint256 amount) external onlyOwner {
		zoltar.addRepToMigrationBalance(universeId, amount);
	}

	function forkUniverse(uint256 questionId) external onlyOwner {
		zoltar.forkUniverse(universeId, questionId);
	}

	function splitToChild(uint256 amount, uint256[] calldata outcomeIndices) external onlyOwner {
		zoltar.splitMigrationRep(universeId, amount, outcomeIndices);
	}

	function sweepChildRep(address receiver, ReputationToken childRepToken, uint256 amount) external onlyOwner {
		childRepToken.transfer(receiver, amount);
	}
}
