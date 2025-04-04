import fetch from "node-fetch";
import * as unzipper from "unzipper";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import {Readable} from "stream";
import {execSync} from "child_process";

const TEMP_DIR = os.tmpdir();

export async function extractZipFromUrl(url: string): Promise<string> {
  const tempDir = path.join(TEMP_DIR, "restore");
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error("Failed to fetch ZIP from URL");
  }

  const base64 = Buffer.from(await response.arrayBuffer()).toString("utf-8");
  const buffer = Buffer.from(base64, "base64");

  await new Promise((resolve, reject) => {
    Readable.from(buffer)
      .pipe(unzipper.Extract({path: tempDir}))
      .on("close", resolve)
      .on("error", reject);
  });

  const sqlFile = fs.readdirSync(tempDir).find((f) => f.endsWith(".sql"));
  if (!sqlFile) throw new Error("No SQL file found in extracted ZIP");

  return path.join(tempDir, sqlFile);
}

export async function createBackupZip(dir: string, file: string) {
  const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
  const zipFileName = `db_backup_${timestamp}.zip`;
  const zipFilePath = path.join(dir, zipFileName);
  execSync(`zip -j "${zipFilePath}" "${file}"`);
  return {zipFileName, zipFilePath};
}
