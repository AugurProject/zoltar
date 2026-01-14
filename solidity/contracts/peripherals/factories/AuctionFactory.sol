// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;
import { Auction } from '../Auction.sol';

contract AuctionFactory {
	function deployAuction(bytes32 salt) external returns (Auction) {
		return new Auction{ salt: keccak256(abi.encodePacked(msg.sender, salt)) }();
	}
}
