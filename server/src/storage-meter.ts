/** SQLite keeps byte totals with each write; quota checks never scan stored payloads. */
export function initializeMeter(sql:any){
 const exists=sql.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='storage_usage'").toArray().length;
 sql.exec(`CREATE TABLE IF NOT EXISTS storage_usage(owner TEXT PRIMARY KEY,record_bytes INTEGER NOT NULL,artifact_bytes INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS binary_usage(id INTEGER PRIMARY KEY,bytes INTEGER NOT NULL);`);
 if(!exists)sql.exec(`INSERT INTO storage_usage SELECT COALESCE(json_extract(data,'$.owner'),''),SUM(length(CAST(data AS BLOB))),SUM(CASE WHEN type IN ('build','release') THEN COALESCE(CAST(json_extract(data,'$.byte_length') AS INTEGER),0) ELSE 0 END) FROM records GROUP BY COALESCE(json_extract(data,'$.owner'),'');
 INSERT INTO binary_usage SELECT 1,COALESCE(SUM(length(data)),0) FROM blobs;`);
 sql.exec(`
 CREATE TRIGGER IF NOT EXISTS usage_insert AFTER INSERT ON records BEGIN
 INSERT INTO storage_usage VALUES(COALESCE(json_extract(NEW.data,'$.owner'),''),length(CAST(NEW.data AS BLOB)),CASE WHEN NEW.type IN ('build','release') THEN COALESCE(CAST(json_extract(NEW.data,'$.byte_length') AS INTEGER),0) ELSE 0 END)
 ON CONFLICT(owner) DO UPDATE SET record_bytes=record_bytes+excluded.record_bytes,artifact_bytes=artifact_bytes+excluded.artifact_bytes; END;
 CREATE TRIGGER IF NOT EXISTS usage_delete AFTER DELETE ON records BEGIN
 UPDATE storage_usage SET record_bytes=record_bytes-length(CAST(OLD.data AS BLOB)),artifact_bytes=artifact_bytes-CASE WHEN OLD.type IN ('build','release') THEN COALESCE(CAST(json_extract(OLD.data,'$.byte_length') AS INTEGER),0) ELSE 0 END WHERE owner=COALESCE(json_extract(OLD.data,'$.owner'),''); END;
 CREATE TRIGGER IF NOT EXISTS usage_update AFTER UPDATE ON records BEGIN
 UPDATE storage_usage SET record_bytes=record_bytes-length(CAST(OLD.data AS BLOB)),artifact_bytes=artifact_bytes-CASE WHEN OLD.type IN ('build','release') THEN COALESCE(CAST(json_extract(OLD.data,'$.byte_length') AS INTEGER),0) ELSE 0 END WHERE owner=COALESCE(json_extract(OLD.data,'$.owner'),'');
 INSERT INTO storage_usage VALUES(COALESCE(json_extract(NEW.data,'$.owner'),''),length(CAST(NEW.data AS BLOB)),CASE WHEN NEW.type IN ('build','release') THEN COALESCE(CAST(json_extract(NEW.data,'$.byte_length') AS INTEGER),0) ELSE 0 END)
 ON CONFLICT(owner) DO UPDATE SET record_bytes=record_bytes+excluded.record_bytes,artifact_bytes=artifact_bytes+excluded.artifact_bytes; END;
 CREATE TRIGGER IF NOT EXISTS binary_insert AFTER INSERT ON blobs BEGIN UPDATE binary_usage SET bytes=bytes+length(NEW.data) WHERE id=1; END;
 CREATE TRIGGER IF NOT EXISTS binary_delete AFTER DELETE ON blobs BEGIN UPDATE binary_usage SET bytes=bytes-length(OLD.data) WHERE id=1; END;
 CREATE TRIGGER IF NOT EXISTS binary_update AFTER UPDATE ON blobs BEGIN UPDATE binary_usage SET bytes=bytes+length(NEW.data)-length(OLD.data) WHERE id=1; END;`);
}
