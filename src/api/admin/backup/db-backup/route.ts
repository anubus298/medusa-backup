import { BACKUPS_MODULE } from "../../../../modules/backups"
import { createAndUploadBackup } from "../helper"

export async function POST(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE)

  try {
    const isAnyLoading = (await service.listBackups({ status: "loading" })).length > 0
    if (isAnyLoading) {
      return res.status(400).json({ error: "Backup is already in progress. Please wait." })
    }

    const { backupId, fileId, fileUrl } = await createAndUploadBackup(req.scope)

    return res.status(200).json({
      id: backupId,
      fileId: fileId,
      fileUrl: fileUrl,
      message: "Backup completed successfully",
    })
  } catch (error) {
    if (error.backupId) {
      await service.updateBackups({ id: error.backupId, status: "error" })
    }
    return res.status(500).json({ error: `Backup failed: ${error.message}` })
  }
}

export async function GET(req, res) {
  try {
    const backups = await req.scope.resolve(BACKUPS_MODULE).listBackups({}, { order: { created_at: "DESC" } })
    return res.status(200).json({ backups })
  } catch (err) {
    return res.status(500).json({ error: `Unexpected error: ${err.message}` })
  }
}

export async function DELETE(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE)
  const { id } = JSON.parse(req.body)

  if (!id) {
    return res.status(400).json({ error: "Backup ID is required." })
  }

  try {
    await service.deleteBackups({ id })
    return res.status(200).json({ message: "Backup deleted successfully." })
  } catch (error) {
    return res.status(500).json({ error: `Failed to delete backup: ${error.message}` })
  }
}
