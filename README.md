# Medusa Backup (Forked & Enhanced)

<p align="center">
  <img alt="Medusa logo" src="https://raw.githubusercontent.com/YOUR-USERNAME/medusa-backup/main/metadata/icon_medusa_backup.svg" width="120">
</p>

<h1 align="center">Medusa Backup (Enhanced Fork)</h1>

<p align="center">
  Database backup plugin for Medusa v2.10+ with improved reliability
</p>

---

## ✨ What’s New in This Fork

This project is a fork of [AmeerRizvi/medusa-backup](https://github.com/AmeerRizvi/medusa-backup), updated and optimized with the following improvements:

- ✅ Full compatibility with **Medusa v2.10+**
- ✅ **Automatic rollback** → if a backup fails midway, the database is safely restored to its previous state

---

## 🚀 Installation

If published under your npm scope (example: `@anubus298/medusa-backup`):

```bash
npm i @anubus298/medusa-backup
```

Or install directly from GitHub:

```bash
npm install github:anubus298/medusa-backup
```

---

## ⚙️ Configuration

### `medusa.config.ts`

```ts
module.exports = defineConfig({
  ...,
  plugins: [
    {
      resolve: "@anubus298/medusa-backup",
      options: {},
    },
  ],
})
```

Run database migrations:

```bash
npx medusa db:migrate
```

---

## 🔑 Environment Variables

Default setup:

```dotenv
DATABASE_URL=postgres://[USERNAME]:[PASSWORD]@[HOST]/[DB]
```

If you separate the DB base and name:

```dotenv
DB_BASE=postgres://[USERNAME]:[PASSWORD]@[HOST]
DB_NAME=[DB]
```

---

## 🛠 Requirements

- **PostgreSQL client (pg_dump)** must be installed:

  ```bash
  pg_dump --version
  ```

- **S3 configuration** must be set up as described in [Medusa documentation](https://docs.medusajs.com/resources/architectural-modules/file/s3#content).

Example S3 config in `medusa.config.ts`:

```ts
module.exports = defineConfig({
  modules: [
    {
      resolve: "@medusajs/medusa/file",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/file-s3",
            id: "s3",
            options: {
              file_url: process.env.S3_FILE_URL,
              access_key_id: process.env.S3_ACCESS_KEY_ID,
              secret_access_key: process.env.S3_SECRET_ACCESS_KEY,
              region: process.env.S3_REGION,
              bucket: process.env.S3_BUCKET,
              endpoint: process.env.S3_ENDPOINT,
              prefix: "resources/",
            },
          },
        ],
      },
    },
  ],
})
```

---

## 🔄 Automatic Backups

Enable automatic backups in `.env`:

```dotenv
DB_BACKUP_AUTO=true
```

Default schedule: **daily at 1 AM**.
Customize with CRON:

```dotenv
DB_BACKUP_SCHEDULE="0 1 * * *"
```

For more details, see [crontab.guru](https://crontab.guru/).
⚠️ Automatic backups run **only in production**.

## 📝 Notes

- Backups are compressed (\~70% smaller size).
- Backup failures are now handled gracefully with rollback support.
- PostgreSQL version should match your installed `pg_dump` and `psql` tools.
- Safe to restore production backups into local environments for testing.

---

## 📜 Changelog

### v2.10.x+

- Added compatibility with Medusa v2.10+
- Introduced rollback mechanism for failed backups
- Optimized performance of backup creation

---

## 🙏 Credits

Forked from [AmeerRizvi/medusa-backup](https://github.com/AmeerRizvi/medusa-backup).
Big thanks to the original author for building the foundation of this plugin.

---
