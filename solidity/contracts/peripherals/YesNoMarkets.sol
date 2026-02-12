// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

contract YesNoMarkets {
	enum Outcome {
		Invalid,
		Yes,
		No,
		None
	}

	struct MarketData {
		string extraInfo;
		uint256 marketEndDate;
		uint256 marketCreated;
	}

	mapping(uint256 => MarketData) markets;

	function createMarket(string memory extraInfo, uint256 marketEndDate, bytes32 salt) external returns (uint256) {
		uint256 marketId = uint256(keccak256(abi.encodePacked(msg.sender, extraInfo, marketEndDate, salt)));
		markets[marketId].extraInfo = extraInfo;
		markets[marketId].marketCreated = block.timestamp;
		markets[marketId].marketEndDate = marketEndDate;
		return marketId;
	}

	function getMarketEndDate(uint256 marketId) external view returns (uint256) {
		return markets[marketId].marketEndDate;
	}

	function getForkingData(uint256 marketId) external view returns (string memory extraInfo, string[4] memory outcomes) {
		extraInfo = markets[marketId].extraInfo;
		outcomes[0] = 'Yes';
		outcomes[1] = 'No';
	}
}
