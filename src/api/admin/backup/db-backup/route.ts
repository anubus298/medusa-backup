import path from "path";
import os from "os";
import {execSync} from "child_process";
import fs from "fs";
import {BACKUPS_MODULE} from "../../../../modules/backups";
import {uploadFilesWorkflow} from "@medusajs/medusa/core-flows";

const DB_BASE = process.env.DB_BASE;
const DB_NAME = process.env.DB_NAME;

const TEMP_DIR = os.tmpdir();
const BACKUP_FILE = path.join(TEMP_DIR, "db_backup.sql");

async function createBackupZip() {
  const timestamp = new Date().toISOString().replace(/[:.-]/g, "_");
  const zipFileName = `db_backup_${timestamp}.zip`;
  const zipFilePath = path.join(TEMP_DIR, zipFileName);

  // Use the system's `zip` command
  execSync(`zip -j "${zipFilePath}" "${BACKUP_FILE}"`);

  return {zipFileName, zipFilePath};
}

export async function POST(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE);

  try {
    if ((await service.listBackups({status: "loading"})).length > 0) {
      return res
        .status(400)
        .json({error: "Backup is already in progress. Please wait."});
    }

    const newBackup = await service.createBackups({status: "loading"});
    if (!newBackup?.id) throw new Error("Failed to create a new backup entry");

    const backupId = newBackup.id;
    const DB_URL = `${DB_BASE}/${DB_NAME}`;
    const cmd = `pg_dump -d "${DB_URL}" -f "${BACKUP_FILE}" --exclude-table-data=workflow_execution`;

    execSync(cmd);

    if (!fs.existsSync(BACKUP_FILE)) throw new Error("Backup file not found!");

    const {zipFileName, zipFilePath} = await createBackupZip();
    const fileBuffer = fs.readFileSync(zipFilePath);

    const {result} = await uploadFilesWorkflow(req.scope).run({
      input: {
        files: [
          {
            filename: zipFileName,
            content: fileBuffer.toString("base64"),
            mimeType: "application/zip",
            access: "private",
          },
        ],
      },
    });

    const fileId = result?.[0]?.id || "";
    const fileUrl = result?.[0]?.url || "";
    if (!fileId) throw new Error("Failed to upload backup to S3");

    await service.updateBackups({
      id: backupId,
      fileId: fileId,
      fileUrl: fileUrl,
      status: "success",
    });

    fs.unlinkSync(BACKUP_FILE);
    fs.unlinkSync(zipFilePath);

    return res.status(200).json({
      id: backupId,
      fileId: fileId,
      fileUrl: fileUrl,
      message: "Backup completed successfully",
    });
  } catch (error) {
    await service.updateBackups({id: error.backupId || "", status: "error"});
    return res.status(500).json({error: `Backup failed: ${error.message}`});
  }
}

export async function GET(req, res) {
  try {
    const backups = await req.scope
      .resolve(BACKUPS_MODULE)
      .listBackups({}, {order: {created_at: "DESC"}});
    return res.status(200).json({backups});
  } catch (err) {
    return res.status(500).json({error: `Unexpected error: ${err.message}`});
  }
}
