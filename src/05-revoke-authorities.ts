/**
 * ステップ5：発行権限とフリーズ権限を放棄する（取り消し不可）
 *
 *   npm run revoke                          … Token-2022 側：発行権限＋フリーズ権限を放棄
 *   npm run revoke -- --metadata            … さらにメタデータ更新権限も放棄（名前・画像の変更が不可能に）
 *   npm run revoke -- --program token       … 従来 SPL Token 側
 *
 * 「権限を null（なし）にする」＝誰も二度とその操作をできなくなる、という意味です。
 * mainnet で同じことをすると元に戻す方法はありません（devnet なので練習として実行します）。
 *
 * なぜ放棄するのか：
 * - 発行権限が残っている → 発行者がいつでも追加発行して売り抜けられる（希薄化）
 * - フリーズ権限が残っている → 発行者が特定の人の口座を凍結し、売れなくできる（ハニーポット型の詐欺で悪用される）
 * - メタデータ更新権限が残っている → 後から名前やロゴを有名銘柄そっくりに変えられる
 *   （一方で、URL 切れの修正などに使えなくなるので、放棄するかは目的次第）
 */
import { PublicKey, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { AuthorityType, TOKEN_2022_PROGRAM_ID, getMint, setAuthority } from "@solana/spl-token";
import { createUpdateAuthorityInstruction } from "@solana/spl-token-metadata";
import { explorer, getDevnetConnection, loadKeypair, loadState, programArg, programId, run } from "./lib";

run(async () => {
  const kind = programArg();
  const st = loadState(kind);
  const pid = programId(kind);
  const connection = await getDevnetConnection();
  const owner = loadKeypair();
  const mint = new PublicKey(st.mint);

  const info = await getMint(connection, mint, "confirmed", pid);

  if (info.mintAuthority) {
    const sig = await setAuthority(connection, owner, mint, owner, AuthorityType.MintTokens, null, [], undefined, pid);
    console.log("発行権限を放棄しました:", explorer("tx", sig));
  } else console.log("発行権限は既に放棄済みです。");

  if (info.freezeAuthority) {
    const sig = await setAuthority(connection, owner, mint, owner, AuthorityType.FreezeAccount, null, [], undefined, pid);
    console.log("フリーズ権限を放棄しました:", explorer("tx", sig));
  } else console.log("フリーズ権限は既に放棄済みです。");

  if (process.argv.includes("--metadata")) {
    if (kind !== "token2022") {
      console.log("従来 SPL Token にはミント内のメタデータがありません（Metaplex 側の権限は別管理）。");
    } else {
      const tx = new Transaction().add(
        createUpdateAuthorityInstruction({
          programId: TOKEN_2022_PROGRAM_ID,
          metadata: mint,
          oldAuthority: owner.publicKey,
          newAuthority: null,
        }),
      );
      const sig = await sendAndConfirmTransaction(connection, tx, [owner]);
      console.log("メタデータ更新権限を放棄しました:", explorer("tx", sig));
    }
  }

  console.log(`\n確認: npm run check -- --program ${kind}`);
  console.log(`追加発行が失敗することの確認: npm run try-mint -- --program ${kind}`);
});
