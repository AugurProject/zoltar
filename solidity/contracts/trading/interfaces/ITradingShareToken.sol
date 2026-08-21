// SPDX-License-Identifier: Unlicense
pragma solidity 0.8.35;

import { IShareToken } from '../../statoblast/interfaces/IShareToken.sol';
import { IERC1155 } from '../../statoblast/interfaces/IERC1155.sol';

interface ITradingShareToken is IShareToken, IERC1155 {}
