import path from "path";
import os from "os";
import {exec} from "child_process";
import {promisify} from "util";
import fs from "fs";
import {S3FileService} from "../utils";

const DB_BASE = process.env.DATABASE_URL;
const DB_NAME = process.env.DB_NAME;

const TEMP_DIR = os.tmpdir();
const execAsync = promisify(exec);

export async function POST(req, res) {
  try {
    const s3FileService = new S3FileService();
    const {backupKey} = JSON.parse(req.body);
    if (!backupKey) {
      return res.status(400).json({error: "Backup key is required"});
    }

    const backupFilePath = path.join(TEMP_DIR, "restore_backup.sql");
    await s3FileService.downloadZipFile(backupKey, backupFilePath);

    const BACKUP_FILE = backupFilePath;
    const BACKUP_RECORDS_FILE = path.join(TEMP_DIR, "backup_records.sql");

    const DB_URL = `${DB_BASE}/${DB_NAME}`;

    let cmd = `pg_dump -d "${DB_URL}" -t db_backups -f "${BACKUP_RECORDS_FILE}"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}';"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}" -c "DROP DATABASE IF EXISTS \\"${DB_NAME}\\";"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}" -c "CREATE DATABASE \\"${DB_NAME}\\";"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}/${DB_NAME}" -f "${BACKUP_FILE}"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}/${DB_NAME}" -c "DROP TABLE IF EXISTS db_backups;"`;
    await execAsync(cmd);

    cmd = `psql "${DB_BASE}/${DB_NAME}" -f "${BACKUP_RECORDS_FILE}"`;
    await execAsync(cmd);

    fs.unlinkSync(BACKUP_RECORDS_FILE);
    fs.unlinkSync(backupFilePath);

    res.status(200).json({
      message: `Database ${DB_NAME} has been reset, recreated, and restored successfully.`
    });
  } catch (error) {
    res.status(500).json({
      message: "An error occurred during the restore process",
      error: error.message
    });
  }
}
