/**
 * ステップ4：別のアドレスへトークンを送る
 *
 *   npm run transfer                                   … 練習用の受取人を自動で作って 1,000 枚送る
 *   npm run transfer -- --to <アドレス> --amount 500    … 指定先へ送る
 *   （--program token を付けると従来 SPL Token 側のトークンを送ります）
 *
 * - 受取人がまだそのトークンの口座（ATA）を持っていない場合、送り手が作成費用（rent）を
 *   負担して作ります。草コインのエアドロップで送り手側に費用がかさむのはこのため。
 * - transferChecked は小数点（decimals）も照合する送金命令で、桁の間違いを防ぎます。
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, getAccount, transferChecked, getAssociatedTokenAddressSync } from "@solana/spl-token";
import * as fs from "fs";
import {
  explorer,
  fmtAmount,
  getDevnetConnection,
  keyPath,
  loadKeypair,
  loadState,
  programArg,
  programId,
  run,
  saveKeypair,
} from "./lib";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

run(async () => {
  const kind = programArg();
  const st = loadState(kind);
  const pid = programId(kind);
  const connection = await getDevnetConnection();
  const sender = loadKeypair();
  const mint = new PublicKey(st.mint);

  // 受取人：指定がなければ練習用の受取人ウォレットを作る（.keys/recipient.json）
  let to: PublicKey;
  const toArg = arg("--to");
  if (toArg) {
    to = new PublicKey(toArg);
  } else {
    let r: Keypair;
    if (fs.existsSync(keyPath("recipient"))) r = loadKeypair("recipient");
    else {
      r = Keypair.generate();
      saveKeypair("recipient", r);
      console.log("練習用の受取人ウォレットを作りました（.keys/recipient.json）");
    }
    to = r.publicKey;
  }
  const amount = Number(arg("--amount") ?? 1000);
  const raw = BigInt(Math.round(amount * 10 ** st.decimals));

  const fromAta = getAssociatedTokenAddressSync(mint, sender.publicKey, false, pid);
  // 受取人の口座を用意（なければ送り手の負担で作成）
  const toAta = await getOrCreateAssociatedTokenAccount(connection, sender, mint, to, false, "confirmed", undefined, pid);

  const sig = await transferChecked(connection, sender, fromAta, mint, toAta.address, sender, raw, st.decimals, [], undefined, pid);
  console.log(`${amount.toLocaleString("ja-JP")} ${st.symbol} を ${to.toBase58()} へ送りました`);
  console.log("  ", explorer("tx", sig));

  const [a, b] = await Promise.all([
    getAccount(connection, fromAta, "confirmed", pid),
    getAccount(connection, toAta.address, "confirmed", pid),
  ]);
  console.log(`送り手の残高: ${fmtAmount(a.amount, st.decimals)} ${st.symbol}`);
  console.log(`受取人の残高: ${fmtAmount(b.amount, st.decimals)} ${st.symbol}`);
});
