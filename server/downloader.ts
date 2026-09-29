import { execFile } from "node:child_process";
import { mkdir, rename, stat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const REPO = process.env.LAYA_REPO ?? "receptron/laya-onnx";
const REVISION = "main";
const FILES = [
  "laya.onnx",
  "laya.onnx.data",
  "laya_config.json",
  "tokenizer/tokenizer.json",
  "tokenizer/tokenizer_config.json",
];

export function bundleDir() {
  const cacheDir =
    process.env.LAYA_CACHE ??
    path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), ".cache"), "receptron-laya");
  return path.join(cacheDir, REPO.replace("/", "--"), REVISION);
}

export type BundleStatus =
  | { state: "idle" }
  | { state: "downloading"; file: string; received: number; total: number }
  | { state: "ready"; modelDir: string }
  | { state: "error"; message: string };

let status: BundleStatus = { state: "idle" };
let task: Promise<string> | null = null;

export function bundleStatus(): BundleStatus {
  return status;
}

function run(curlArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile("curl", curlArgs, { maxBuffer: 16 * 1024 * 1024 }, (err, _stdout, stderr) => {
      if (err) reject(new Error((stderr ?? "").trim() || err.message));
      else resolve();
    });
    child.stderr?.on("data", (d) => process.stderr.write(d));
  });
}

async function remoteSize(url: string): Promise<number> {
  const headers = await new Promise<string>((resolve, reject) => {
    execFile("curl", ["-sIL", url], { maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr ?? "").trim() || err.message));
      else resolve(stdout);
    });
  });
  const linked = /x-linked-size:\s*(\d+)/i.exec(headers)?.[1];
  if (linked) return Number(linked);
  const lengths = [...headers.matchAll(/content-length:\s*(\d+)/gi)].map((m) => Number(m[1]));
  const last = lengths[lengths.length - 1];
  if (Number.isFinite(last) && last > 0) return last;
  throw new Error(`could not determine size of ${url}`);
}

async function downloadFile(file: string, url: string, dest: string): Promise<void> {
  const total = await remoteSize(url);
  const tmp = `${dest}.part`;
  await mkdir(path.dirname(dest), { recursive: true });
  const existingSize = (await stat(dest).catch(() => null))?.size ?? 0;
  if (existingSize > 0 && existingSize === total) return;
  const refresh = async () => {
    const received = (await stat(tmp).catch(() => null))?.size ?? 0;
    status = { state: "downloading", file, received, total };
  };
  await refresh();
  console.log(`[laya] ${file}: downloading ${total} bytes (curl, resumable)`);
  const timer = setInterval(refresh, 2000);
  try {
    await run([
      "-L", "-sS", "-C", "-", "--fail-early",
      "--retry", "20", "--retry-delay", "3", "--retry-all-errors", "--retry-connrefused",
      "--connect-timeout", "20",
      "-o", tmp, url,
    ]);
  } finally {
    clearInterval(timer);
  }
  const got = (await stat(tmp)).size;
  if (got !== total) throw new Error(`${file}: got ${got} of ${total} bytes`);
  await rename(tmp, dest);
  console.log(`[laya] ${file}: complete (${got} bytes)`);
}

export async function ensureLocalBundle(): Promise<string> {
  if (task) return task;
  const dir = bundleDir();
  const base = `https://huggingface.co/${REPO}/resolve/${REVISION}/`;
  task = (async () => {
    for (const file of FILES) {
      await downloadFile(file, `${base}${file}`, path.join(dir, file));
    }
    status = { state: "ready", modelDir: dir };
    return dir;
  })();
  try {
    return await task;
  } catch (err) {
    status = { state: "error", message: err instanceof Error ? err.message : String(err) };
    task = null;
    throw err;
  }
}