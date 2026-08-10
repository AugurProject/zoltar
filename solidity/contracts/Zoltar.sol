// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import './Constants.sol';
import './IERC20.sol';
import './ReputationToken.sol';
import './SafeERC20Ops.sol';
import './ZoltarQuestionData.sol';

contract Zoltar {
	using SafeERC20Ops for IERC20;

	struct Universe {
		uint256 forkTime;
		uint256 forkQuestionId;
		uint256 forkingOutcomeIndex;
		ReputationToken reputationToken;
		uint248 parentUniverseId;
	}

	mapping(uint248 => Universe) public universes;
	mapping(uint248 => uint256[]) public deployedChildOutcomeIndexes;
	mapping(uint248 => uint256) private universeTheoreticalSupplies;
	mapping(uint248 => uint256) private childUniverseTheoreticalSupplySnapshotsAttoRep;

	struct AddressRepMigration {
		uint256 migrationRepBalanceAttoRep;
		mapping(uint248 => uint256) childMigrationRepAmountsAttoRep; // how much attoREP migrated to each child universe
	}
	mapping(address => mapping(uint248 => AddressRepMigration)) private migrationRepBalances; // userAddress -> fromUniverse

	event UniverseForked(address indexed forker, uint248 indexed universeId, uint256 indexed questionId, uint256 forkTime, uint256 forkThresholdAttoRep, uint256 migrationRepBalanceAttoRep, uint256 universeTheoreticalSupplyAttoRep);
	event DeployChild(address deployer, uint248 indexed universeId, uint256 indexed outcomeIndex, uint248 indexed childUniverseId, ReputationToken childReputationToken, uint256 childUniverseTheoreticalSupplyAttoRep);
	event MigrationRepAdded(address indexed migrator, uint248 indexed universeId, uint256 amountAttoRep, uint256 migrationRepBalanceAttoRep, uint256 universeTheoreticalSupplyAttoRep);
	event MigrationRepSplit(address indexed migrator, address recipient, uint248 indexed universeId, uint256 outcomeIndex, uint248 indexed childUniverseId, uint256 amountAttoRep, uint256 childMigrationRepAmountAttoRep);
	event UniverseInitialized(uint248 indexed universeId, uint256 forkTime, uint256 forkQuestionId, uint256 forkingOutcomeIndex, ReputationToken reputationToken, uint248 indexed parentUniverseId, uint256 universeTheoreticalSupplyAttoRep);
	event RepBurned(address indexed burner, uint248 indexed universeId, uint256 amountAttoRep, uint256 universeTheoreticalSupplyAttoRep);

	uint256 public immutable forkThresholdDivisor;
	uint256 public immutable forkBurnDivisor;
	ReputationToken public immutable genesisReputationToken;
	ZoltarQuestionData public immutable zoltarQuestionData;

	constructor(ZoltarQuestionData _zoltarQuestionData, ReputationToken _genesisReputationToken, uint256 _forkThresholdDivisor, uint256 _forkBurnDivisor) {
		require(_forkThresholdDivisor > 1, 'Zoltar fork threshold divisor must be greater than one');
		require(_forkBurnDivisor >= Constants.MINIMUM_FORK_BURN_DIVISOR, 'Zoltar fork burn divisor must be at least five');
		require(address(_genesisReputationToken).code.length != 0, 'Genesis REP token address must contain code');
		zoltarQuestionData = _zoltarQuestionData;
		genesisReputationToken = _genesisReputationToken;
		forkThresholdDivisor = _forkThresholdDivisor;
		forkBurnDivisor = _forkBurnDivisor;
		universes[0] = Universe(0, 0, 0, _genesisReputationToken, 0);
		// The configured genesis token must expose `getTotalTheoreticalSupplyAttoRep()`.
		// This constructor intentionally relies on that non-ERC20 extension when wiring
		// the genesis universe to an external REP deployment.
		uint256 genesisSupply = _genesisReputationToken.getTotalTheoreticalSupplyAttoRep();
		require(genesisSupply != 0, 'Genesis REP missing supply: theoretical supply must be non-zero');
		require(genesisSupply <= Constants.MAX_ATTO_REP, 'Genesis REP exceeds maximum supply');
		universeTheoreticalSupplies[0] = genesisSupply;
		emit UniverseInitialized(0, 0, 0, 0, _genesisReputationToken, 0, genesisSupply);
	}

	function getForkTime(uint248 universeId) external view returns (uint256) {
		return universes[universeId].forkTime;
	}

	function forkQuestionMatches(uint248 universeId, uint256 questionId) external view returns (bool) {
		return universes[universeId].forkQuestionId == questionId;
	}

	function getRepToken(uint248 universeId) external view returns (ReputationToken) {
		return universes[universeId].reputationToken;
	}

	function getForkThresholdAttoRep(uint248 universeId) public view returns (uint256) {
		return getUniverseTheoreticalSupplyAttoRep(universeId) / forkThresholdDivisor;
	}

	function getNonDecisionThresholdAttoRep(uint248 universeId) public view returns (uint256) {
		uint256 forkThresholdAttoRep = getForkThresholdAttoRep(universeId);
		return forkThresholdAttoRep / 2 + (forkThresholdAttoRep % 2);
	}

	function getUniverseTheoreticalSupplyAttoRep(uint248 universeId) public view returns (uint256) {
		return universeTheoreticalSupplies[universeId];
	}

	function forkUniverse(uint248 universeId, uint256 questionId) public {
		Universe storage universe = universes[universeId];
		require(address(universe.reputationToken) != address(0x0), 'Universe not initialized with a REP token');
		require(address(universe.reputationToken).code.length != 0, 'Universe REP token address must contain code');
		require(universeTheoreticalSupplies[universeId] != 0, 'Universe theoretical REP supply must be non-zero');
		require(universe.forkTime == 0, 'Universe has forked already and cannot fork again');
		// Intended behavior: Zoltar treats questions as global protocol objects rather
		// than binding them to a specific universe. Any ended question can force a fork
		// in any unforked universe, and downstream protocols are expected to enforce any
		// stricter universe/question relationship they require.
		require(zoltarQuestionData.questionCreatedTimestamp(questionId) > 0, 'Question does not exist in ZoltarQuestionData');
		uint256 endTime = zoltarQuestionData.getQuestionEndDate(questionId);
		require(block.timestamp >= endTime, 'Question has not ended, so it cannot force a fork yet');
		universes[universeId].forkTime = block.timestamp;
		universes[universeId].forkQuestionId = questionId;
		uint256 forkThresholdAttoRep = getForkThresholdAttoRep(universeId);
		_burnRep(universes[universeId].reputationToken, msg.sender, forkThresholdAttoRep);
		universeTheoreticalSupplies[universeId] -= forkThresholdAttoRep;
		uint256 migrationRepBalanceAttoRep = forkThresholdAttoRep - forkThresholdAttoRep / forkBurnDivisor;
		// The initiator's uncredited admission haircut is permanently absent from
		// every child. Later REP added to the migration balance still converts 1:1.
		childUniverseTheoreticalSupplySnapshotsAttoRep[universeId] =
			universeTheoreticalSupplies[universeId] + migrationRepBalanceAttoRep;
		migrationRepBalances[msg.sender][universeId].migrationRepBalanceAttoRep = migrationRepBalanceAttoRep;
		emit UniverseForked(msg.sender, universeId, questionId, universes[universeId].forkTime, forkThresholdAttoRep, migrationRepBalanceAttoRep, universeTheoreticalSupplies[universeId]);
	}

	// Burns REP without creating migration credit. Escalation games use this path
	// when their question resolves without paying the winner haircut through an
	// own-question universe fork.
	function burnRep(uint248 universeId, uint256 amountAttoRep) external {
		require(amountAttoRep > 0, 'Burn amount zero');
		Universe storage universe = universes[universeId];
		require(address(universe.reputationToken) != address(0x0), 'Universe not initialized with a REP token');
		require(universeTheoreticalSupplies[universeId] >= amountAttoRep, 'Burn exceeds theoretical supply');
		_burnRep(universe.reputationToken, msg.sender, amountAttoRep);
		universeTheoreticalSupplies[universeId] -= amountAttoRep;
		emit RepBurned(msg.sender, universeId, amountAttoRep, universeTheoreticalSupplies[universeId]);
	}

	function _burnRep(ReputationToken reputationToken, address migrator, uint256 amountAttoRep) private {
		// Genesis is using REPv2 which we cannot actually burn
		if (address(reputationToken) == address(genesisReputationToken)) {
			if (migrator == address(this)) {
				IERC20(address(reputationToken)).safeTransfer(Constants.BURN_ADDRESS, amountAttoRep);
			} else {
				IERC20(address(reputationToken)).safeTransferFrom(migrator, Constants.BURN_ADDRESS, amountAttoRep);
			}
		} else {
			ReputationToken(address(reputationToken)).burn(migrator, amountAttoRep);
		}
	}

	function getChildUniverseId(uint248 universeId, uint256 outcomeIndex) public pure returns (uint248) {
		return uint248(uint256(keccak256(abi.encode(universeId, outcomeIndex))));
	}

	function deployChild(uint248 universeId, uint256 outcomeIndex) public {
		Universe storage universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked, so child universes are unavailable');
		require(!zoltarQuestionData.isMalformedAnswerOption(universe.forkQuestionId, outcomeIndex), 'Malformed outcome index for the universe fork question');
		uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
		// Prevent overwriting an existing child universe
		require(address(universes[childUniverseId].reputationToken) == address(0), 'Child universe already deployed for this outcome');
		ReputationToken childReputationToken = new ReputationToken{salt: bytes32(uint256(childUniverseId))}(address(this));
		uint256 childUniverseTheoreticalSupplyAttoRep = childUniverseTheoreticalSupplySnapshotsAttoRep[universeId];
		childReputationToken.setMaxTheoreticalSupplyAttoRep(childUniverseTheoreticalSupplyAttoRep);
		universeTheoreticalSupplies[childUniverseId] = childUniverseTheoreticalSupplyAttoRep;
		universes[childUniverseId] = Universe(0, universe.forkQuestionId, outcomeIndex, childReputationToken, universeId);
		deployedChildOutcomeIndexes[universeId].push(outcomeIndex);
		emit DeployChild(msg.sender, universeId, outcomeIndex, childUniverseId, childReputationToken, childUniverseTheoreticalSupplyAttoRep);
	}

	function getDeployedChildUniverses(uint248 universeId, uint256 startIndex, uint256 count)
		external
		view
		returns (uint256[] memory outcomeIndexes, uint248[] memory childUniverseIds, Universe[] memory childUniverses)
	{
		uint256[] storage deployedOutcomeIndexes = deployedChildOutcomeIndexes[universeId];
		uint256 iterateUntil = _sliceEnd(startIndex, count, deployedOutcomeIndexes.length);
		if (iterateUntil <= startIndex) return (new uint256[](0), new uint248[](0), new Universe[](0));
		uint256 resultLength = iterateUntil - startIndex;
		outcomeIndexes = new uint256[](resultLength);
		childUniverseIds = new uint248[](resultLength);
		childUniverses = new Universe[](resultLength);
		for (uint256 i = startIndex; i < iterateUntil; i++) {
			uint256 resultIndex = i - startIndex;
			uint248 childUniverseId = getChildUniverseId(universeId, deployedOutcomeIndexes[i]);
			outcomeIndexes[resultIndex] = deployedOutcomeIndexes[i];
			childUniverseIds[resultIndex] = childUniverseId;
			childUniverses[resultIndex] = universes[childUniverseId];
		}
	}

	function _sliceEnd(uint256 startIndex, uint256 count, uint256 total) internal pure returns (uint256) {
		if (startIndex >= total || count == 0) return startIndex;
		uint256 availableCount = total - startIndex;
		if (count >= availableCount) return total;
		return startIndex + count;
	}

	// stores rep in the migration balance for a universe
	function addRepToMigrationBalance(uint248 universeId, uint256 amountAttoRep) public {
		Universe memory universe = universes[universeId];
		require(universe.forkTime != 0, 'Universe has not forked, so migration balance cannot be added');
		_burnRep(universe.reputationToken, msg.sender, amountAttoRep);
		universeTheoreticalSupplies[universeId] -= amountAttoRep;
		migrationRepBalances[msg.sender][universeId].migrationRepBalanceAttoRep += amountAttoRep;
		emit MigrationRepAdded(msg.sender, universeId, amountAttoRep, migrationRepBalances[msg.sender][universeId].migrationRepBalanceAttoRep, universeTheoreticalSupplies[universeId]);
	}
	function splitMigrationRep(uint248 universeId, uint256 amountAttoRep, uint256[] memory outcomeIndexes) public {
		require(universes[universeId].forkTime != 0, 'Universe has not forked, so migration REP cannot be split');
		splitRepInternal(universeId, amountAttoRep, msg.sender, outcomeIndexes);
	}

	function splitRepInternal(uint248 universeId, uint256 amountAttoRep, address recipient, uint256[] memory outcomeIndexes) private {
		uint256 questionId = universes[universeId].forkQuestionId;
		// Fork migration intentionally duplicates the holder's migration balance across the
		// selected child universes. For example, splitting 1 parent-universe REP into the
		// Yes and No children mints 1 Yes-child REP and 1 No-child REP. The original
		// parent-universe REP is not preserved here: it has already been burned into the
		// migration balance before child-universe REP is minted.
		for (uint256 i = 0; i < outcomeIndexes.length; i++) {
			uint256 outcomeIndex = outcomeIndexes[i];
			require(!zoltarQuestionData.isMalformedAnswerOption(questionId, outcomeIndex), 'Malformed outcome index for the fork migration question');
			uint248 childUniverseId = getChildUniverseId(universeId, outcomeIndex);
			if (address(universes[childUniverseId].reputationToken) == address(0x0))
				deployChild(universeId, outcomeIndex);
			migrationRepBalances[msg.sender][universeId].childMigrationRepAmountsAttoRep[childUniverseId] +=
				amountAttoRep;
			require(migrationRepBalances[msg.sender][universeId].childMigrationRepAmountsAttoRep[childUniverseId] <= migrationRepBalances[msg.sender][universeId].migrationRepBalanceAttoRep, 'Cannot migrate more than internal balance: requested child REP exceeds sender migration REP');
			universes[childUniverseId].reputationToken.mint(recipient, amountAttoRep);
			emit MigrationRepSplit(msg.sender, recipient, universeId, outcomeIndex, childUniverseId, amountAttoRep, migrationRepBalances[msg.sender][universeId].childMigrationRepAmountsAttoRep[childUniverseId]);
		}
	}

	function getMigrationRepBalanceAttoRep(address migrator, uint248 universeId) public view returns (uint256 migrationRepBalanceAttoRep) {
		return migrationRepBalances[migrator][universeId].migrationRepBalanceAttoRep;
	}
}
