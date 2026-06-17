// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IERC20 } from '../IERC20.sol';
import { ReputationToken } from '../ReputationToken.sol';
import { SafeERC20Ops } from '../SafeERC20Ops.sol';
import { Zoltar } from '../Zoltar.sol';

// Thin pool-specific adapter around Zoltar. Its only purpose is to give one
// parent security pool one stable caller identity when interacting with
// Zoltar's migration ledger, which is keyed by `msg.sender`.
contract SecurityPoolMigrationProxy {
	using SafeERC20Ops for IERC20;

	Zoltar public immutable zoltar;
	ReputationToken public immutable parentRepToken;
	uint248 public immutable universeId;
	address public immutable owner;

	constructor(Zoltar _zoltar, ReputationToken _parentRepToken, uint248 _universeId, address _owner) {
		zoltar = _zoltar;
		parentRepToken = _parentRepToken;
		universeId = _universeId;
		owner = _owner;
		IERC20(address(_parentRepToken)).safeApprove(address(_zoltar), type(uint256).max);
	}

	modifier onlyOwner() {
		require(msg.sender == owner, 'only owner');
		_;
	}

	// Burns parent-universe REP into this proxy's migration balance.
	function lockRep(uint256 amount) external onlyOwner {
		zoltar.addRepToMigrationBalance(universeId, amount);
	}

	// Triggers the underlying Zoltar fork using this proxy as the migrator.
	function forkUniverse(uint256 questionId) external onlyOwner {
		zoltar.forkUniverse(universeId, questionId);
	}

	// Mints child-universe REP into this proxy's address so the forker can later
	// route each balance to the matching child security pool.
	function splitToChild(uint256 amount, uint256[] calldata outcomeIndices) external onlyOwner {
		zoltar.splitMigrationRep(universeId, amount, outcomeIndices);
	}

	function sweepChildRep(address receiver, ReputationToken childRepToken, uint256 amount) external onlyOwner {
		IERC20(address(childRepToken)).safeTransfer(receiver, amount);
	}
}
