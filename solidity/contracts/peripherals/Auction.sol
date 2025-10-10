// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;

contract Auction {
	mapping(address => uint256) public purchasedRep;
	constructor() {

	}
	function startAuction(uint256 ethAmountToBuy) public {

	}
	function finalizeAuction() public {

	}
	function isFinalized() public pure returns (bool) {
		return true;
	}
}
