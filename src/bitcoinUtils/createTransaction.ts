import * as btc from "@scure/btc-signer"
import { hasAny } from "../utils/arrayHelpers"
import { UTXOSpendable } from "./bitcoinHelpers"

export interface Recipient {
  addressScriptPubKey: Uint8Array
  satsAmount: bigint
}

export function createTransaction(
  inputUTXOs: Array<UTXOSpendable>,
  recipients: Array<Recipient>,
  opReturnData: Uint8Array[],
): btc.Transaction {
  const tx = new btc.Transaction({
    allowUnknownOutputs: true,
    allowLegacyWitnessUtxo: true,
  })

  inputUTXOs.forEach(utxo => {
    tx.addInput({
      txid: utxo.txId,
      index: utxo.index,
      witnessUtxo:
        utxo.scriptPubKey == null
          ? undefined
          : {
              script: utxo.scriptPubKey,
              amount: utxo.amount,
            },
      tapInternalKey:
        "tapInternalKey" in utxo ? utxo.tapInternalKey : undefined,
      redeemScript: "redeemScript" in utxo ? utxo.redeemScript : undefined,
      // Enable RBF
      sequence: btc.DEFAULT_SEQUENCE - 2,
    })
  })

  recipients.forEach(recipient => {
    tx.addOutput({
      script: recipient.addressScriptPubKey,
      amount: recipient.satsAmount,
    })
  })

  if (hasAny(opReturnData)) {
    opReturnData.forEach(data => {
      tx.addOutput({
        script: btc.Script.encode(["RETURN", data]),
        amount: 0n,
      })
    })
  }

  return tx
}
