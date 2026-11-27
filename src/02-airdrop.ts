/**
 * ステップ2：devnet のテスト用 SOL を受け取る（エアドロップ）
 *
 * - devnet の SOL は無料のテスト用で、お金としての価値はありません。
 * - トークン作成やアカウント作成には手数料・家賃（rent）として少量の SOL が必要です。
 * - 公開 RPC のエアドロップは混雑や回数制限で失敗することがあります。
 *   その場合は https://faucet.solana.com を開き、表示されたアドレスを貼り付けて
 *   「Devnet」を選んで受け取ってください（GitHub ログインを求められることがあります）。
 */
import { LAMPORTS_PER_SOL } from "@solana/web3.js";
import { getDevnetConnection, loadKeypair, run } from "./lib";

run(async () => {
  const connection = await getDevnetConnection();
  const wallet = loadKeypair();
  const before = await connection.getBalance(wallet.publicKey);
  console.log("アドレス:", wallet.publicKey.toBase58());
  console.log("現在の残高:", before / LAMPORTS_PER_SOL, "SOL (devnet)");

  if (before >= 0.05 * LAMPORTS_PER_SOL) {
    // 今回の手順（2 種類のトークンを作成・送付・権限放棄）で使ったのは約 0.01 SOL
    console.log("練習には十分な残高があるので、エアドロップは省略します。");
    return;
  }
  try {
    const sig = await connection.requestAirdrop(wallet.publicKey, 1 * LAMPORTS_PER_SOL);
    const bh = await connection.getLatestBlockhash();
    await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
    const after = await connection.getBalance(wallet.publicKey);
    console.log("受け取り後の残高:", after / LAMPORTS_PER_SOL, "SOL (devnet)");
  } catch (e) {
    console.log("\nエアドロップに失敗しました（公開 faucet の制限によることが多いです）。");
    console.log("次の手順で受け取ってください：");
    console.log("  1. ブラウザで https://faucet.solana.com を開く");
    console.log("  2. アドレス欄に上のアドレスを貼り付ける");
    console.log("  3. ネットワークで Devnet を選び、1〜2 SOL を受け取る");
    console.log("  4. もう一度 \"npm run airdrop\" を実行して残高を確認する");
    console.log("\n詳細:", e instanceof Error ? e.message : e);
    process.exitCode = 1;
  }
});
