<p align="center">
  <a href="https://www.medusajs.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/icon_medusa_backup.svg">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/icon_medusa_backup.svg">
    <img alt="Medusa logo" src="https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/icon_medusa_backup.svg">
    </picture>
  </a>
</p>
<h1 align="center">
  Medusa Backup
</h1>

<p align="center">
  DB Backups for Medusa v2
</p>

A lightweight database backup solution for Medusa.js v2. Now you can create, manage, and restore database backups for PostgreSQL

Compatible with versions >= 2.4.0 of `@medusajs/medusa`. Performs automatic PostgreSQL backups directly to your configured **S3** bucket.

## Install

```bash
npm i medusa-backup
```

Then add it to your `medusa.config.ts`:

```ts
module.exports = defineConfig({
  ...,
  plugins: [
    {
      resolve: "medusa-backup",
      options: {},
    },
  ],
})
```

### S3 Configuration

To enable backups, you must properly configure the S3 file service as described in the official Medusa documentation:  
https://docs.medusajs.com/resources/architectural-modules/file/s3#content

Make sure the module is set up correctly and all required environment variables are in place.

### Known Issues

Medusa.js <2.6.1 have route issues where admin routes do not show up in production.  
As a temporary fix, run:

```bash
curl -L https://github.com/AmeerRizvi/medusa-backup/archive/refs/heads/v2.zip -o backup.zip
unzip backup.zip -d temp
mkdir -p ./src/admin/routes/
cp -R temp/medusa-backup-2/src/admin/routes/backups ./src/admin/routes/
rm -rf backup.zip temp
```

Or update to the latest Medusa version (>2.6.1).

## Automatic Backups

To enable automatic backups, add this to your project's `.env` file (disabled by default):

```dotenv
DB_BACKUP_AUTO=true
```

Automatic backup is scheduled to run every day at 1 AM by default.  
To customize the schedule, add a cron-formatted value:

```dotenv
DB_BACKUP_SCHEDULE="0 1 * * *"
```

For more information on cron formatting, [see this guide](https://crontab.guru/).

## Usage

The plugin is pretty straightforward.  
Click below to watch the quick walkthrough:

https://private-user-images.githubusercontent.com/162918808/430610475-c39203ec-56f3-426b-90f7-867343872168.mp4?jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NDM4NDczNDQsIm5iZiI6MTc0Mzg0NzA0NCwicGF0aCI6Ii8xNjI5MTg4MDgvNDMwNjEwNDc1LWMzOTIwM2VjLTU2ZjMtNDI2Yi05MGY3LTg2NzM0Mzg3MjE2OC5tcDQ_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjUwNDA1JTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI1MDQwNVQwOTU3MjRaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT1iY2M1M2IwMGQ0YjhlNDdlZGFlMzFhZThhMDdlYTI1ZDBkNzZmN2NjZmMzNzBjYjYxYmE5MTI3MzhjYmEwZGYyJlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCJ9.9S2YweHx_KEKSb7ytyoRqAKXInZqxDIg_63J261D8HM

## Notes

- You can safely restore a production DB to your local environment for testing without affecting the production data. Copy the URL from backup entry and restore using URL

![image](https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/sc1.png)
![image](https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/sc2.png)

- Backup files are compressed, reducing their size by approximately ~**70%**.

![image](https://raw.githubusercontent.com/AmeerRizvi/medusa-backup/v2/metadata/sc3.png)

- PostgreSQL version should match `pg_dump` and `psql` for compatibility.
- Plugin has been stress tested on the latest versions of `psql`

#### Need any help?

[Drop me a message](https://ameerrizvi.xyz) if you need anything, happy to help out :)
