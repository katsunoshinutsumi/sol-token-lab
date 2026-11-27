/**
 * 共通処理：devnet への接続・ウォレット鍵の読み書き・実行結果の保存
 *
 * このプロジェクトは devnet（テスト用ネットワーク）専用です。
 * 接続先が devnet 以外だと判定した場合は、何もせずに停止します。
 */
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

export const ROOT = path.resolve(__dirname, "..");
export const KEYS_DIR = path.join(ROOT, ".keys"); // .gitignore 済み
export const STATE_DIR = path.join(ROOT, ".state"); // .gitignore 済み

/** devnet の公開 RPC。環境変数 SOLANA_RPC_URL で別の devnet RPC に差し替え可能 */
const DEFAULT_RPC = "https://api.devnet.solana.com";

/**
 * devnet のジェネシスハッシュ（ネットワーク固有の ID のようなもの）。
 * URL に "devnet" と書いてあっても中身が mainnet ということがあり得るので、
 * 接続後に実際のネットワークをこの値で確かめます。
 */
const DEVNET_GENESIS_HASH = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";

export async function getDevnetConnection(): Promise<Connection> {
  const url = process.env.SOLANA_RPC_URL ?? DEFAULT_RPC;
  if (/mainnet/i.test(url)) {
    throw new Error(`mainnet らしき RPC が指定されています（${url}）。このプロジェクトは devnet 専用です。`);
  }
  const connection = new Connection(url, "confirmed");
  const genesis = await connection.getGenesisHash();
  if (genesis !== DEVNET_GENESIS_HASH) {
    throw new Error(
      `接続先が devnet ではありません（genesis=${genesis}）。安全のため停止します。`,
    );
  }
  return connection;
}

/** Solana Explorer（devnet 表示）の URL */
export function explorer(kind: "address" | "tx", id: string): string {
  return `https://explorer.solana.com/${kind}/${id}?cluster=devnet`;
}

// ---------------------------------------------------------------------------
// 鍵ファイル
// ---------------------------------------------------------------------------

export function keyPath(name: string): string {
  return path.join(KEYS_DIR, `${name}.json`);
}

/** 鍵ファイルを読み込む。秘密鍵の中身は画面に表示しない */
export function loadKeypair(name = "devnet-wallet"): Keypair {
  const p = keyPath(name);
  if (!fs.existsSync(p)) {
    throw new Error(`鍵ファイルがありません: ${p}\n先に "npm run keygen" を実行してください。`);
  }
  const secret = Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")));
  return Keypair.fromSecretKey(secret);
}

/** 鍵ファイルを書き出す（既存ファイルは上書きしない） */
export function saveKeypair(name: string, kp: Keypair): string {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const p = keyPath(name);
  if (fs.existsSync(p)) throw new Error(`既に存在します（上書きしません）: ${p}`);
  fs.writeFileSync(p, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return p;
}

// ---------------------------------------------------------------------------
// トークンプログラムの選択（--program token | token2022）
// ---------------------------------------------------------------------------

export type ProgramKind = "token" | "token2022";

export function programArg(argv = process.argv): ProgramKind {
  const i = argv.indexOf("--program");
  const v = i >= 0 ? argv[i + 1] : "token2022";
  if (v !== "token" && v !== "token2022") {
    throw new Error(`--program は token か token2022 を指定してください（指定値: ${v}）`);
  }
  return v;
}

export function programId(kind: ProgramKind): PublicKey {
  return kind === "token" ? TOKEN_PROGRAM_ID : TOKEN_2022_PROGRAM_ID;
}

// ---------------------------------------------------------------------------
// 実行結果（ミントアドレスなど。公開情報で秘密ではない）
// ---------------------------------------------------------------------------

export interface TokenState {
  program: ProgramKind;
  mint: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  createdAt: string;
}

export function stateFile(kind: ProgramKind): string {
  return path.join(STATE_DIR, `token-${kind}.json`);
}

export function saveState(s: TokenState): void {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(stateFile(s.program), JSON.stringify(s, null, 2));
}

export function loadState(kind: ProgramKind): TokenState {
  const p = stateFile(kind);
  if (!fs.existsSync(p)) {
    throw new Error(`まだ ${kind} のトークンを作っていません。先に "npm run create -- --program ${kind}" を実行してください。`);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** 表示用：最小単位（整数）を小数点付きの数量に直す */
export function fmtAmount(raw: bigint, decimals: number): string {
  const s = raw.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  const frac = decimals ? s.slice(s.length - decimals).replace(/0+$/, "") : "";
  return Number(int).toLocaleString("ja-JP") + (frac ? "." + frac : "");
}

/** スクリプト共通の起動処理（エラーを日本語で表示して終了コード 1） */
export function run(main: () => Promise<void>): void {
  main().catch((e) => {
    console.error("\n[エラー]", e instanceof Error ? e.message : e);
    const logs = (e as { logs?: string[] })?.logs;
    if (logs) console.error("プログラムログ:\n  " + logs.join("\n  "));
    process.exit(1);
  });
}
