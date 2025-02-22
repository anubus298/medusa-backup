import {model} from "@medusajs/framework/utils";

const BackupsModel = model.define("db_backups", {
  id: model.id().primaryKey(),
  url: model.text().nullable(),
  status: model.text().nullable(),
  metadata: model.json().nullable()
});

export default BackupsModel;
