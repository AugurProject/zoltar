pragma solidity 0.8.30;

import './Constants.sol';
import './IZoltar.sol';
import './ReputationToken.sol';
import './IERC20.sol';

contract Zoltar {

	struct Universe {
		IERC20 reputationToken;
		uint56 forkingMarket;
		uint256 forkTime;
	}

	mapping(uint192 => Universe) public universes;

	struct MarketData {
		uint64 endTime;
		uint192 originUniverse;
		address designatedReporter;
		string extraInfo;
	}

	struct MarketResolutionData {
		address initialReporter;
		uint8 outcome;
		uint64 reportTime;
		bool finalized;
	}

	mapping(uint56 => MarketData) public markets;

	// UniverseId => MarketId => Data
	mapping(uint192 => mapping(uint56 => MarketResolutionData)) marketResolutions;

	uint56 marketIdCounter = 0;

	// TODO: Revist what behavior the bond should be
	uint256 constant public REP_BOND = 1 ether;

	uint256 constant public DESIGNATED_REPORTING_TIME = 3 days;
	uint256 constant public DISPUTE_PERIOD = 1 days;

	constructor() {
		universes[0] = Universe(
			IERC20(Constants.GENESIS_REPUTATION_TOKEN),
			0,
			0
		);
	}

	function isMarketLegit(uint192 _universeId, uint56 _marketId) public view returns (bool) {
		MarketData memory marketData = markets[_marketId];
		require(marketData.endTime != 0, "Market is not valid");

		if (marketData.originUniverse == _universeId) return true;

		Universe memory universeData = universes[_universeId];
		require(address(universeData.reputationToken) != address(0), "Universe is not valid");

		do {
			_universeId >>= 2;
			// If a parent didn't fork this wouldn't be a valid universe
			Universe memory curUniverseData = universes[_universeId];
			if (curUniverseData.forkTime == 0) return false;

			// A resolved market cannot have children, as a market in a forked universe does not get resolved there
			MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
			if (marketResolutionDataIsFinalized(marketResolutionData)) return false;

			// If other checks passed and the ids are equal its a legitimate child. If this never gets reached it isn't.
			if (marketData.originUniverse == _universeId) return true;
		} while (_universeId > 0);

		return false;
	}

	function createMarket(uint192 _universeId, uint64 _endTime, address _designatedReporterAddress, string memory _extraInfo) public returns (uint56 _marketId) {
		Universe memory universe = universes[_universeId];
		require(universe.forkingMarket == 0, "Universe is forked");
		universe.reputationToken.transferFrom(msg.sender, address(this), REP_BOND);
		_marketId = ++marketIdCounter;
		markets[_marketId] = MarketData(
			_endTime,
			_universeId,
			_designatedReporterAddress,
			_extraInfo
		);
	}

	function reportOutcome(uint192 _universeId, uint56 _marketId, uint8 _outcome) external {
		Universe memory universe = universes[_universeId];
		require(universe.forkingMarket == 0, "Universe is forked");
		MarketData memory marketData = markets[_marketId];
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		require(marketResolutionData.reportTime == 0, "Market already has a report");
		require(_outcome < 3, "Invalid outcome");
		require(block.timestamp > marketData.endTime, "Market has not ended");
		require(msg.sender == marketData.designatedReporter || block.timestamp > marketData.endTime + DESIGNATED_REPORTING_TIME, "Reporter must be designated reporter");

		marketResolutions[_universeId][_marketId].initialReporter = msg.sender;
		marketResolutions[_universeId][_marketId].outcome = _outcome;
		marketResolutions[_universeId][_marketId].reportTime = uint64(block.timestamp);
	}

	function finalizeMarket(uint192 _universeId, uint56 _marketId) external returns (uint8) {
		Universe memory universe = universes[_universeId];
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		if (!marketResolutionData.finalized) {
			require(marketResolutionDataIsFinalized(marketResolutionData), "Cannot withdraw REP bond before finalized");
			marketResolutionData.finalized = true;
			marketResolutions[_universeId][_marketId] = marketResolutionData;
			universe.reputationToken.transfer(marketResolutionData.initialReporter, REP_BOND);
		}
		return marketResolutionData.outcome;
	}

	function migrateStakedRep(uint192 _universeId, uint56 _marketId) external {
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		require(marketResolutionData.reportTime != 0, "No REP staked in this market");
		require(!marketResolutionDataIsFinalized(marketResolutionData), "Cannot migrate REP from finalized market");

		migrateREPInternal(_universeId, REP_BOND, address(this), marketResolutionData.initialReporter, 3);
	}

	function isFinalized(uint192 _universeId, uint56 _marketId) external view returns (bool) {
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		if (marketResolutionData.finalized) return true;
		return marketResolutionDataIsFinalized(marketResolutionData);
	}

	function marketResolutionDataIsFinalized(MarketResolutionData memory marketResolutionData) internal view returns (bool) {
		return marketResolutionData.reportTime != 0 && block.timestamp > marketResolutionData.reportTime + DISPUTE_PERIOD;
	}

	function getWinningOutcome(uint192 _universeId, uint56 _marketId) public view returns (uint8) {
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		require(marketResolutionDataIsFinalized(marketResolutionData), "Market is not finalized");

		return marketResolutionData.outcome;
	}

	// TODO: Currently escalation game is a single dispute. Likely will be more complex.
	function dispute(uint192 _universeId, uint56 _marketId, uint8 _outcome) external {
		Universe memory universe = universes[_universeId];
		require(universe.forkingMarket == 0, "Universe is forked");
		MarketResolutionData memory marketResolutionData = marketResolutions[_universeId][_marketId];
		require(_outcome != marketResolutionData.outcome, "Dispute must be for a different outcome than the currently winning one");
		require(block.timestamp < marketResolutionData.reportTime + DISPUTE_PERIOD, "Market not in dispute window");
		require(_outcome < 3, "Invalid outcome");

		uint256 disputeStake = REP_BOND * 2;

		for (uint8 i = 1; i < Constants.NUM_OUTCOMES + 1; i++) {
			uint192 childUniverseId = (_universeId << 2) + i;
			universes[childUniverseId] = Universe(
				new ReputationToken(),
				0,
				0
			);

			marketResolutions[childUniverseId][_marketId].reportTime = 1;
			marketResolutions[childUniverseId][_marketId].outcome = i - 1;
			marketResolutions[childUniverseId][_marketId].finalized = true;
		}

		universe.forkingMarket = _marketId;
		universe.forkTime = block.timestamp;
		universes[_universeId] = universe;

		migrateREPInternal(_universeId, REP_BOND, marketResolutionData.initialReporter, marketResolutionData.initialReporter, marketResolutionData.outcome);
		migrateREPInternal(_universeId, disputeStake, msg.sender, msg.sender, _outcome);
	}

	function migrateREP(uint192 universeId) public {
		uint256 amount = universes[universeId].reputationToken.balanceOf(msg.sender);
		migrateREPInternal(universeId, amount, msg.sender, msg.sender, 3);
	}

	// singleOutcome will only credit the provided outcome if it is a valid outcome, else all child universe REP will be minted
	function migrateREPInternal(uint192 universeId, uint256 amount, address migrator, address recipient, uint8 singleOutcome) private {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, "Universe has not forked");

		// Genesis is using REPv2 which we cannot actually burn
		if (universeId == 0) {
			if (migrator == address(this)) {
				universe.reputationToken.transfer(Constants.BURN_ADDRESS, amount);
			} else {
				universe.reputationToken.transferFrom(migrator, Constants.BURN_ADDRESS, amount);
			}
		} else {
			ReputationToken(address(universe.reputationToken)).burn(migrator, amount);
		}

		for (uint8 i = 1; i < Constants.NUM_OUTCOMES + 1; i++) {
			if (singleOutcome < 3 && i != singleOutcome + 1) continue;
			uint192 childUniverseId = (universeId << 2) + i;
			Universe memory childUniverse = universes[childUniverseId];
			ReputationToken(address(childUniverse.reputationToken)).mint(recipient, amount);
		}

	}
}
