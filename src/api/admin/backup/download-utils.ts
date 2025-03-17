import axios from "axios";
import fs from "fs";
import os from "os";
import path from "path";
import {createWriteStream} from "fs";
import {pipeline} from "stream";
import {promisify} from "util";
import {exec} from "child_process";

const pipelineAsync = promisify(pipeline);
const execAsync = promisify(exec);
const TEMP_DIR = os.tmpdir();

export async function downloadAndExtractSQL(fileUrl: string): Promise<string> {
  try {
    console.log(`Downloading file from: ${fileUrl}`);

    // Generate temp paths
    const zipFilePath = path.join(TEMP_DIR, `backup_${Date.now()}.zip`);
    const extractPath = path.join(TEMP_DIR, `backup_${Date.now()}`);

    // Download file
    const response = await axios({
      method: "GET",
      url: fileUrl,
      responseType: "stream",
    });

    const writer = createWriteStream(zipFilePath);
    await pipelineAsync(response.data, writer);

    // Validate File Exists
    if (!fs.existsSync(zipFilePath)) {
      throw new Error("Downloaded file does not exist.");
    }

    // Extract ZIP using built-in unzip command (Linux/Mac)
    if (process.platform === "win32") {
      throw new Error("Windows extraction not implemented yet.");
    }

    fs.mkdirSync(extractPath, {recursive: true});
    await execAsync(`unzip -o "${zipFilePath}" -d "${extractPath}"`);

    // Find the extracted SQL file
    const extractedFiles = fs.readdirSync(extractPath);
    const sqlFile = extractedFiles.find((file) => file.endsWith(".sql"));

    if (!sqlFile) {
      throw new Error("No SQL file found in zip archive.");
    }

    const sqlFilePath = path.join(extractPath, sqlFile);
    console.log(`SQL file extracted: ${sqlFilePath}`);

    // Delete the ZIP file after extraction
    fs.unlinkSync(zipFilePath);

    return sqlFilePath;
  } catch (error) {
    throw new Error(
      `Failed to download and extract SQL file: ${error.message}`
    );
  }
}
