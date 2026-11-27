/**
 * ステップ1：devnet 用ウォレット（鍵ペア）を作る
 *
 * - 鍵ペア = 公開鍵（アドレス。人に教えてよい）＋ 秘密鍵（絶対に人に渡さない）
 * - 秘密鍵は .keys/devnet-wallet.json に保存されます（.gitignore 済み）。
 * - この鍵は devnet の練習専用です。mainnet で本物の資産を入れるウォレットには
 *   使い回さないでください（PC 上に平文で置かれているため）。
 */
import { Keypair } from "@solana/web3.js";
import * as fs from "fs";
import { keyPath, loadKeypair, run, saveKeypair } from "./lib";

run(async () => {
  const name = "devnet-wallet";
  if (fs.existsSync(keyPath(name))) {
    const kp = loadKeypair(name);
    console.log("既存の devnet ウォレットを使います（上書きしません）。");
    console.log("アドレス:", kp.publicKey.toBase58());
    return;
  }
  const kp = Keypair.generate();
  const p = saveKeypair(name, kp);
  console.log("devnet ウォレットを作りました。");
  console.log("アドレス（公開してよい）:", kp.publicKey.toBase58());
  console.log("秘密鍵の保存先（Git に含めない・人に渡さない）:", p);
  console.log('\n次は "npm run airdrop" でテスト用 SOL を受け取ります。');
});
