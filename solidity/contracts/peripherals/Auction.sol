// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.30;
uint256 constant AUCTION_TIME = 1 weeks;

contract Auction {
	mapping(address => uint256) public purchasedRep;
	uint256 public totalRepPurchased;
	uint256 public repAvailable;
	uint256 public auctionStarted;
	uint256 public ethAmountToBuy;
	bool public finalized;
	address owner;

	event Participated(address user, uint256 repAmount, uint256 ethAmount, uint256 totalRepPurchased);
	event FinalizedAuction(address user, uint256 repAmount, uint256 ethAmount);
	event AuctionStarted(uint256 ethAmountToBuy, uint256 repAvailable);

	constructor(address _owner) {
		owner = _owner;
	}
	function participate(uint256 repToBuy) public payable {
		require(auctionStarted > 0, 'Auction needs to have started');
		require(!finalized, 'Already finalized');
		require(msg.value > 0, 'need to invest with eth!');
		require(address(this).balance <= ethAmountToBuy, 'already fully funded');
		require(address(this).balance + msg.value <= ethAmountToBuy, 'attempting to overfund');
		require(totalRepPurchased+repToBuy <= repAvailable, 'attempt to buy too much rep');
		purchasedRep[msg.sender] = repToBuy; // todo, currently anyone can buy with any price
		totalRepPurchased += repToBuy;
		emit Participated(msg.sender, repToBuy, msg.value, totalRepPurchased);
	}
	function startAuction(uint256 _ethAmountToBuy, uint256 _repAvailable) public {
		require(auctionStarted == 0, 'Already started!');
		auctionStarted = block.timestamp;
		ethAmountToBuy = _ethAmountToBuy;
		repAvailable = _repAvailable;
		emit AuctionStarted(ethAmountToBuy, repAvailable);
	}
	function finalizeAuction() public {
		require(block.timestamp > auctionStarted + AUCTION_TIME, 'Auction needs to have ended first');
		require(finalized, 'Already finalized');
		require(msg.sender == owner, 'Only owner can finalize');
		finalized = true;
		(bool sent, ) = payable(owner).call{value: address(this).balance}('');
		require(sent, 'Failed to send Ether');
	}
}
