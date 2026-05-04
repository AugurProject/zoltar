// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.33;
import { OpenOracle } from '../openOracle/OpenOracle.sol';
import { IReputationToken } from '../../IReputationToken.sol';
import { IWeth9 } from '../interfaces/IWeth9.sol';
import { PriceOracleManagerAndOperatorQueuer } from '../PriceOracleManagerAndOperatorQueuer.sol';

contract PriceOracleManagerAndOperatorQueuerFactory {
	function deployPriceOracleManagerAndOperatorQueuer(OpenOracle _openOracle, IReputationToken _reputationToken, IWeth9 _weth, bytes32 salt) external returns (PriceOracleManagerAndOperatorQueuer) {
		return new PriceOracleManagerAndOperatorQueuer{ salt: keccak256(abi.encode(msg.sender, salt)) }(_openOracle, _reputationToken, _weth);
	}
}
