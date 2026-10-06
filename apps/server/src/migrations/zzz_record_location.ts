import { sql, type Kysely } from "kysely";

/** Adds map coordinates for existing deployments that have already run the baseline schema migration. */
export async function up(db: Kysely<any>) {
  await sql`
    ALTER TABLE records
      ADD COLUMN IF NOT EXISTS location_latitude DOUBLE PRECISION,
      ADD COLUMN IF NOT EXISTS location_longitude DOUBLE PRECISION;

    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_location_coordinates_together') THEN
        ALTER TABLE records
          ADD CONSTRAINT records_location_coordinates_together
          CHECK ((location_latitude IS NULL) = (location_longitude IS NULL));
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_location_latitude_range') THEN
        ALTER TABLE records
          ADD CONSTRAINT records_location_latitude_range
          CHECK (location_latitude IS NULL OR location_latitude BETWEEN -90 AND 90);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'records_location_longitude_range') THEN
        ALTER TABLE records
          ADD CONSTRAINT records_location_longitude_range
          CHECK (location_longitude IS NULL OR location_longitude BETWEEN -180 AND 180);
      END IF;
    END $$;

    CREATE INDEX IF NOT EXISTS idx_records_map_lat
      ON records(user_id, location_latitude) WHERE location_latitude IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_records_map_lon
      ON records(user_id, location_longitude) WHERE location_longitude IS NOT NULL;
  `.execute(db);
}

export async function down(db: Kysely<any>) {
  await sql`
    DROP INDEX IF EXISTS idx_records_map_lon;
    DROP INDEX IF EXISTS idx_records_map_lat;
    ALTER TABLE records
      DROP CONSTRAINT IF EXISTS records_location_longitude_range,
      DROP CONSTRAINT IF EXISTS records_location_latitude_range,
      DROP CONSTRAINT IF EXISTS records_location_coordinates_together,
      DROP COLUMN IF EXISTS location_longitude,
      DROP COLUMN IF EXISTS location_latitude;
  `.execute(db);
}
