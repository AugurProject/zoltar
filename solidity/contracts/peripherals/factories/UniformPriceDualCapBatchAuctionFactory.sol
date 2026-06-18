// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { UniformPriceDualCapBatchAuction } from '../UniformPriceDualCapBatchAuction.sol';

contract UniformPriceDualCapBatchAuctionFactory {
	function deployUniformPriceDualCapBatchAuction(
		address owner,
		bytes32 salt
	) external returns (UniformPriceDualCapBatchAuction) {
		return new UniformPriceDualCapBatchAuction{ salt: keccak256(abi.encode(msg.sender, salt)) }(owner);
	}
}
