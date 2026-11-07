// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { Zoltar } from '../../Zoltar.sol';
import { IERC20 } from '../../IERC20.sol';
import { SafeERC20Ops } from '../../SafeERC20Ops.sol';
import { SecurityPoolReporterLedger } from '../../statoblast/SecurityPoolReporterLedger.sol';

/// @dev A deliberately narrow canonical pool/game context for reporter-ledger tests.
contract SecurityPoolReporterLedgerHarness {
	using SafeERC20Ops for IERC20;
	Zoltar public immutable zoltar;
	uint248 public immutable universeId;
	uint256 public immutable questionId;
	SecurityPoolReporterLedger public immutable ledger;

	constructor(Zoltar protocol, SecurityPoolReporterLedger custody, uint248 universe, uint256 question) {
		zoltar = protocol;
		ledger = custody;
		universeId = universe;
		questionId = question;
	}

	function securityPool() external view returns (address) {
		return address(this);
	}
	function escalationGame() external view returns (address) {
		return address(this);
	}
	function repToken() external view returns (address) {
		return address(zoltar.getRepToken(universeId));
	}

	function deposit(uint256 amountAttoRep) external {
		IERC20 token = IERC20(address(zoltar.getRepToken(universeId)));
		token.safeTransferFrom(msg.sender, address(ledger), amountAttoRep);
		ledger.depositForGame(address(this), amountAttoRep);
	}

	function creditUnfunded(uint256 amountAttoRep) external {
		ledger.depositForGame(address(this), amountAttoRep);
	}

	function withdraw(address recipient, uint256 amountAttoRep) external {
		ledger.transferFromGame(address(this), recipient, amountAttoRep);
	}

	function schedule(uint48 finalAfter) external {
		ledger.scheduleFinality(address(this), finalAfter);
	}
}

contract SecurityPoolReporterAuthorityHarness {
	Zoltar public immutable zoltar;
	address public immutable owner;
	constructor(Zoltar protocol) {
		zoltar = protocol;
		owner = msg.sender;
	}
	function logicalTime(uint248 universeId) external view returns (uint48) {
		uint256 forkTime = zoltar.getForkTime(universeId);
		return uint48(forkTime == 0 ? block.timestamp : forkTime);
	}
	function forkController() external view returns (address) {
		return owner;
	}
	function forkLogicalTime(uint248 universeId) external view returns (uint48) {
		return uint48(zoltar.getForkTime(universeId));
	}
	function execute(address target, bytes calldata callData) external returns (bytes memory result) {
		require(msg.sender == owner, 'Only test owner');
		(bool success, bytes memory data) = target.call(callData);
		if (!success)
			assembly ('memory-safe') {
				revert(add(data, 32), mload(data))
			}
		return data;
	}
}
