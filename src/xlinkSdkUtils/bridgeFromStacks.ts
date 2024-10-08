import * as btc from "@scure/btc-signer"
import { ContractCallOptions } from "clarity-codegen"
import { addressToScriptPubKey } from "../bitcoinUtils/bitcoinHelpers"
import { contractAssignedChainIdFromKnownChain } from "../stacksUtils/crossContractDataMapping"
import { isSupportedStacksRoute } from "../stacksUtils/peggingHelpers"
import {
  composeTxXLINK,
  getStacksContractCallInfo,
  getStacksTokenContractInfo,
  numberToStacksContractNumber,
} from "../stacksUtils/xlinkContractHelpers"
import {
  buildSupportedRoutes,
  defineRoute,
} from "../utils/buildSupportedRoutes"
import { UnsupportedBridgeRouteError } from "../utils/errors"
import { decodeHex } from "../utils/hexHelpers"
import { assertExclude, checkNever } from "../utils/typeHelpers"
import {
  KnownChainId,
  KnownTokenId,
  _allKnownEVMMainnetChains,
} from "../utils/types/knownIds"
import { ChainId, SDKNumber, TokenId } from "./types"
import { SDKGlobalContext } from "./types.internal"

export const supportedRoutes = buildSupportedRoutes(
  [
    // from mainnet
    ...defineRoute(
      // to Bitcoin
      [[KnownChainId.Stacks.Mainnet], [KnownChainId.Bitcoin.Mainnet]],
      [[KnownTokenId.Stacks.aBTC, KnownTokenId.Bitcoin.BTC]],
    ),
    ...defineRoute(
      // to rest EVM chains
      [[KnownChainId.Stacks.Mainnet], [..._allKnownEVMMainnetChains]],
      [
        // BTCs
        [KnownTokenId.Stacks.aBTC, KnownTokenId.EVM.WBTC],
        [KnownTokenId.Stacks.aBTC, KnownTokenId.EVM.BTCB],
        [KnownTokenId.Stacks.aBTC, KnownTokenId.EVM.aBTC],
        // USDTs
        [KnownTokenId.Stacks.sUSDT, KnownTokenId.EVM.USDT],
        [KnownTokenId.Stacks.sUSDT, KnownTokenId.EVM.sUSDT],
        // others
        [KnownTokenId.Stacks.sSKO, KnownTokenId.EVM.SKO],
        [KnownTokenId.Stacks.ALEX, KnownTokenId.EVM.ALEX],
        [KnownTokenId.Stacks.vLiSTX, KnownTokenId.EVM.vLiSTX],
        [KnownTokenId.Stacks.vLiALEX, KnownTokenId.EVM.vLiALEX],
      ],
    ),

    // from testnet
  ],
  {
    isSupported: isSupportedStacksRoute,
  },
)

export interface BridgeFromStacksInput {
  fromChain: ChainId
  toChain: ChainId
  fromToken: TokenId
  toToken: TokenId
  toAddress: string
  amount: SDKNumber
  sendTransaction: (tx: ContractCallOptions) => Promise<{
    txid: string
  }>
}

export interface BridgeFromStacksOutput {
  txid: string
}

export async function bridgeFromStacks(
  ctx: SDKGlobalContext,
  info: BridgeFromStacksInput,
): Promise<BridgeFromStacksOutput> {
  const route = await supportedRoutes.checkRouteValid(ctx, info)

  if (KnownChainId.isStacksChain(route.fromChain)) {
    if (KnownChainId.isBitcoinChain(route.toChain)) {
      if (
        KnownTokenId.isStacksToken(route.fromToken) &&
        KnownTokenId.isBitcoinToken(route.toToken)
      ) {
        return bridgeFromStacks_toBitcoin({
          ...info,
          fromChain: route.fromChain,
          toChain: route.toChain,
          fromToken: route.fromToken,
          toToken: route.toToken,
        })
      }
    } else if (KnownChainId.isEVMChain(route.toChain)) {
      if (
        KnownTokenId.isStacksToken(route.fromToken) &&
        KnownTokenId.isEVMToken(route.toToken)
      ) {
        return bridgeFromStacks_toEVM({
          ...info,
          fromChain: route.fromChain,
          toChain: route.toChain,
          fromToken: route.fromToken,
          toToken: route.toToken,
        })
      }
    } else {
      assertExclude(route.toChain, assertExclude.i<KnownChainId.StacksChain>())
      checkNever(route)
    }
  } else {
    assertExclude(route.fromChain, assertExclude.i<KnownChainId.EVMChain>())
    assertExclude(route.fromChain, assertExclude.i<KnownChainId.BitcoinChain>())
    checkNever(route)
  }

  throw new UnsupportedBridgeRouteError(
    info.fromChain,
    info.toChain,
    info.fromToken,
    info.toToken,
  )
}

async function bridgeFromStacks_toBitcoin(
  info: Omit<
    BridgeFromStacksInput,
    "fromChain" | "toChain" | "fromToken" | "toToken"
  > & {
    fromChain: KnownChainId.StacksChain
    toChain: KnownChainId.BitcoinChain
    fromToken: KnownTokenId.StacksToken
    toToken: KnownTokenId.BitcoinToken
  },
): Promise<BridgeFromStacksOutput> {
  const contractCallInfo = getStacksContractCallInfo(info.fromChain)
  if (!contractCallInfo) {
    throw new UnsupportedBridgeRouteError(
      info.fromChain,
      info.toChain,
      info.fromToken,
      info.toToken,
    )
  }

  const { deployerAddress } = contractCallInfo

  const bitcoinNetwork =
    info.toChain === KnownChainId.Bitcoin.Mainnet
      ? btc.NETWORK
      : btc.TEST_NETWORK

  const options = composeTxXLINK(
    "btc-peg-out-endpoint-v2-01",
    "request-peg-out-0",
    {
      "peg-out-address": addressToScriptPubKey(bitcoinNetwork, info.toAddress),
      amount: numberToStacksContractNumber(info.amount),
    },
    { deployerAddress },
  )

  return await info.sendTransaction(options)
}

async function bridgeFromStacks_toEVM(
  info: Omit<
    BridgeFromStacksInput,
    "fromChain" | "toChain" | "fromToken" | "toToken"
  > & {
    fromChain: KnownChainId.StacksChain
    toChain: KnownChainId.EVMChain
    fromToken: KnownTokenId.StacksToken
    toToken: KnownTokenId.EVMToken
  },
): Promise<BridgeFromStacksOutput> {
  const contractCallInfo = getStacksContractCallInfo(info.fromChain)
  const tokenContractInfo = getStacksTokenContractInfo(
    info.fromChain,
    info.fromToken,
  )
  if (contractCallInfo == null || tokenContractInfo == null) {
    throw new UnsupportedBridgeRouteError(
      info.fromChain,
      info.toChain,
      info.fromToken,
      info.toToken,
    )
  }

  const options = composeTxXLINK(
    "cross-peg-out-endpoint-v2-01",
    "transfer-to-unwrap",
    {
      "token-trait": `${tokenContractInfo.deployerAddress}.${tokenContractInfo.contractName}`,
      "amount-in-fixed": numberToStacksContractNumber(info.amount),
      "dest-chain-id": contractAssignedChainIdFromKnownChain(info.toChain),
      "settle-address": decodeHex(info.toAddress),
    },
    { deployerAddress: contractCallInfo.deployerAddress },
  )

  return await info.sendTransaction(options)
}
