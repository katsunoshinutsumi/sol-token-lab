/**
 * ステップ3：トークンを発行する
 *
 *   npm run create                      … Token-2022（メタデータ付き）
 *   npm run create -- --program token   … 従来の SPL Token（比較用）
 *
 * 用語：
 * - ミント（mint）アカウント：トークンの「種類」そのもの。小数点・総供給量・権限を持つ。
 *   このアドレスが、いわゆる「コントラクトアドレス（CA）」です。
 * - 発行権限（mint authority）：追加でトークンを刷れる権限。残っていると、
 *   後から好きなだけ増やせる＝既存保有者の持ち分を薄められる。
 * - フリーズ権限（freeze authority）：特定の保有者のトークンを凍結（送金不能）にできる権限。
 * - トークンアカウント（ATA）：「誰が・どのトークンを・いくつ持っているか」を記録する口座。
 *
 * このスクリプトでは、権限放棄の練習のために、あえて発行権限とフリーズ権限を
 * 自分のウォレットに持たせた状態で作ります（ステップ5で放棄します）。
 */
import {
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  ExtensionType,
  LENGTH_SIZE,
  TOKEN_2022_PROGRAM_ID,
  TYPE_SIZE,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createMint,
  getMintLen,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { createInitializeInstruction, pack, type TokenMetadata } from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as path from "path";
import {
  ROOT,
  explorer,
  fmtAmount,
  getDevnetConnection,
  loadKeypair,
  programArg,
  programId,
  run,
  saveState,
} from "./lib";

interface Config {
  name: string; // トークン名（例：Lab Test Coin）
  symbol: string; // ティッカー（例：LABT）
  decimals: number; // 小数点以下の桁数。SOL は 9、USDC は 6。草コインは 6 や 9 が多い
  totalSupply: number; // 総発行量（小数点を考慮しない「枚数」）
  uri: string; // メタデータ JSON（画像・説明文など）の URL
}

run(async () => {
  const kind = programArg();
  const cfg: Config = JSON.parse(fs.readFileSync(path.join(ROOT, "token.config.json"), "utf8"));
  const connection = await getDevnetConnection();
  const payer = loadKeypair(); // 手数料を払い、各権限を持つウォレット
  const pid = programId(kind);

  console.log(`[${kind}] トークンを作成します：${cfg.name} (${cfg.symbol}), decimals=${cfg.decimals}, 総発行量=${cfg.totalSupply.toLocaleString("ja-JP")}`);

  // ミントアカウント用の新しいアドレス。作成時の署名にだけ使い、秘密鍵は保存しません。
  const mintKp = Keypair.generate();
  const mint = mintKp.publicKey;

  if (kind === "token2022") {
    // ---------------------------------------------------------------------
    // Token-2022：拡張機能（extension）としてメタデータをミント自身に書き込める
    // ---------------------------------------------------------------------
    const metadata: TokenMetadata = {
      mint,
      name: cfg.name,
      symbol: cfg.symbol,
      uri: cfg.uri,
      additionalMetadata: [["purpose", "devnet learning only / no value"]],
      // メタデータ更新権限：名前・シンボル・画像 URL を後から書き換えられる権限
      updateAuthority: payer.publicKey,
    };

    // ミントのサイズ（拡張「メタデータポインタ」込み）と、メタデータ本体のサイズ
    const mintLen = getMintLen([ExtensionType.MetadataPointer]);
    const metadataLen = TYPE_SIZE + LENGTH_SIZE + pack(metadata).length;
    // rent（家賃）：アカウントをチェーン上に置き続けるための預け金。容量に比例
    const lamports = await connection.getMinimumBalanceForRentExemption(mintLen + metadataLen);

    const tx = new Transaction().add(
      // (1) ミント用アカウントを確保（所有者 = Token-2022 プログラム）
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: mint,
        space: mintLen,
        lamports,
        programId: TOKEN_2022_PROGRAM_ID,
      }),
      // (2) 「メタデータはこのミント自身に置いてある」という目印を設定
      createInitializeMetadataPointerInstruction(mint, payer.publicKey, mint, TOKEN_2022_PROGRAM_ID),
      // (3) ミントを初期化：小数点・発行権限・フリーズ権限
      createInitializeMintInstruction(mint, cfg.decimals, payer.publicKey, payer.publicKey, TOKEN_2022_PROGRAM_ID),
      // (4) 名前・シンボル・URI を書き込む
      createInitializeInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint,
        updateAuthority: payer.publicKey,
        mint,
        mintAuthority: payer.publicKey,
        name: cfg.name,
        symbol: cfg.symbol,
        uri: cfg.uri,
      }),
    );
    const sig = await sendAndConfirmTransaction(connection, tx, [payer, mintKp]);
    console.log("ミント作成（メタデータ付き）:", explorer("tx", sig));
  } else {
    // ---------------------------------------------------------------------
    // 従来の SPL Token：ミントにはメタデータを置けない。
    // 名前・画像をウォレットに表示させるには Metaplex の Token Metadata
    // プログラムで別アカウントを作るのが一般的（README 参照）。ここでは省略。
    // ---------------------------------------------------------------------
    await createMint(connection, payer, payer.publicKey, payer.publicKey, cfg.decimals, mintKp, undefined, pid);
    console.log("ミント作成（メタデータなし）");
  }
  console.log("ミントアドレス:", mint.toBase58());
  console.log("  ", explorer("address", mint.toBase58()));

  // 自分のトークン口座（ATA）を作り、総発行量を全部そこへ発行する
  const ata = await getOrCreateAssociatedTokenAccount(connection, payer, mint, payer.publicKey, false, "confirmed", undefined, pid);
  const raw = BigInt(cfg.totalSupply) * 10n ** BigInt(cfg.decimals); // チェーン上は「最小単位の整数」で扱う
  const mintSig = await mintTo(connection, payer, mint, ata.address, payer, raw, [], undefined, pid);
  console.log(`総発行量 ${fmtAmount(raw, cfg.decimals)} ${cfg.symbol} を自分の口座へ発行:`, explorer("tx", mintSig));

  saveState({
    program: kind,
    mint: mint.toBase58(),
    name: cfg.name,
    symbol: cfg.symbol,
    decimals: cfg.decimals,
    totalSupply: cfg.totalSupply,
    createdAt: new Date().toISOString(),
  });

  console.log("\nこの時点では発行権限・フリーズ権限が残っています。");
  console.log(`  確認: npm run check -- --program ${kind}`);
  console.log(`  追加発行できてしまうことの確認: npm run try-mint -- --program ${kind}`);
});
