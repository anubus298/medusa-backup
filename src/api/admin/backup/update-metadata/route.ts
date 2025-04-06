import {BACKUPS_MODULE} from "../../../../modules/backups";

export async function POST(req, res) {
  const service = req.scope.resolve(BACKUPS_MODULE);
  const {id, metadata} = JSON.parse(req.body);

  if (!id || !metadata || typeof metadata !== "object") {
    return res
      .status(400)
      .json({error: "'id' and full 'metadata' object are required."});
  }

  try {
    await service.updateBackups({
      id,
      metadata,
    });

    return res.status(200).json({message: "Metadata updated successfully."});
  } catch (error) {
    return res
      .status(500)
      .json({error: `Failed to update metadata: ${error.message}`});
  }
}
