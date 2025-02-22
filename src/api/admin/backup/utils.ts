import path from "path"
import fs from "fs"
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3"
import { pipeline } from "stream"
import { promisify } from "util"
import AdmZip from "adm-zip"

const s3 = new S3Client({
  region: process.env.S3_REGION,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID!,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
  },
})

export class S3FileService {
  async uploadBackup(filePath: string): Promise<string> {
    try {
      const fileName = path.basename(filePath)
      const timestamp = new Date().toISOString().replace(/[:.-]/g, "_")
      const zipFileName = fileName.replace(".sql", `_${timestamp}.zip`)
      const zipFilePath = path.join(path.dirname(filePath), zipFileName)

      const zip = new AdmZip()
      zip.addLocalFile(filePath, "", fileName)
      zip.writeZip(zipFilePath)

      const fileStream = fs.createReadStream(zipFilePath)
      const s3Key = `db_backups/${zipFileName}`

      const params = {
        Bucket: process.env.S3_BUCKET!,
        Key: s3Key,
        Body: fileStream,
      }

      const command = new PutObjectCommand(params)
      await s3.send(command)

      fs.unlinkSync(zipFilePath)

      return s3Key
    } catch (error: any) {
      throw new Error(`Failed to upload file: ${error.message}`)
    }
  }

  async downloadZipFile(s3Key: string, downloadPath: string): Promise<void> {
    try {
      const tempDir = path.join(path.dirname(process.cwd()), "temp")

      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir)
      }

      const zipPath = path.join(tempDir, "temp.zip")
      const command = new GetObjectCommand({
        Bucket: process.env.S3_BUCKET!,
        Key: s3Key,
      })

      const response = await s3.send(command)
      if (!response.Body) {
        throw new Error("No data found in S3 object response.")
      }

      const pipelineAsync = promisify(pipeline)
      const writeStream = fs.createWriteStream(zipPath)
      await pipelineAsync(response.Body as NodeJS.ReadableStream, writeStream)

      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tempDir, true)

      const extractedFiles = fs.readdirSync(tempDir)
      const sqlFile = extractedFiles.find((file) => file.endsWith(".sql"))
      if (!sqlFile) {
        throw new Error("No SQL file found in zip archive")
      }
      fs.renameSync(path.join(tempDir, sqlFile), downloadPath)

      fs.unlinkSync(zipPath)
      fs.rmdirSync(tempDir)
    } catch (error: any) {
      throw new Error(`Failed to download and extract zip file: ${error.message}`)
    }
  }
}
