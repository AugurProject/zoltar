// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import './ERC1155.sol';
import '../../Constants.sol';

abstract contract ForkedERC1155 is ERC1155 {

	event Migrate(address migrator, uint256 fromId, uint256 toId, uint256 fromIdBalance);
	constructor() {}

	function universeHasForked(uint248 universeId) internal virtual view returns (bool);

	function getUniverseId(uint256 id) internal virtual pure returns (uint248);
	function isChildOf(uint248 childUniverse, uint248 parentUniverse) internal virtual view returns (bool);

	function getChildId(uint256 originalId, uint248 newUniverse) internal virtual pure returns (uint256);
	function getChildUniverseId(uint248 universeId, uint8 outcomeIndex) public virtual pure returns (uint248);

	// migrate fromuniverse,outcome -> newuniverse,outcome
	// genesis,no -> genesis_yes_no
	// genesis,no -> genesis_no_no
	// genesis,no -> genesis_invalid_no
	function migrate(uint256 fromId, uint8[] memory outcomes) external {
		uint248 universeId = getUniverseId(fromId);
		require(universeHasForked(universeId), 'Universe has not forked');
		//require(isChildOf(newUniverse, universeId), 'Universe has not forked');

		uint256 fromIdBalance = _balances[fromId][msg.sender];
		_balances[fromId][msg.sender] = 0;
		_supplys[fromId] -= fromIdBalance;

		// TODO, check outcomes is unique
		// For each outcome universe
		for (uint8 i = 0; i < outcomes.length; i++) {
			uint256 toId = getChildId(fromId, getChildUniverseId(universeId, outcomes[i]));
			_balances[toId][msg.sender] += fromIdBalance;
			_supplys[toId] += fromIdBalance;
			emit Migrate(msg.sender, fromId, toId, fromIdBalance);
		}
	}
}
