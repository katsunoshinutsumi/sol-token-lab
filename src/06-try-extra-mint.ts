/**
 * 実験：発行権限が残っていると何が起きるか
 *
 *   npm run try-mint [-- --program token]
 *
 * 総発行量と同じ量をもう一度発行しようとします。
 * - 発行権限が残っている → 成功して総供給量が 2 倍になる（＝既存保有者の持ち分が半分に薄まる）
 * - 発行権限を放棄済み     → チェーン側で拒否される
 *
 * 草コインで「発行上限 10 億枚」と宣伝していても、発行権限が残っていれば
 * その上限は発行者の気分次第、ということを体験するためのスクリプトです。
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync, getMint, mintTo } from "@solana/spl-token";
import { fmtAmount, getDevnetConnection, loadKeypair, loadState, programArg, programId, run } from "./lib";

run(async () => {
  const kind = programArg();
  const st = loadState(kind);
  const pid = programId(kind);
  const connection = await getDevnetConnection();
  const owner = loadKeypair();
  const mint = new PublicKey(st.mint);

  const before = await getMint(connection, mint, "confirmed", pid);
  console.log(`現在の総供給量: ${fmtAmount(before.supply, st.decimals)} ${st.symbol}`);
  console.log("発行権限:", before.mintAuthority?.toBase58() ?? "なし（放棄済み）");

  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, pid);
  try {
    await mintTo(connection, owner, mint, ata, owner, before.supply, [], undefined, pid);
    const after = await getMint(connection, mint, "confirmed", pid);
    console.log(`\n⚠️  追加発行に成功しました。総供給量: ${fmtAmount(after.supply, st.decimals)} ${st.symbol}`);
    console.log("   発行権限が残っている限り、発行者はこれを何度でもできます。");
  } catch (e) {
    console.log("\n✅ 追加発行はチェーン側で拒否されました（発行権限がないため）。");
    // チェーン側のログから、拒否された理由の行だけを抜き出して表示する
    const logs: string[] = (e as { logs?: string[] })?.logs ?? [];
    const reason = logs.find((l) => /Error|failed/i.test(l)) ?? (e instanceof Error ? e.message.split("\n")[0] : String(e));
    console.log("   チェーン側のログ:", reason);
  }
});
