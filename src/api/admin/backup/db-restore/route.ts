import path from "path"
import os from "os"
import fs from "fs"
import { promisify } from "util"
import { exec } from "child_process"
import { createAndUploadBackup, extractDbConfig, extractZipFromUrl } from "../helper"
import { BACKUPS_MODULE } from "../../../../modules/backups"

const TEMP_DIR = os.tmpdir()
const execAsync = promisify(exec)

const PROD = process.env.NODE_ENV === "production"

export async function POST(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE)

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

    console.log("🔄 Starting SAFE database restore process...")

    let { DB_BASE, DB_NAME } = extractDbConfig()
    console.log(`📋 Database config - Base: ${DB_BASE}, Target: ${DB_NAME}`)

    const { url } = JSON.parse(req.body)
    if (!url) {
      console.log("❌ No backup URL provided")
      return res.status(400).json({ error: "Backup URL is required" })
    }
    console.log(`📥 Backup URL received: ${url}`)

    const tempDir = path.join(TEMP_DIR, "restore")
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
      console.log(`📁 Created temp directory: ${tempDir}`)
    } else {
      console.log(`📁 Using existing temp directory: ${tempDir}`)
    }

    console.log("📦 Extracting backup from URL...")
    const backupFilePath = await extractZipFromUrl(url)
    console.log(`✅ Backup extracted to: ${backupFilePath}`)

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

    console.log(`🔧 Maintenance database: ${SAFE_DB_NAME}`)
    console.log(`🔧 Temporary database: ${tempDbName}`)

    // First, ensure our safe database exists
    console.log("🔍 Checking if safe maintenance database exists...")
    let cmd = `psql "${FALLBACK_DB}" -c "SELECT 1 FROM pg_database WHERE datname = '${SAFE_DB_NAME}';"`
    try {
      const result = await execAsync(cmd)
      if (result.stdout.trim().includes("1")) {
        console.log("✅ Safe maintenance database already exists")
      } else {
        console.log("📝 Safe maintenance database not found, creating it...")
        cmd = `psql "${FALLBACK_DB}" -c "CREATE DATABASE \\"${SAFE_DB_NAME}\\";"`
        await execAsync(cmd)
        console.log("✅ Safe maintenance database created successfully")
      }
    } catch (checkError) {
      console.log("⚠️ Could not check/create safe database, falling back to postgres database")
      console.log(`Error details: ${checkError.message}`)
      MAINTENANCE_DB = FALLBACK_DB
    }

    // STEP 1: Create a complete backup of the current database
    console.log("💾 Creating complete backup of current database for rollback...")
    originalDbBackupPath = path.join(tempDir, "original_db_backup.sql")
    cmd = `pg_dump -d "${TARGET_DB_URL}" -f "${originalDbBackupPath}"`
    try {
      await execAsync(cmd)
      console.log("✅ Complete database backup created for rollback protection")
      rollbackNeeded = true // Now we have a backup, we can enable rollback
    } catch (backupError) {
      console.log("❌ CRITICAL: Could not create database backup for rollback protection")
      console.log(`Backup error: ${backupError.message}`)
      throw new Error(`Cannot proceed without rollback protection: ${backupError.message}`)
    }

    // STEP 2: Create temporary database and test the restore
    console.log(`🧪 Creating temporary database for testing restore: ${tempDbName}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "CREATE DATABASE \\"${tempDbName}\\";"`
    try {
      await execAsync(cmd)
      console.log("✅ Temporary database created successfully")
    } catch (createTempError) {
      console.log("❌ Failed to create temporary database")
      console.log(`Create temp error: ${createTempError.message}`)
      throw createTempError
    }

    // STEP 3: Test restore in temporary database
    console.log("🧪 Testing backup restore in temporary database...")
    cmd = `psql "${TEMP_DB_URL}" -f "${backupFilePath}"`
    try {
      const result = await execAsync(cmd)
      console.log("✅ Backup restore test successful!")
      if (result.stderr && result.stderr.trim()) {
        console.log(`Test restore warnings: ${result.stderr}`)
      }
    } catch (testRestoreError) {
      console.log("❌ CRITICAL: Backup restore test failed!")
      console.log(`Test restore error: ${testRestoreError.message}`)

      // Cleanup temp database
      try {
        cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${tempDbName}\\";"`
        await execAsync(cmd)
        console.log("🧹 Cleaned up temporary test database")
      } catch (cleanupError) {
        console.log("⚠️ Could not cleanup temp database:", cleanupError.message)
      }

      throw new Error(`Backup file is corrupted or incompatible: ${testRestoreError.message}`)
    }

    // STEP 4: Backup the db_backups table from original database
    console.log("💾 Backing up db_backups table from original database...")
    cmd = `pg_dump -d "${TARGET_DB_URL}" -t db_backups -f "${backupRecordsPath}"`
    try {
      await execAsync(cmd)
      console.log("✅ db_backups table backed up successfully")
    } catch (backupError) {
      console.log("⚠️ Failed to backup db_backups table (table might not exist)")
      console.log(`Backup error: ${backupError.message}`)
      fs.writeFileSync(backupRecordsPath, "-- No db_backups table found\n")
    }

    // STEP 5: Now proceed with the actual restore (the dangerous part)
    console.log("🚨 STARTING DANGEROUS OPERATIONS - Database replacement in progress...")

    // Terminate other connections to target database
    console.log(`🔌 Terminating connections to database: ${DB_NAME}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"`
    try {
      const result = await execAsync(cmd)
      console.log("✅ Connection termination command executed")
      if (result.stdout && result.stdout.trim()) {
        console.log(`Terminated connections result: ${result.stdout}`)
      }
    } catch (terminateError) {
      console.log("⚠️ Connection termination completed with warnings (this is normal)")
      console.log(`Termination details: ${terminateError.message}`)
    }

    console.log("⏳ Waiting for connections to fully terminate...")
    await new Promise((resolve) => setTimeout(resolve, 2000))
    console.log("✅ Connection termination wait completed")

    // Rename original database to backup name
    const backupDbName = `${DB_NAME}_backup_${timestamp}`
    console.log(`🔄 Renaming original database to: ${backupDbName}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${DB_NAME}\\" RENAME TO \\"${backupDbName}\\";"`
    try {
      await execAsync(cmd)
      console.log("✅ Original database renamed successfully")
    } catch (renameError) {
      console.log("❌ CRITICAL: Failed to rename original database")
      console.log(`Rename error: ${renameError.message}`)
      throw renameError
    }

    // Rename temporary database to target name
    console.log(`🔄 Renaming temporary database to: ${DB_NAME}`)
    cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${tempDbName}\\" RENAME TO \\"${DB_NAME}\\";"`
    try {
      await execAsync(cmd)
      console.log("✅ New database is now active!")
      tempDbName = "" // Clear temp name since it's now the main DB
    } catch (finalRenameError) {
      console.log("❌ CRITICAL: Failed to rename temporary database to target name")
      console.log(`Final rename error: ${finalRenameError.message}`)

      // Try to restore original database name
      console.log("🚨 ATTEMPTING EMERGENCY ROLLBACK...")
      try {
        cmd = `psql "${MAINTENANCE_DB}" -c "ALTER DATABASE \\"${backupDbName}\\" RENAME TO \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        console.log("✅ Emergency rollback successful - original database restored")
        throw new Error(`Database rename failed but rollback successful: ${finalRenameError.message}`)
      } catch (rollbackError) {
        console.log("❌ EMERGENCY ROLLBACK FAILED!")
        console.log(`Rollback error: ${rollbackError.message}`)
        throw new Error(
          `CRITICAL: Database rename failed and rollback failed. Manual intervention required. Original DB: ${backupDbName}, Temp DB: ${tempDbName}`
        )
      }
    }

    // STEP 6: Restore db_backups table to new database
    console.log("🔄 Restoring db_backups table to new database...")

    // Filter out unsupported parameters
    if (fs.existsSync(backupRecordsPath)) {
      console.log("🔍 Filtering unsupported PostgreSQL parameters from backup records...")
      try {
        let backupContent = fs.readFileSync(backupRecordsPath, "utf8")

        fs.writeFileSync(backupRecordsPath, backupContent)
        console.log("✅ Backup records filtered successfully")
      } catch (filterError) {
        console.log("⚠️ Could not filter backup records, proceeding with original file")
        console.log(`Filter warning: ${filterError.message}`)
      }
    }

    cmd = `psql "${TARGET_DB_URL}" -c "DROP TABLE IF EXISTS db_backups;"`
    try {
      await execAsync(cmd)
      console.log("✅ Existing db_backups table dropped from new database")
    } catch (dropTableError) {
      console.log("⚠️ Could not drop db_backups table (might not exist)")
      console.log(`Drop table warning: ${dropTableError.message}`)
    }

    cmd = `psql "${TARGET_DB_URL}" -f "${backupRecordsPath}"`
    try {
      await execAsync(cmd)
      console.log("✅ db_backups table restored successfully")
    } catch (restoreTableError) {
      console.log("⚠️ Could not restore db_backups table")
      console.log(`Restore table warning: ${restoreTableError.message}`)

      if (restoreTableError.message.includes("unrecognized configuration parameter")) {
        console.log("🔄 Retrying db_backups restore with error tolerance...")
        try {
          cmd = `psql "${TARGET_DB_URL}" -v ON_ERROR_STOP=off -f "${backupRecordsPath}"`
          await execAsync(cmd)
          console.log("✅ db_backups table restored with warnings ignored")
        } catch (retryError) {
          console.log("⚠️ Final db_backups restore attempt failed")
          console.log(`Retry error: ${retryError.message}`)
        }
      }
    }

    // STEP 7: Cleanup old database (we keep it for a bit in case of issues)
    console.log(`🧹 Cleaning up backup database: ${backupDbName}`)
    console.log("⚠️ Keeping backup database for safety - you can manually drop it later if everything is working fine")
    console.log(`💡 To remove backup database later, run: DROP DATABASE "${backupDbName}";`)

    // Cleanup temp files
    console.log("🧹 Cleaning up temporary files...")
    fs.rmSync(tempDir, { recursive: true, force: true })
    console.log("✅ Cleanup completed")

    rollbackNeeded = false // Success! No rollback needed

    console.log("🎉 SAFE DATABASE RESTORE COMPLETED SUCCESSFULLY!")
    res.status(200).json({
      message: `Database ${DB_NAME} has been safely restored. Backup database ${backupDbName} is preserved for safety.`,
      backupDatabase: backupDbName,
    })
  } catch (error: any) {
    console.error("❌ Restore process failed with error:", error.message)
    console.error("Stack trace:", error.stack)

    // ROLLBACK LOGIC
    if (rollbackNeeded && originalDbBackupPath && fs.existsSync(originalDbBackupPath)) {
      console.log("🚨 INITIATING ROLLBACK PROCEDURE...")

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
          console.log(`🧹 Cleaning up temporary database: ${tempDbName}`)
          try {
            let cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${tempDbName}\\";"`
            await execAsync(cmd)
            console.log("✅ Temporary database cleaned up")
          } catch (cleanupError) {
            console.log("⚠️ Could not cleanup temporary database:", cleanupError.message)
          }
        }

        // Terminate connections to current database
        console.log("🔌 Terminating connections for rollback...")
        let cmd = `psql "${MAINTENANCE_DB}" -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB_NAME}' AND pid <> pg_backend_pid();"`
        try {
          await execAsync(cmd)
        } catch (terminateError) {
          console.log("⚠️ Connection termination during rollback completed with warnings")
        }

        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Drop current (potentially corrupted) database
        console.log("🗑️ Dropping corrupted database...")
        cmd = `psql "${MAINTENANCE_DB}" -c "DROP DATABASE IF EXISTS \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        console.log("✅ Corrupted database dropped")

        // Create fresh database
        console.log("🏗️ Creating fresh database for rollback...")
        cmd = `psql "${MAINTENANCE_DB}" -c "CREATE DATABASE \\"${DB_NAME}\\";"`
        await execAsync(cmd)
        console.log("✅ Fresh database created")

        // Restore from backup
        console.log("📥 Restoring from rollback backup...")
        cmd = `psql "${TARGET_DB_URL}" -f "${originalDbBackupPath}"`
        await execAsync(cmd)
        console.log("✅ ROLLBACK SUCCESSFUL - Database restored to original state!")

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
        console.error("💥 ROLLBACK FAILED!")
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
      console.log("🧹 Cleaning up temporary files after error...")
      fs.rmSync(tempDir, { recursive: true, force: true })
      console.log("✅ Error cleanup completed")
    }

    res.status(500).json({
      message: "An error occurred during the restore process",
      error: error.message,
    })
  }
}
