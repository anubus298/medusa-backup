import path from "path";
import os from "os";
import {exec} from "child_process";
import fs from "fs";
import {S3FileService} from "../utils";
import {BACKUPS_MODULE} from "../../../../modules/backups";

const DB_BASE = process.env.DATABASE_URL;
const DB_NAME = process.env.DB_NAME;

const TEMP_DIR = os.tmpdir();
const BACKUP_FILE = path.join(TEMP_DIR, "db_backup.sql");

export async function POST(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE);

  try {
    const existingBackups = await service.listBackups({status: "loading"});
    if (existingBackups.length > 0) {
      return res.status(400).json({
        error:
          "Backup is already in progress. Please wait until it is completed."
      });
    }

    const newBackup = await service.createBackups({status: "loading"});
    if (!newBackup?.id) {
      return res
        .status(500)
        .json({error: "Failed to create a new backup entry"});
    }

    const backupId = newBackup.id;
    const DB_URL = `${DB_BASE}/${DB_NAME}`;
    const cmd = `pg_dump -d "${DB_URL}" -f "${BACKUP_FILE}" --exclude-table-data=workflow_execution`;

    exec(cmd, async (error, stdout, stderr) => {
      if (error || stderr || !fs.existsSync(BACKUP_FILE)) {
        await service.updateBackups({id: backupId, status: "error"});
        return res.status(500).json({
          error: error ? error.message : stderr || "Backup file not found!"
        });
      }

      try {
        const s3FileService = new S3FileService();
        const s3Key = await s3FileService.uploadBackup(BACKUP_FILE);
        fs.unlinkSync(BACKUP_FILE);

        await service.updateBackups({
          id: backupId,
          url: s3Key,
          status: "success"
        });

        return res.status(200).json({
          id: backupId,
          s3Url: s3Key,
          message: "Backup completed successfully"
        });
      } catch (uploadError) {
        await service.updateBackups({
          id: backupId,
          status: "error"
        });
        return res.status(500).json({
          error: `Error uploading to S3: ${uploadError.message}`
        });
      }
    });
  } catch (err) {
    return res.status(500).json({
      error: `Unexpected error: ${err.message}`
    });
  }
}

export async function GET(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE);
  try {
    const backups = await service.listBackups(
      {},
      {order: {created_at: "DESC"}}
    );
    return res.status(200).json({backups});
  } catch (err) {
    return res.status(500).json({error: `Unexpected error: ${err.message}`});
  }
}
