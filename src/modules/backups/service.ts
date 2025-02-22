import {MedusaService} from "@medusajs/framework/utils";
import BackupsModel from "./models/backups_models";

class BackupsService extends MedusaService({
  BackupsModel
}) {}

export default BackupsService;
