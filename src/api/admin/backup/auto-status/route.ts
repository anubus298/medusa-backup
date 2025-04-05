export async function GET(req, res) {
  try {
    const DB_BACKUP_AUTO = process.env.DB_BACKUP_AUTO === "true";
    return res.status(200).json({status: DB_BACKUP_AUTO});
  } catch (err) {
    return res.status(500).json({error: `Unexpected error: ${err.message}`});
  }
}
