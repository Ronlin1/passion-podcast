import {
  clusterApiUrl,
  Connection,
  LAMPORTS_PER_SOL,
  PublicKey,
} from "@solana/web3.js";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";

function endpoint() {
  if (config.solana.rpcUrl) return config.solana.rpcUrl;
  if (config.solana.cluster === "mainnet-beta") return clusterApiUrl("mainnet-beta");
  if (config.solana.cluster === "testnet") return clusterApiUrl("testnet");
  return clusterApiUrl("devnet");
}

function connection() {
  return new Connection(endpoint(), "confirmed");
}

export function solanaClientConfig() {
  return {
    enabled: Boolean(config.solana.receiverAddress),
    cluster: config.solana.cluster,
    rpcUrl: endpoint(),
    receiverAddress: config.solana.receiverAddress,
    premiumSol: config.solana.premiumSol,
  };
}

export async function verifySolanaPayment({ signature, expectedSol = config.solana.premiumSol }) {
  if (!config.solana.receiverAddress) {
    throw new AppError("SOLANA_RECEIVER_ADDRESS is not configured. Add it to .env to enable real Solana unlocks.", 400);
  }
  if (!signature) {
    throw new AppError("Transaction signature is required.", 400);
  }

  const receiver = new PublicKey(config.solana.receiverAddress);
  const minimumLamports = Math.floor(Number(expectedSol) * LAMPORTS_PER_SOL);
  const tx = await connection().getParsedTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });

  if (!tx) {
    throw new AppError("Transaction was not found on Solana yet. Wait a few seconds and retry.", 404);
  }

  const instructions = tx.transaction.message.instructions || [];
  const matchingTransfer = instructions.find((instruction) => {
    const parsed = instruction.parsed;
    if (!parsed || parsed.type !== "transfer") return false;
    const info = parsed.info || {};
    return (
      info.destination === receiver.toBase58() &&
      Number(info.lamports || 0) >= minimumLamports
    );
  });

  if (!matchingTransfer) {
    throw new AppError("Transaction does not include the required premium transfer.", 402, {
      receiver: receiver.toBase58(),
      minimumLamports,
    });
  }

  return {
    ok: true,
    signature,
    receiver: receiver.toBase58(),
    amountSol: Number(expectedSol),
    cluster: config.solana.cluster,
  };
}
