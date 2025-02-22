import BackupsService from "./service"
import { Module } from "@medusajs/framework/utils"

export const BACKUPS_MODULE = "backups"

export default Module(BACKUPS_MODULE, {
  service: BackupsService,
})
