// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;
import { UniformPriceDualCapBatchAuction } from '../UniformPriceDualCapBatchAuction.sol';

contract UniformPriceDualCapBatchAuctionFactory {
	function deployUniformPriceDualCapBatchAuction(
		address owner,
		bytes32 salt
	) external returns (UniformPriceDualCapBatchAuction) {
		bytes memory initCode = abi.encodePacked(type(UniformPriceDualCapBatchAuction).creationCode, abi.encode(owner));
		address auction;
		assembly {
			auction := create2(0, add(initCode, 0x20), mload(initCode), salt)
		}
		require(auction != address(0), 'auction deploy failed');
		return UniformPriceDualCapBatchAuction(auction);
	}
}
