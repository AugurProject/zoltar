// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { DualCapBatchAuction } from '../DualCapBatchAuction.sol';

contract DualCapBatchAuctionFactory {
	function deployDualCapBatchAuction(address owner, bytes32 salt) external returns (DualCapBatchAuction) {
		return new DualCapBatchAuction{ salt: salt }(owner);
	}
}
