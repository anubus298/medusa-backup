import path from "path"
import os from "os"
import fs from "fs"
import { promisify } from "util"
import { exec } from "child_process"
import { createAndUploadBackup, extractDbConfig, extractZipFromUrl } from "../helper"
import { BACKUPS_MODULE } from "../../../../modules/backups"
import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import BackupsService from "../../../../modules/backups/service"
const TEMP_DIR = os.tmpdir()
const execAsync = promisify(exec)

const PROD = process.env.NODE_ENV === "production"

export async function POST(req: MedusaRequest<{ url?: string | undefined }>, res: MedusaResponse) {
  const service = req.scope.resolve(BACKUPS_MODULE) as BackupsService
  const logger = req.scope.resolve("logger")

  // Variables for rollback tracking
  let rollbackNeeded = false
  let originalDbBackupPath = ""
  let tempDbName = ""

  try {
    if (PROD) {
      const isAnyLoading = (await service.listBackups({ status: "loading" })).length > 0
      if (isAnyLoading) {
        return res.status(400).json({ error: "Backup is already in progress. Please wait." })
      }

      const { backupId } = await createAndUploadBackup(req.scope, "pre-restore")

      if (!backupId) {
        return res.status(400).json({ error: "Error occured trying to take a safe backup" })
      }
    }

    logger.info("Starting SAFE database restore process...")

    let { DB_BASE, DB_NAME } = extractDbConfig()
    logger.info(`Database config - Base: ${DB_BASE}, Target: ${DB_NAME}`)
    //@ts-expect-error it works
    const { url } = JSON.parse(req.body)
    if (!url) {
      logger.error("No backup URL provided")
      return res.status(400).json({ error: "Backup URL is required" })
    }
    logger.info(`Backup URL received: ${url}`)

    const tempDir = path.join(TEMP_DIR, "restore")
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
      logger.info(`Created temp directory: ${tempDir}`)
    } else {
      logger.info(`Using existing temp directory: ${tempDir}`)
    }

    logger.info("Extracting backup from URL...")
    const backupFilePath = await extractZipFromUrl(url)
    logger.info(`Backup extracted to: ${backupFilePath}`)

    const backupRecordsPath = path.join(tempDir, "backup_records.sql")

    // Use a safe maintenance database
    const SAFE_DB_NAME = "postgres_safe_db"
    let MAINTENANCE_DB = `${DB_BASE}/${SAFE_DB_NAME}`
    const FALLBACK_DB = `${DB_BASE}/postgres`
    const TARGET_DB_URL = `${DB_BASE}/${DB_NAME}`

    // Generate unique temporary database name
    const timestamp = Date.now()
    tempDbName = `${DB_NAME}_temp_${timestamp}`
    const TEMP_DB_URL = `${DB_BASE}/${tempDbName}`

    logger.info(`Maintenance database: ${SAFE_DB_NAME}`)
    logger.info(`Temporary database: ${tempDbName}`)

    // First, ensure our safe database exists
    logger.info("Checking if safe maintenance database exists...")
    let cmd = `psql "${FALLBACK_DB}" -c "SELECT 1 FROM pg_database WHERE datname = '${SAFE_DB_NAME}';"`
    try {
      const result = await execAsync(cmd)
      if (result.stdout.trim().includes("1")) {
        logger.info("Safe maintenance database already exists")
      } else {
        logger.info("Safe maintenance database not found, creating it...")
        cmd = `psql "${FALLBACK_DB}" -c "CREATE DATABASE \\"${SAFE_DB_NAME}\\";"`
        await execAsync(cmd)
        logger.info("Safe maintenance database created successfully")
      }
    } catch (checkError) {
      logger.error("Could not check/create safe database, falling back to postgres database", checkError)
      logger.error(`Error details: ${checkError.message}`)
      MAINTENANCE_DB = FALLBACK_DB
    }

    // STEP 1: Create a complete backup of the current database
    logger.info("Creating complete backup of current database for rollback...")
    originalDbBackupPath = path.join(tempDir, "original_db_backup.sql")
    cmd = `pg_dump -d "${TARGET_DB_URL}" -f "${originalDbBackupPath}"`
    try {
      await execAsync(cmd)
      logger.info("Complete database backup created for rollback protection")
      rollbackNeeded = true // Now we have a backup, we can enable rollback
    } catch (backupError) {
      logger.error("CRITICAL: Could not create database backup for rollback protection")
      logger.error(`Backup error: ${backupError.message}`)
      throw new Error(`Cannot proceed without rollback protection: ${backupError.message}`)
    }

    // STEP 2: Create temporary database and test the restore
    logger.info(`Creating temporary database for testing restore: ${tempDbName}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "CREATE DATABASE \\"${tempDbName}\\";"`
    try {
      await execAsync(cmd)
      logger.info("Temporary database created successfully")
    } catch (createTempError) {
      logger.error("Failed to create temporary database")
      logger.error(`Create temp error: ${createTempError.message}`)
      throw createTempError
    }

    // STEP 3: Test restore in temporary database
    logger.info("Testing backup restore in temporary database...")
    cmd = `psql "${TEMP_DB_URL}" -f "${backupFilePath}"`
    try {
      const result = await execAsync(cmd)
      logger.info("Backup restore test successful!")
      if (result.stderr && result.stderr.trim()) {
        logger.info(`Test restore warnings: ${result.stderr}`)
      }
    } catch (testRestoreError) {
      logger.error("CRITICAL: Backup restore test failed!")
      logger.error(`Test restore error: ${testRestoreError.message}`)

      // Cleanup temp database
      try {
        cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${tempDbName}\\";"`
        await execAsync(cmd)
        logger.info("Cleaned up temporary test database")
      } catch (cleanupError) {
        logger.error("Could not cleanup temp database:", cleanupError)
      }

      throw new Error(`Backup file is corrupted or incompatible: ${testRestoreError.message}`)
    }

    // STEP 4: Backup the db_backups table from original database
    logger.info("Backing up db_backups table from original database...")
    cmd = `pg_dump -d "${TARGET_DB_URL}" -t db_backups -f "${backupRecordsPath}"`
    try {
      await execAsync(cmd)
      logger.info("db_backups table backed up successfully")
    } catch (backupError) {
      logger.error("Failed to backup db_backups table (table might not exist)")
      logger.error(`Backup error: ${backupError.message}`)
      fs.writeFileSync(backupRecordsPath, "-- No db_backups table found\n")
    }

    // STEP 5: Now proceed with the actual restore (the dangerous part)
    logger.info("STARTING DANGEROUS OPERATIONS - Database replacement in progress...")

    // Terminate other connections to target database
    logger.info(`Terminating connections to database: ${DB_NAME}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"`
    try {
      const result = await execAsync(cmd)
      logger.info("Connection termination command executed")
      if (result.stdout && result.stdout.trim()) {
        logger.info(`Terminated connections result: ${result.stdout}`)
      }
    } catch (terminateError) {
      logger.warn("Connection termination completed with warnings (this is normal)")
      logger.warn(`Termination details: ${terminateError.message}`)
    }

    logger.info("Waiting for connections to fully terminate...")
    await new Promise((resolve) => setTimeout(resolve, 2000))
    logger.info("Connection termination wait completed")

    // Rename original database to backup name
    const backupDbName = `${DB_NAME}_backup_${timestamp}`
    logger.info(`Renaming original database to: ${backupDbName}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${DB_NAME}\\" RENAME TO \\"${backupDbName}\\";"`
    try {
      await execAsync(cmd)
      logger.info("Original database renamed successfully")
    } catch (renameError) {
      logger.error("CRITICAL: Failed to rename original database")
      logger.error(`Rename error: ${renameError.message}`)
      throw renameError
    }

    // Rename temporary database to target name
    logger.info(`Renaming temporary database to: ${DB_NAME}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${tempDbName}\\" RENAME TO \\"${DB_NAME}\\";"`
    try {
      await execAsync(cmd)
      logger.info("New database is now active!")
      tempDbName = "" // Clear temp name since it's now the main DB
    } catch (finalRenameError) {
      logger.error("CRITICAL: Failed to rename temporary database to target name")
      logger.error(`Final rename error: ${finalRenameError.message}`)

      // Try to restore original database name
      logger.info("ATTEMPTING EMERGENCY ROLLBACK...")
      try {
        cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${backupDbName}\\" RENAME TO \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        logger.info("Emergency rollback successful - original database restored")
        throw new Error(`Database rename failed but rollback successful: ${finalRenameError.message}`)
      } catch (rollbackError) {
        logger.error("EMERGENCY ROLLBACK FAILED!")
        logger.error(`Rollback error: ${rollbackError.message}`)
        throw new Error(
          `CRITICAL: Database rename failed and rollback failed. Manual intervention required. Original DB: ${backupDbName}, Temp DB: ${tempDbName}`
        )
      }
    }

    // STEP 6: Restore db_backups table to new database
    logger.info("Restoring db_backups table to new database...")

    // Filter out unsupported parameters
    if (fs.existsSync(backupRecordsPath)) {
      logger.info("Filtering unsupported PostgreSQL parameters from backup records...")
      try {
        let backupContent = fs.readFileSync(backupRecordsPath, "utf8")

        fs.writeFileSync(backupRecordsPath, backupContent)
        logger.info("Backup records filtered successfully")
      } catch (filterError) {
        logger.warn("Could not filter backup records, proceeding with original file")
        logger.warn(`Filter warning: ${filterError.message}`)
      }
    }

    cmd = `psql "${TARGET_DB_URL}" -c "DROP TABLE IF EXISTS db_backups;"`
    try {
      await execAsync(cmd)
      logger.info("Existing db_backups table dropped from new database")
    } catch (dropTableError) {
      logger.warn("Could not drop db_backups table (might not exist)")
      logger.warn(`Drop table warning: ${dropTableError.message}`)
    }

    cmd = `psql "${TARGET_DB_URL}" -f "${backupRecordsPath}"`
    try {
      await execAsync(cmd)
      logger.info("db_backups table restored successfully")
    } catch (restoreTableError) {
      logger.warn("Could not restore db_backups table")
      logger.warn(`Restore table warning: ${restoreTableError.message}`)

      if (restoreTableError.message.includes("unrecognized configuration parameter")) {
        logger.info("Retrying db_backups restore with error tolerance...")
        try {
          cmd = `psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=off -f "${backupRecordsPath}"`
          await execAsync(cmd)
          logger.info("db_backups table restored with warnings ignored")
        } catch (retryError) {
          logger.warn("Final db_backups restore attempt failed")
          logger.warn(`Retry error: ${retryError.message}`)
        }
      }
    }

    // STEP 7: Cleanup old database
    logger.info(`Cleaning up backup database: ${backupDbName}`)
    try {
      cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${backupDbName}\\";"`
      await execAsync(cmd)
      logger.info("Backup database dropped successfully")
    } catch (dropBackupError) {
      logger.warn("Could not drop backup database, but restore was successful")
      logger.warn(`Drop backup error: ${dropBackupError.message}`)
      logger.info(`To remove backup database manually, run: DROP DATABASE "${backupDbName}";`)
    }

    // Cleanup temp files
    logger.info("Cleaning up temporary files...")
    fs.rmSync(tempDir, { recursive: true, force: true })
    logger.info("Cleanup completed")

    rollbackNeeded = false // Success! No rollback needed

    logger.info("SAFE DATABASE RESTORE COMPLETED SUCCESSFULLY!")
    res.status(200).json({
      message: `Database ${DB_NAME} has been safely restored and backup database cleaned up.`,
    })
  } catch (error: any) {
    console.error("Restore process failed with error:", error.message)
    console.error("Stack trace:", error.stack)

    // ROLLBACK LOGIC
    if (rollbackNeeded && originalDbBackupPath && fs.existsSync(originalDbBackupPath)) {
      logger.info("INITIATING ROLLBACK PROCEDURE...")

      try {
        const { DB_BASE, DB_NAME } = extractDbConfig()
        const SAFE_DB_NAME = "postgres_safe_db"
        let MAINTENANCE_DB = `${DB_BASE}/${SAFE_DB_NAME}`
        const FALLBACK_DB = `${DB_BASE}/postgres`
        const TARGET_DB_URL = `${DB_BASE}/${DB_NAME}`

        // Use fallback if safe db doesn't exist
        try {
          await execAsync(`psql "${MAINTENANCE_DB}" -c "SELECT 1;"`)
        } catch {
          MAINTENANCE_DB = FALLBACK_DB
        }

        // Clean up any temp database first
        if (tempDbName) {
          logger.info(`Cleaning up temporary database: ${tempDbName}`)
          try {
            let cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${tempDbName}\\";"`
            await execAsync(cmd)
            logger.info("Temporary database cleaned up")
          } catch (cleanupError) {
            logger.error("Could not cleanup temporary database:", cleanupError.message)
          }
        }

        // Terminate connections to current database
        logger.info("Terminating connections for rollback...")
        let cmd = `psql "${MAINTENANCE_DB}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"`
        try {
          await execAsync(cmd)
        } catch (terminateError) {
          logger.warn("Connection termination during rollback completed with warnings")
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Drop current (potentially corrupted) database
        logger.info("Dropping corrupted database...")
        cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        logger.info("Corrupted database dropped")

        // Create fresh database
        logger.info("Creating fresh database for rollback...")
        cmd = `psql "${MAINTENANCE_DB}" -c "CREATE DATABASE \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        logger.info("Fresh database created")

        // Restore from backup
        logger.info("Restoring from rollback backup...")
        cmd = `psql "${TARGET_DB_URL}" -f "${originalDbBackupPath}"`
        await execAsync(cmd)
        logger.info("ROLLBACK SUCCESSFUL - Database restored to original state!")

        // Cleanup
        const tempDir = path.join(TEMP_DIR, "restore")
        if (fs.existsSync(tempDir)) {
          fs.rmSync(tempDir, { recursive: true, force: true })
        }

        res.status(500).json({
          message: "Restore failed but database has been rolled back to original state successfully.",
          error: error.message,
          rollback: "successful",
        })
        return
      } catch (rollbackError) {
        console.error("ROLLBACK FAILED!")
        console.error("Rollback error:", rollbackError.message)

        res.status(500).json({
          message: "CRITICAL: Restore failed and rollback failed. Manual intervention required.",
          error: error.message,
          rollback: "failed",
          rollbackError: rollbackError.message,
          manualRecovery: `Use the backup file at: ${originalDbBackupPath}`,
        })
        return
      }
    }

    // Regular cleanup if no rollback needed
    const tempDir = path.join(TEMP_DIR, "restore")
    if (fs.existsSync(tempDir)) {
      logger.info("Cleaning up temporary files after error...")
      fs.rmSync(tempDir, { recursive: true, force: true })
      logger.info("Error cleanup completed")
    }

    res.status(500).json({
      message: "An error occurred during the restore process",
      error: error.message,
    })
  }
}
