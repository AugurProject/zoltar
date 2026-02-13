// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;

import './ERC1155.sol';
import '../../Constants.sol';

abstract contract ForkedERC1155 is ERC1155 {

	event Migrate(address migrator, uint256 fromId, uint256 toId, uint256 fromIdBalance);
	constructor() {}

	function universeHasForked(uint248 universeId) internal virtual view returns (bool);

	function getUniverseId(uint256 id) internal virtual pure returns (uint248);

	function getChildId(uint256 originalId, uint248 newUniverse) internal virtual pure returns (uint256);
	function getChildUniverseId(uint248 universeId, uint8 outcomeIndex) public virtual pure returns (uint248);

	function migrate(uint256 fromId, uint8[] memory outcomes) external {
		uint248 universeId = getUniverseId(fromId);
		require(universeHasForked(universeId), 'Universe has not forked');

		uint256 fromIdBalance = _balances[fromId][msg.sender];
		_balances[fromId][msg.sender] = 0;
		_supplys[fromId] -= fromIdBalance;

		// TODO, check that outcomes are unique
		// TODO, do we allow people to migrate later to different universes?
		for (uint8 i = 0; i < outcomes.length; i++) {
			uint256 toId = getChildId(fromId, getChildUniverseId(universeId, outcomes[i]));
			_balances[toId][msg.sender] += fromIdBalance;
			_supplys[toId] += fromIdBalance;
			emit Migrate(msg.sender, fromId, toId, fromIdBalance);
		}
	}
}
