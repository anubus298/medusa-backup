import {model} from "@medusajs/framework/utils";

const Backup = model.define("db_backups", {
  id: model.id().primaryKey(),
  fileId: model.text().nullable(),
  fileUrl: model.text().nullable(),
  status: model.text().nullable(),
  metadata: model.json().nullable(),
});

export default Backup;
