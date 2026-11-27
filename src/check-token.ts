/**
 * チェック用スクリプト：草コインでよく問題になる点を機械的に確認する（devnet 専用）
 *
 *   npm run check                                  … 自分で作った Token-2022 トークンを確認
 *   npm run check -- --program token               … 自分で作った従来 SPL Token を確認
 *   npm run check -- --mint <ミントアドレス>         … devnet 上の任意のトークンを確認
 *   npm run check -- --mint <A> --lp-mint <LPミント> … 流動性（LP トークン）の扱いも確認
 *
 * 確認項目：
 *   1. 発行権限（mint authority）が残っているか  → 追加発行・希薄化のリスク
 *   2. フリーズ権限が残っているか                 → 特定の保有者を売れなくするリスク
 *   3. Token-2022 の拡張機能                       → 送金手数料・強制移転・送金フックなど
 *   4. メタデータとその更新権限
 *   5. 大口保有の偏り（上位保有者の割合）           → 少数の売りで価格が崩れるリスク
 *   6. （任意）LP トークンの所在                    → 流動性の引き上げ（ラグプル）のリスク
 *
 * 注意：ここで「問題なし」と出ても、そのトークンが価値を持つ・詐欺でない、という意味にはなりません。
 * 確認できるのはチェーン上の設定の一部だけです。
 */
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  getExtensionTypes,
  getMint,
  getTokenMetadata,
  type Mint,
} from "@solana/spl-token";
import * as fs from "fs";
import { KEYS_DIR, fmtAmount, getDevnetConnection, loadKeypair, loadState, programArg, run } from "./lib";

type Level = "OK" | "WARN" | "DANGER" | "INFO";
const icon: Record<Level, string> = { OK: "✅", WARN: "⚠️ ", DANGER: "❌", INFO: "ℹ️ " };
const results: { level: Level; msg: string }[] = [];
function report(level: Level, msg: string) {
  results.push({ level, msg });
  console.log(`${icon[level]} ${msg}`);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** 焼却（burn）先としてよく使われるアドレス。ここに送られたトークンは誰も動かせない */
const INCINERATOR = "1nc1nerator11111111111111111111111111111111";

/**
 * Token-2022 拡張機能の説明。発行者が強い力を持つものほど注意レベルを上げています。
 * 正当な用途もあるので「あるから即詐欺」ではなく、「なぜ必要か説明されているか」を見る材料です。
 */
const EXT_NOTES: Partial<Record<ExtensionType, [Level, string]>> = {
  [ExtensionType.MetadataPointer]: ["INFO", "メタデータポインタ：名前・画像の置き場所を示すだけ。通常は問題なし"],
  [ExtensionType.TokenMetadata]: ["INFO", "トークンメタデータ：名前・シンボル・URI をミント内に保持"],
  [ExtensionType.PermanentDelegate]: ["DANGER", "永久委任（Permanent Delegate）：指定者が誰の口座からでもトークンを移動・焼却できる"],
  [ExtensionType.TransferFeeConfig]: ["WARN", "送金手数料（Transfer Fee）：送金のたびに手数料が取られ、率を後から変更できる場合がある"],
  [ExtensionType.TransferHook]: ["WARN", "送金フック（Transfer Hook）：送金時に任意のプログラムが実行される。売却を妨げる実装も可能"],
  [ExtensionType.DefaultAccountState]: ["WARN", "既定アカウント状態：新しい口座が最初から凍結状態になる設定があり得る"],
  [ExtensionType.MintCloseAuthority]: ["WARN", "ミントクローズ権限：供給が 0 のときミント自体を閉じられる"],
  [ExtensionType.NonTransferable]: ["WARN", "譲渡不可（Non-Transferable）：受け取った人は他人へ送れない"],
  [ExtensionType.ConfidentialTransferMint]: ["WARN", "秘匿送金：残高・送金額が見えなくなり、保有の偏りを確認しにくい"],
  [ExtensionType.InterestBearingConfig]: ["INFO", "利息付き表示：表示上の残高が時間で増える（実際の数量は変わらない）"],
};

/**
 * 公開 devnet RPC は getTokenLargestAccounts を強く回数制限しているため（429）、
 * 取得できないときは「分かっているアドレス」の残高だけを直接読む簡易版に切り替える。
 * 分かっているアドレス = .keys/ にある練習用ウォレット＋ --holders a,b,c で指定したもの。
 */
async function knownHolders(connection: Connection, mint: PublicKey, info: Mint, decimals: number, pid: PublicKey) {
  const owners = new Map<string, string>();
  if (fs.existsSync(KEYS_DIR)) {
    for (const f of fs.readdirSync(KEYS_DIR).filter((f) => f.endsWith(".json"))) {
      try {
        owners.set(loadKeypair(f.replace(/\.json$/, "")).publicKey.toBase58(), `.keys/${f}`);
      } catch {
        /* 読めない鍵ファイルは無視 */
      }
    }
  }
  for (const a of (arg("--holders") ?? "").split(",").filter(Boolean)) owners.set(a, "--holders");
  if (owners.size === 0) {
    report("INFO", "確認できる保有アドレスがありません（--holders で指定可）");
    return;
  }
  const supply = Number(info.supply);
  let known = 0;
  let top1 = 0;
  console.log("\n  既知アドレスの保有量（上位保有者の一覧ではありません）");
  for (const [owner, label] of owners) {
    const ata = getAssociatedTokenAddressSync(mint, new PublicKey(owner), true, pid);
    const bal = await connection.getTokenAccountBalance(ata).catch(() => null);
    const amt = bal ? Number(bal.value.amount) : 0;
    const share = (amt / supply) * 100;
    known += share;
    top1 = Math.max(top1, share);
    console.log(`  ${share.toFixed(2).padStart(6)}%  ${fmtAmount(BigInt(bal?.value.amount ?? "0"), decimals).padStart(20)}  owner=${owner}（${label}）`);
  }
  console.log(`  既知アドレス合計: ${known.toFixed(2)}% / それ以外（未確認）: ${(100 - known).toFixed(2)}%\n`);
  report(top1 >= 20 ? "DANGER" : top1 >= 5 ? "WARN" : "OK", `既知アドレス中の最大保有割合: ${top1.toFixed(2)}%（目安：5%超で注意、20%超で強い偏り）`);
  report("INFO", "上位保有者の全体像は取れていません。別の devnet RPC（SOLANA_RPC_URL）を使うか、Explorer の Holders 欄で確認してください");
}

async function holderConcentration(connection: Connection, mint: PublicKey, info: Mint, decimals: number, pid: PublicKey) {
  // 上位 20 口座（RPC の仕様上、最大 20 件）
  let largest;
  try {
    largest = await connection.getTokenLargestAccounts(mint, "confirmed");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/429|Too many/i.test(msg)) throw e;
    report("INFO", "公開 RPC の回数制限で上位保有者一覧を取得できませんでした。既知アドレスの残高で代用します");
    return knownHolders(connection, mint, info, decimals, pid);
  }
  if (info.supply === 0n || largest.value.length === 0) {
    report("INFO", "保有者がいないため、偏りは計算できません");
    return;
  }
  // 口座（トークンアカウント）→ 実際の持ち主（ウォレット）を引く
  const accs = await connection.getMultipleParsedAccounts(largest.value.map((v) => v.address));
  const supply = Number(info.supply);
  console.log("\n  上位保有口座（トークン口座 → 持ち主）");
  let top10 = 0;
  largest.value.forEach((v, i) => {
    const data = accs.value[i]?.data as { parsed?: { info?: { owner?: string } } } | undefined;
    const owner = data?.parsed?.info?.owner ?? "?";
    const share = (Number(v.amount) / supply) * 100;
    if (i < 10) top10 += share;
    const note = owner === INCINERATOR ? "（焼却アドレス）" : "";
    console.log(`  ${String(i + 1).padStart(2)}. ${share.toFixed(2).padStart(6)}%  ${fmtAmount(BigInt(v.amount), decimals).padStart(20)}  owner=${owner}${note}`);
  });
  const top1 = (Number(largest.value[0].amount) / supply) * 100;
  console.log("");
  report(top1 >= 20 ? "DANGER" : top1 >= 5 ? "WARN" : "OK", `最大保有口座の割合: ${top1.toFixed(2)}%（目安：5%超で注意、20%超で強い偏り）`);
  report(top10 >= 50 ? "DANGER" : top10 >= 25 ? "WARN" : "OK", `上位10口座の合計: ${top10.toFixed(2)}%（目安：25%超で注意、50%超で強い偏り）`);
  report("INFO", "上位に流動性プール・取引所・焼却アドレスが含まれる場合は、それを除いて判断する（持ち主アドレスを Explorer で確認）");
}

async function checkLp(connection: Connection, lpMint: PublicKey) {
  // LP トークン = 流動性プールに資金を預けた証明書。これを持つ人はプールから資金を引き出せる。
  const owner = (await connection.getAccountInfo(lpMint))?.owner;
  const pid = owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const lp = await getMint(connection, lpMint, "confirmed", pid);
  if (lp.supply === 0n) {
    report("INFO", "LP トークンの供給が 0 です（プールが空、または全量焼却済み）");
    return;
  }
  const largest = await connection.getTokenLargestAccounts(lpMint, "confirmed");
  const accs = await connection.getMultipleParsedAccounts(largest.value.map((v) => v.address));
  let burned = 0n;
  let maxOther = 0n;
  largest.value.forEach((v, i) => {
    const data = accs.value[i]?.data as { parsed?: { info?: { owner?: string } } } | undefined;
    const o = data?.parsed?.info?.owner;
    if (o === INCINERATOR) burned += BigInt(v.amount);
    else if (BigInt(v.amount) > maxOther) maxOther = BigInt(v.amount);
  });
  const burnedPct = Number((burned * 10000n) / lp.supply) / 100;
  const otherPct = Number((maxOther * 10000n) / lp.supply) / 100;
  report(burnedPct >= 95 ? "OK" : "WARN", `LP トークンのうち焼却アドレスにある割合: ${burnedPct}%`);
  report(otherPct >= 50 ? "DANGER" : otherPct >= 10 ? "WARN" : "INFO", `焼却以外で最大の LP 保有口座: ${otherPct}%（この持ち主はいつでも流動性を引き上げられる。ロック契約に預けてあるなら期限を確認）`);
}

run(async () => {
  const connection = await getDevnetConnection();
  let mint: PublicKey;
  const mintArg = arg("--mint");
  if (mintArg) mint = new PublicKey(mintArg);
  else mint = new PublicKey(loadState(programArg()).mint);

  const acc = await connection.getAccountInfo(mint);
  if (!acc) throw new Error(`devnet 上にそのアドレスのアカウントがありません: ${mint.toBase58()}`);
  const is2022 = acc.owner.equals(TOKEN_2022_PROGRAM_ID);
  if (!is2022 && !acc.owner.equals(TOKEN_PROGRAM_ID)) throw new Error("トークンのミントアカウントではありません");
  const pid = is2022 ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
  const info = await getMint(connection, mint, "confirmed", pid);

  console.log(`ミント: ${mint.toBase58()}`);
  console.log(`プログラム: ${is2022 ? "Token-2022" : "SPL Token（従来）"}`);
  console.log(`小数点: ${info.decimals} / 総供給量: ${fmtAmount(info.supply, info.decimals)}\n`);

  // 1. 発行権限
  if (info.mintAuthority) report("DANGER", `発行権限が残っています（${info.mintAuthority.toBase58()}）：追加発行で保有者の持ち分を薄められます`);
  else report("OK", "発行権限は放棄済み：これ以上の追加発行はできません");

  // 2. フリーズ権限
  if (info.freezeAuthority) report("DANGER", `フリーズ権限が残っています（${info.freezeAuthority.toBase58()}）：特定の口座を凍結して売れなくできます`);
  else report("OK", "フリーズ権限は放棄済み：口座を凍結される心配はこの設定上はありません");

  // 3. 拡張機能（Token-2022 のみ）
  if (is2022) {
    const exts = getExtensionTypes(info.tlvData);
    if (exts.length === 0) report("OK", "Token-2022 拡張機能：なし");
    for (const e of exts) {
      const [lv, note] = EXT_NOTES[e] ?? ["WARN", `${ExtensionType[e]}：内容を個別に確認してください`];
      report(lv, `拡張 ${ExtensionType[e]} — ${note}`);
    }
  }

  // 4. メタデータ
  if (is2022) {
    const md = await getTokenMetadata(connection, mint, "confirmed", TOKEN_2022_PROGRAM_ID);
    if (md) {
      console.log(`   名前: ${md.name} / シンボル: ${md.symbol} / URI: ${md.uri}`);
      if (md.updateAuthority) report("WARN", `メタデータ更新権限が残っています（${md.updateAuthority.toBase58()}）：名前・画像を後から変更できます`);
      else report("OK", "メタデータ更新権限は放棄済み：名前・画像は固定");
    } else report("INFO", "ミント内メタデータなし");
  } else {
    report("INFO", "従来 SPL Token のメタデータは Metaplex 側（別アカウント）にあり、本スクリプトでは未確認。更新権限（isMutable）を Explorer 等で確認すること");
  }

  // 5. 大口保有の偏り
  await holderConcentration(connection, mint, info, info.decimals, pid);

  // 6. 流動性（LP トークン）
  const lpArg = arg("--lp-mint");
  console.log("");
  if (lpArg) await checkLp(connection, new PublicKey(lpArg));
  else
    report(
      "INFO",
      "流動性プールの確認は未実施（--lp-mint で LP トークンを指定可）。LP が焼却またはロックされていないと、発行者がプールの資金を引き上げられます（ラグプル）",
    );

  const danger = results.filter((r) => r.level === "DANGER").length;
  const warn = results.filter((r) => r.level === "WARN").length;
  console.log(`\n結果: 重大 ${danger} 件 / 注意 ${warn} 件`);
  console.log("※ チェーン上の設定の一部を見ただけです。価値や正当性を保証するものではありません。");
});
