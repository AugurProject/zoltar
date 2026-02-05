// SPDX-License-Identifier: UNICENSE
pragma solidity 0.8.33;

import './Constants.sol';
import './ReputationToken.sol';

uint256 constant FORK_TRESHOLD_DIVISOR = 20; // TODO, revisit, 5% of total supply atm
uint256 constant FORK_BURN_DIVISOR = 5; // TODO, revisit, 20% of fork treshold

contract Zoltar {
	struct Universe {
		uint248 parentUniverseId;
		uint256 outcomeIndex;
		ReputationToken reputationToken;

		address forkedBy;
		string forkingQuestionExtraInfo; // not needed internaly, but very useful externally
		string[] questionCategories;
		uint256 forkTime; // not needed internaly, but very useful externally

		uint256 forkerRepDeposit;
	}
	uint256 immutable genesisRepSupply;

	mapping(uint248 => Universe) public universes;

	function getForkTime(uint248 universeId) external view returns (uint256) {
		Universe memory universe = universes[universeId];
		return universe.forkTime;

	}
	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		Universe memory universe = universes[universeId];
		return universe.reputationToken;
	}
	function getQuestionCategories(uint248 universeId) external view returns (string[] memory) {
		Universe memory universe = universes[universeId];
		return universe.questionCategories;
	}

	constructor() {
		string[] memory categories;
		genesisRepSupply = ReputationToken(Constants.GENESIS_REPUTATION_TOKEN).totalSupply();
		universes[0] = Universe(0, 0, ReputationToken(Constants.GENESIS_REPUTATION_TOKEN), address(0), '', categories, 0, 0);
	}

	function forkUniverse(uint248 universeId, string memory _extraInfo, string[] memory _questionCategories) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime == 0, 'Universe has forked already');
		require(_questionCategories.length >= 1, 'need atleast one category on top of invalid');

		universe.forkingQuestionExtraInfo = _extraInfo;
		universe.forkTime = block.timestamp;
		universe.questionCategories = _questionCategories;
		universe.forkedBy = msg.sender;
		uint256 forkTreshold = universe.reputationToken.maxTheoreticalSupply() / FORK_TRESHOLD_DIVISOR;
		universes[universeId].reputationToken.transferFrom(msg.sender, address(this), forkTreshold);
		burnRep(universes[universeId].reputationToken, address(this), forkTreshold / 5); // burn 20%
		universe.forkerRepDeposit = forkTreshold - forkTreshold / 5;
	}

	function splitRep(uint248 universeId, uint8[] memory outcomeIndexes) public {
		uint256 amount = universes[universeId].reputationToken.balanceOf(msg.sender);
		splitRepInternal(universeId, amount, msg.sender, msg.sender, outcomeIndexes);
	}

	function burnRep(ReputationToken reputationToken, address migrator, uint256 amount) private {
		// Genesis is using REPv2 which we cannot actually burn
		if (address(reputationToken) == Constants.GENESIS_REPUTATION_TOKEN) {
			if (migrator == address(this)) {
				reputationToken.transfer(Constants.BURN_ADDRESS, amount);
			} else {
				reputationToken.transferFrom(migrator, Constants.BURN_ADDRESS, amount);
			}
		} else {
			ReputationToken(address(reputationToken)).burn(migrator, amount);
		}
	}

	function getOutcomeName(uint248 universeId) external view returns (string memory) {
		if (universeId == 0) return 'Genesis';
		Universe memory universe = universes[universeId];
		Universe memory parentUniverse = universes[universe.parentUniverseId];
		if (universe.outcomeIndex == 0) return 'Invalid';
		return parentUniverse.questionCategories[universe.outcomeIndex - 1];
	}

	function deployChild(uint248 universeId, uint256 outcomeIndex) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
		string[] memory categories;
		// each fork, 1/FORK_BURN_DIVISOR * 1/FORK_TRESHOLD_DIVISOR gets burnt, so fork treshold need to decrease
		universes[childUniverseId] = Universe(universeId, outcomeIndex, new ReputationToken{ salt: bytes32(uint256(childUniverseId)) }(address(this), universe.reputationToken.getTotalTheoreticalSupply()), address(0), '', categories, 0, 0);
	}

	function forkerClaimRep(uint248 universeId, uint8[] memory outcomeIndices) public {
		Universe memory universe = universes[universeId];
		require(universe.forkedBy == msg.sender, 'only forker can claim');
		splitRepInternal(universeId, universe.forkerRepDeposit, address(this), universe.forkedBy, outcomeIndices);
	}

	function splitRepInternal(uint248 universeId, uint256 amount, address migrator, address recipient, uint8[] memory outcomeIndices) private {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked');
		burnRep(universe.reputationToken, migrator, amount);
		for (uint8 i = 0; i < outcomeIndices.length; i++) {
			require(i == 0 || outcomeIndices[i] > outcomeIndices[i-1], 'outcomes are not sorted'); // force sorting to avoid duplicate indices
			require(outcomeIndices[i] < universe.questionCategories.length + 1, 'outcome index overflow');
			uint248 childUniverseId = uint248(uint256(keccak256(abi.encode(universeId, outcomeIndices[i]))));
			Universe memory childUniverse = universes[childUniverseId];
			if (address(childUniverse.reputationToken) == address(0x0)) {
				deployChild(universeId, outcomeIndices[i]);
			}
			ReputationToken(address(childUniverse.reputationToken)).mint(recipient, amount);
		}
	}
}
