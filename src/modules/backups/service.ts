import { MedusaService } from "@medusajs/framework/utils"
import Backup from "./models/backups_models"

class BackupsService extends MedusaService({
  Backup,
}) {}

export default BackupsService
