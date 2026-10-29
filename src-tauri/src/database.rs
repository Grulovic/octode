use crate::{
    secrets::{resolve, SecretValue, Vault},
    ssh::{Session, Tunnel},
};
use base64::{prelude::BASE64_STANDARD, Engine};
use futures_util::TryStreamExt;
use serde::{Deserialize, Serialize};
use sqlx::{Column, Connection, Row, TypeInfo, ValueRef};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DatabaseConnection {
    pub id: String,
    pub name: String,
    pub engine: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: SecretValue,
    pub file: String,
    pub tls: String,
    pub read_only: bool,
    pub ssh_id: String,
}
#[derive(Deserialize)]
pub struct DatabaseDocument {
    #[allow(dead_code)]
    pub connections: Vec<DatabaseConnection>,
    #[allow(dead_code)]
    pub queries: Vec<serde_json::Value>,
}
pub struct DatabaseSession {
    cancel: CancellationToken,
    owner: String,
    config: DatabaseConnection,
    password: String,
    tunnel: Option<Tunnel>,
    ssh: Option<Arc<Session>>,
}
#[derive(Default)]
pub struct Databases(Mutex<HashMap<String, Arc<DatabaseSession>>>);
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbResult {
    pub columns: Vec<DbColumn>,
    pub rows: Vec<Vec<DbCell>>,
    pub rows_affected: u64,
    pub elapsed_ms: u128,
    pub truncated: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DbColumn {
    name: String,
    data_type: String,
}
#[derive(Serialize)]
pub struct DbCell {
    kind: &'static str,
    value: String,
}
impl DbCell {
    fn text(value: impl ToString) -> Self {
        let value = value.to_string();
        if value.len() > 65536 {
            Self {
                kind: "unsupported",
                value: "Value exceeds the 64 KB cell display limit".into(),
            }
        } else {
            Self {
                kind: "text",
                value,
            }
        }
    }
    fn binary(value: Vec<u8>) -> Self {
        if value.len() > 49152 {
            Self {
                kind: "unsupported",
                value: "Binary value exceeds the display limit".into(),
            }
        } else {
            Self {
                kind: "binary",
                value: BASE64_STANDARD.encode(value),
            }
        }
    }
    fn unsupported() -> Self {
        Self {
            kind: "unsupported",
            value: "Type is not supported for display".into(),
        }
    }
}
fn decode_metadata_text(cell: &mut DbCell) {
    if cell.kind == "binary" {
        if let Ok(bytes) = BASE64_STANDARD.decode(&cell.value) {
            if let Ok(text) = String::from_utf8(bytes) {
                *cell = DbCell::text(text);
            }
        }
    }
}
impl Databases {
    pub async fn connect(
        &self,
        owner: &str,
        project: &str,
        config: DatabaseConnection,
        ssh: Option<Arc<Session>>,
    ) -> Result<String, String> {
        if config.engine != "sqlite" && config.database.trim().is_empty() {
            return Err("Enter a database name before connecting".into());
        }
        let password = resolve(&config.password, project, &Vault)?;
        if config.engine != "sqlite" && config.host.trim().is_empty() {
            return Err("Enter a database host".into());
        }
        if ssh.is_some() && config.engine == "sqlite" {
            return Err(
                "SQLite uses a local file; SSH tunnels apply to MySQL and PostgreSQL".into(),
            );
        }
        if ssh.is_some() && config.tls == "verify" {
            return Err("Certificate hostname verification through SSH is not implemented yet. Choose SSH encryption only (TLS disabled), or TLS required, explicitly for this connection.".into());
        }
        let tunnel = match &ssh {
            Some(session) => Some(session.tunnel(config.host.clone(), config.port).await?),
            None => None,
        };
        let session = Arc::new(DatabaseSession {
            cancel: CancellationToken::new(),
            owner: owner.into(),
            config,
            password,
            tunnel,
            ssh,
        });
        session.query("SELECT 1 AS connected", 1).await?;
        let id = uuid::Uuid::new_v4().to_string();
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .insert(id.clone(), session);
        Ok(id)
    }
    pub fn get(&self, owner: &str, id: &str) -> Result<Arc<DatabaseSession>, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get(id)
            .filter(|s| s.owner == owner && !s.cancel.is_cancelled())
            .cloned()
            .ok_or("Database connection is closed".into())
    }
    pub fn close(&self, owner: &str, id: &str) {
        if let Ok(mut sessions) = self.0.lock() {
            if sessions.get(id).is_some_and(|s| s.owner == owner) {
                if let Some(session) = sessions.remove(id) {
                    session.cancel.cancel();
                }
            }
        }
    }
    pub fn close_window(&self, owner: &str) {
        if let Ok(mut sessions) = self.0.lock() {
            sessions.retain(|_, s| {
                if s.owner == owner {
                    s.cancel.cancel();
                    false
                } else {
                    true
                }
            });
        }
    }
}
macro_rules! cells {
    ($row:expr,$types:expr) => {{
        let row = $row;
        row.columns()
            .iter()
            .enumerate()
            .map(|(index, column)| {
                if row.try_get_raw(index).is_ok_and(|value| value.is_null()) {
                    return DbCell {
                        kind: "null",
                        value: String::new(),
                    };
                }
                let name = row
                    .try_get_raw(index)
                    .map(|value| value.type_info().name().to_ascii_uppercase())
                    .unwrap_or_else(|_| column.type_info().name().to_ascii_uppercase());
                $types(row, index, name.as_str())
            })
            .collect::<Vec<_>>()
    }};
}
fn sqlite_cell(row: &sqlx::sqlite::SqliteRow, i: usize, t: &str) -> DbCell {
    match t {
        "INTEGER" => row.try_get::<i64, _>(i).map(DbCell::text),
        "REAL" => row.try_get::<f64, _>(i).map(DbCell::text),
        "BLOB" => row.try_get::<Vec<u8>, _>(i).map(DbCell::binary),
        _ => row.try_get::<String, _>(i).map(DbCell::text),
    }
    .unwrap_or_else(|_| DbCell::unsupported())
}
fn pg_cell(row: &sqlx::postgres::PgRow, i: usize, t: &str) -> DbCell {
    match t {
        "UUID" => row.try_get::<sqlx::types::Uuid, _>(i).map(DbCell::text),
        "INT2" => row.try_get::<i16, _>(i).map(DbCell::text),
        "INT4" => row.try_get::<i32, _>(i).map(DbCell::text),
        "INT8" => row.try_get::<i64, _>(i).map(DbCell::text),
        "FLOAT4" => row.try_get::<f32, _>(i).map(DbCell::text),
        "FLOAT8" => row.try_get::<f64, _>(i).map(DbCell::text),
        "BOOL" => row.try_get::<bool, _>(i).map(DbCell::text),
        "BYTEA" => row.try_get::<Vec<u8>, _>(i).map(DbCell::binary),
        "NUMERIC" => row.try_get::<sqlx::types::Decimal, _>(i).map(DbCell::text),
        "JSON" | "JSONB" => row
            .try_get::<sqlx::types::Json<Box<serde_json::value::RawValue>>, _>(i)
            .map(json_cell),
        "DATE" => row
            .try_get::<sqlx::types::chrono::NaiveDate, _>(i)
            .map(DbCell::text),
        "TIME" => row
            .try_get::<sqlx::types::chrono::NaiveTime, _>(i)
            .map(DbCell::text),
        "TIMESTAMP" => row
            .try_get::<sqlx::types::chrono::NaiveDateTime, _>(i)
            .map(DbCell::text),
        "TIMESTAMPTZ" => row
            .try_get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, _>(i)
            .map(DbCell::text),
        _ => row.try_get::<String, _>(i).map(DbCell::text),
    }
    .unwrap_or_else(|_| DbCell::unsupported())
}
fn json_cell(value: sqlx::types::Json<Box<serde_json::value::RawValue>>) -> DbCell {
    // Preserve numbers, escapes and duplicate keys exactly as returned by the server.
    DbCell::text(value.0.get())
}
fn mysql_timestamp_cell(value: sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>) -> DbCell {
    DbCell::text(value.naive_utc())
}
fn mysql_cell(row: &sqlx::mysql::MySqlRow, i: usize, t: &str) -> DbCell {
    match t {
        // BOOLEAN is TINYINT(1); retain its exact stored integer (including 2/-1),
        // rather than turning every nonzero value into the SQL string true.
        "BOOLEAN" | "BOOL" => row
            .try_get::<i64, _>(i)
            .map(DbCell::text)
            .or_else(|_| row.try_get::<u64, _>(i).map(DbCell::text)),
        "TINYINT" => row.try_get::<i8, _>(i).map(DbCell::text),
        "SMALLINT" => row.try_get::<i16, _>(i).map(DbCell::text),
        "INT" | "MEDIUMINT" => row.try_get::<i32, _>(i).map(DbCell::text),
        "BIGINT" => row.try_get::<i64, _>(i).map(DbCell::text),
        "TINYINT UNSIGNED" | "SMALLINT UNSIGNED" | "INT UNSIGNED" | "MEDIUMINT UNSIGNED"
        | "BIGINT UNSIGNED" => row.try_get::<u64, _>(i).map(DbCell::text),
        "FLOAT" => row.try_get::<f32, _>(i).map(DbCell::text),
        "DOUBLE" => row.try_get::<f64, _>(i).map(DbCell::text),
        "DECIMAL" => row.try_get::<sqlx::types::Decimal, _>(i).map(DbCell::text),
        "BINARY" | "VARBINARY" | "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BIT" => {
            row.try_get::<Vec<u8>, _>(i).map(DbCell::binary)
        }
        "JSON" => row
            .try_get::<sqlx::types::Json<Box<serde_json::value::RawValue>>, _>(i)
            .map(json_cell),
        "DATE" => row
            .try_get::<sqlx::types::chrono::NaiveDate, _>(i)
            .map(DbCell::text),
        "TIME" => row
            .try_get::<sqlx::types::chrono::NaiveTime, _>(i)
            .map(DbCell::text),
        "DATETIME" => row
            .try_get::<sqlx::types::chrono::NaiveDateTime, _>(i)
            .map(DbCell::text),
        // SQLx's NaiveDateTime type check only accepts DATETIME. Its UTC
        // DateTime decoder accepts TIMESTAMP and wraps the server's fields;
        // naive_utc returns those same fields without a display-time conversion.
        "TIMESTAMP" => row
            .try_get::<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>, _>(i)
            .map(mysql_timestamp_cell),
        _ => row.try_get::<String, _>(i).map(DbCell::text),
    }
    .unwrap_or_else(|_| DbCell::unsupported())
}
macro_rules! run_query {
    ($conn:expr,$sql:expr,$limit:expr,$decode:ident) => {{
        let started = Instant::now();
        let mut connection = $conn;
        let mut result = DbResult {
            columns: Vec::new(),
            rows: Vec::new(),
            rows_affected: 0,
            elapsed_ms: 0,
            truncated: false,
        };
        {
            #[allow(deprecated)]
            let mut stream = sqlx::query($sql).fetch_many(&mut connection);
            let mut total = 0usize;
            while let Some(item) = stream.try_next().await.map_err(db_error)? {
                match item {
                    sqlx::Either::Left(done) => result.rows_affected += done.rows_affected(),
                    sqlx::Either::Right(row) => {
                        if result.columns.is_empty() {
                            result.columns = row
                                .columns()
                                .iter()
                                .enumerate()
                                .map(|(index, column)| DbColumn {
                                    name: column.name().into(),
                                    data_type: if column.type_info().name() == "NULL" {
                                        row.try_get_raw(index)
                                            .map(|value| value.type_info().name().to_string())
                                            .unwrap_or_else(|_| "UNKNOWN".into())
                                    } else {
                                        column.type_info().name().into()
                                    },
                                })
                                .collect();
                        }
                        if result.rows.len() >= $limit
                            || (result.rows.len() + 1) * row.columns().len() > 20000
                        {
                            result.truncated = true;
                            break;
                        }
                        let cells = cells!(&row, $decode);
                        total += cells.iter().map(|c| c.value.len()).sum::<usize>();
                        if total > 8 * 1024 * 1024 {
                            result.truncated = true;
                            break;
                        }
                        result.rows.push(cells);
                    }
                }
            }
        }
        // Every operation uses its own connection. Dropping a cancelled future closes it.
        let _ = connection.close().await;
        result.elapsed_ms = started.elapsed().as_millis();
        Ok(result)
    }};
}
fn db_error(error: sqlx::Error) -> String {
    match error {
        sqlx::Error::Database(error) => format!("Database error: {}", error.message()),
        _ => "Database connection or query failed; check the settings, TLS mode, and SQL".into(),
    }
}
impl DatabaseSession {
    pub async fn query(&self, sql: &str, limit: usize) -> Result<DbResult, String> {
        if self.cancel.is_cancelled() {
            return Err("Database connection closed".into());
        }
        if sql.len() > 1024 * 1024 || sql.trim().is_empty() {
            return Err("Enter SQL (up to 1 MB)".into());
        }
        if self
            .ssh
            .as_ref()
            .is_some_and(|session| session.cancel.is_cancelled())
        {
            return Err("The SSH connection has closed".into());
        }
        let future = async {
            match self.open().await? {
                DbConnection::Sqlite(connection) => {
                    run_query!(connection, sql, limit, sqlite_cell)
                }
                DbConnection::Postgres(connection) => {
                    run_query!(connection, sql, limit, pg_cell)
                }
                DbConnection::Mysql(connection) => {
                    run_query!(connection, sql, limit, mysql_cell)
                }
            }
        };
        tokio::select! {_=self.cancel.cancelled()=>Err("Database connection closed. Verify the outcome before retrying a write.".into()),result=tokio::time::timeout(Duration::from_secs(60),future)=>result.map_err(|_|"Database operation timed out. The connection was dropped; verify the outcome before retrying a write.".to_string())?}
    }
    async fn open(&self) -> Result<DbConnection, String> {
        if self.cancel.is_cancelled()
            || self
                .ssh
                .as_ref()
                .is_some_and(|ssh| ssh.cancel.is_cancelled() || ssh.handle.is_closed())
        {
            return Err("Database connection or SSH tunnel is closed".into());
        }
        let host = if self.tunnel.is_some() {
            "127.0.0.1"
        } else {
            &self.config.host
        };
        let port = self.tunnel.as_ref().map_or(self.config.port, |t| t.port);
        match self.config.engine.as_str() {
            "sqlite" => {
                let options = sqlx::sqlite::SqliteConnectOptions::new()
                    .filename(&self.config.file)
                    .read_only(self.config.read_only)
                    .create_if_missing(false)
                    .busy_timeout(Duration::from_secs(10));
                Ok(DbConnection::Sqlite(
                    sqlx::SqliteConnection::connect_with(&options)
                        .await
                        .map_err(db_error)?,
                ))
            }
            "postgres" => {
                let mode = match self.config.tls.as_str() {
                    "verify" => sqlx::postgres::PgSslMode::VerifyFull,
                    "require" => sqlx::postgres::PgSslMode::Require,
                    "disable" => sqlx::postgres::PgSslMode::Disable,
                    _ => return Err("Invalid TLS mode".into()),
                };
                let mut options = sqlx::postgres::PgConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(&self.config.username)
                    .password(&self.password)
                    .database(&self.config.database)
                    .ssl_mode(mode);
                if self.config.read_only {
                    options = options.options([("default_transaction_read_only", "on")]);
                }
                Ok(DbConnection::Postgres(
                    sqlx::PgConnection::connect_with(&options)
                        .await
                        .map_err(db_error)?,
                ))
            }
            "mysql" => {
                let mode = match self.config.tls.as_str() {
                    "verify" => sqlx::mysql::MySqlSslMode::VerifyIdentity,
                    "require" => sqlx::mysql::MySqlSslMode::Required,
                    "disable" => sqlx::mysql::MySqlSslMode::Disabled,
                    _ => return Err("Invalid TLS mode".into()),
                };
                let options = sqlx::mysql::MySqlConnectOptions::new()
                    .host(host)
                    .port(port)
                    .username(&self.config.username)
                    .password(&self.password)
                    .database(&self.config.database)
                    .ssl_mode(mode);
                let mut connection = sqlx::MySqlConnection::connect_with(&options)
                    .await
                    .map_err(db_error)?;
                if self.config.read_only {
                    sqlx::query("SET SESSION TRANSACTION READ ONLY")
                        .execute(&mut connection)
                        .await
                        .map_err(db_error)?;
                }
                Ok(DbConnection::Mysql(connection))
            }
            _ => Err("Unsupported database engine".into()),
        }
    }
    pub(super) async fn metadata_query(&self, sql: &str, limit: usize) -> Result<DbResult, String> {
        let mut result = self.query(sql, limit).await?;
        if self.config.engine == "mysql" {
            for row in &mut result.rows {
                for cell in row {
                    decode_metadata_text(cell);
                }
            }
        }
        Ok(result)
    }
    pub async fn tables(&self) -> Result<DbResult, String> {
        let sql=match self.config.engine.as_str(){"sqlite"=>"SELECT 'main' AS schema, name FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name","postgres"=>"SELECT table_schema AS schema, table_name AS name FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY table_schema,table_name",_=>"SELECT CAST(table_schema AS CHAR CHARACTER SET utf8mb4) AS `schema`, CAST(table_name AS CHAR CHARACTER SET utf8mb4) AS name FROM information_schema.tables WHERE table_schema = DATABASE() ORDER BY table_name"};
        self.metadata_query(sql, 10000).await
    }
    pub async fn browse(
        &self,
        schema: &str,
        table: &str,
        filter: &str,
        sort: &str,
        descending: bool,
        page: u32,
    ) -> Result<DbResult, String> {
        let tables = self.tables().await?;
        if !tables.rows.iter().any(|row| {
            row.first().is_some_and(|cell| cell.value == schema)
                && row.get(1).is_some_and(|cell| cell.value == table)
        }) {
            return Err("Select a table from this database".into());
        }
        // The filter is a single SQL expression, never a second statement.
        let filter = normalized_filter(filter)?;
        let quote = if self.config.engine == "mysql" {
            '`'
        } else {
            '"'
        };
        let identifier = |name: &str| quote_identifier(name, quote);
        let name = format!("{}.{}", identifier(schema), identifier(table));
        let mut sql = format!("SELECT * FROM {name}");
        if !filter.trim().is_empty() {
            sql.push_str(&format!(" WHERE ({filter})"));
        }
        if !sort.is_empty() {
            sql.push_str(&format!(
                " ORDER BY {} {}",
                identifier(sort),
                if descending { "DESC" } else { "ASC" }
            ));
        }
        sql.push_str(&format!(
            " LIMIT 201 OFFSET {}",
            u64::from(page.min(1_000_000)) * 200
        ));
        self.query(&sql, 200).await
    }
}
fn quote_identifier(name: &str, quote: char) -> String {
    format!(
        "{quote}{}{quote}",
        name.replace(quote, &format!("{quote}{quote}"))
    )
}
fn normalized_filter(filter: &str) -> Result<&str, String> {
    validate_filter(filter)?;
    let expression = filter.trim();
    if expression
        .get(..5)
        .is_some_and(|prefix| prefix.eq_ignore_ascii_case("where"))
    {
        let remainder = &expression[5..];
        if remainder.is_empty()
            || remainder.starts_with(char::is_whitespace)
            || remainder.starts_with('(')
        {
            let remainder = remainder.trim();
            if remainder.is_empty() {
                return Err("Enter a condition after WHERE, for example id = 417".into());
            }
            return Ok(remainder);
        }
    }
    Ok(expression)
}
fn validate_filter(filter: &str) -> Result<(), String> {
    if filter.len() > 8192 {
        return Err("The WHERE expression is too long".into());
    }
    // Reject comments and statement separators, including inside strings, to keep the quick filter predictable.
    let mut depth = 0i32;
    let mut quote = None;
    let mut chars = filter.chars().peekable();
    while let Some(character) = chars.next() {
        if let Some(current) = quote {
            if character == current {
                if chars.peek() == Some(&current) {
                    chars.next();
                } else {
                    quote = None;
                }
            }
        } else {
            match character {
                '\'' | '"' | '`' => quote = Some(character),
                '(' => depth += 1,
                ')' => {
                    depth -= 1;
                    if depth < 0 {
                        return Err("Unbalanced WHERE expression".into());
                    }
                }
                _ => {}
            }
        }
    }
    if depth != 0 || quote.is_some() {
        return Err("Unbalanced WHERE expression".into());
    }
    if [";", "--", "/*", "*/", "#"]
        .iter()
        .any(|token| filter.contains(token))
    {
        return Err("Use a single WHERE expression without comments or semicolons".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    #[test]
    fn database_json_snapshots_preserve_exact_numeric_and_string_tokens() {
        for source in [
            r#"{"id":9007199254740993,"amount":1.2300,"a":1,"a":2}"#,
            r#""quoted \" string""#,
            "null",
            "true",
            "1e+40",
        ] {
            let raw = serde_json::value::RawValue::from_string(source.into()).unwrap();
            let cell = json_cell(sqlx::types::Json(raw));
            assert_eq!(cell.kind, "text");
            assert_eq!(cell.value, source);
        }
    }
    #[test]
    fn mysql_boolean_snapshot_decoders_cover_both_integer_signedness() {
        use sqlx::{MySql, Type};
        let unsigned = <bool as Type<MySql>>::type_info();
        assert!(<u64 as Type<MySql>>::compatible(&unsigned));
        assert!(!<i64 as Type<MySql>>::compatible(&unsigned));
        let signed = <i8 as Type<MySql>>::type_info();
        assert!(<i64 as Type<MySql>>::compatible(&signed));
        assert!(!<u64 as Type<MySql>>::compatible(&signed));
    }
    #[test]
    fn mysql_timestamp_uses_a_compatible_type_and_preserves_server_fields() {
        use sqlx::{
            types::chrono::{DateTime, NaiveDateTime, Utc},
            MySql, Type,
        };
        let timestamp = <DateTime<Utc> as Type<MySql>>::type_info();
        // Reproduce the checked decoder mismatch responsible for unsupported cells.
        assert!(!<NaiveDateTime as Type<MySql>>::compatible(&timestamp));
        assert!(<DateTime<Utc> as Type<MySql>>::compatible(&timestamp));
        for (source, expected) in [
            ("2026-10-28T11:28:29Z", "2026-10-28 11:28:29"),
            ("2026-10-28T11:28:29.123456Z", "2026-10-28 11:28:29.123456"),
            ("1970-01-01T00:00:01Z", "1970-01-01 00:00:01"),
        ] {
            let value = source.parse::<DateTime<Utc>>().unwrap();
            let cell = mysql_timestamp_cell(value);
            assert_eq!(cell.kind, "text");
            assert_eq!(cell.value, expected);
        }
    }
    #[test]
    fn mysql_metadata_names_decode_utf8_binary_values_without_corrupting_binary_data() {
        let mut name = super::DbCell::binary("članovi".as_bytes().to_vec());
        super::decode_metadata_text(&mut name);
        assert_eq!(name.kind, "text");
        assert_eq!(name.value, "članovi");
        let mut blob = super::DbCell::binary(vec![0xff, 0xfe]);
        let original = blob.value.clone();
        super::decode_metadata_text(&mut blob);
        assert_eq!(blob.kind, "binary");
        assert_eq!(blob.value, original);
    }
    use super::*;
    #[test]
    fn identifiers_escape_and_filters_cannot_append_statements() {
        assert_eq!(quote_identifier("odd\"table", '"'), "\"odd\"\"table\"");
        assert!(validate_filter("id=1; DROP TABLE users").is_err());
        assert!(validate_filter("id >= 5 AND name LIKE 'a%'").is_ok());
    }
    #[test]
    fn quick_filters_accept_optional_where_without_changing_identifiers_or_literals() {
        for value in [
            "id = 417",
            " WHERE id = 417 ",
            "where id = 417",
            "WhErE\nid = 417",
        ] {
            assert_eq!(normalized_filter(value).unwrap(), "id = 417");
        }
        assert_eq!(normalized_filter("WHERE(id = 417)").unwrap(), "(id = 417)");
        assert_eq!(
            normalized_filter("where_name = 'where id = 417'").unwrap(),
            "where_name = 'where id = 417'"
        );
        assert_eq!(normalized_filter("  ").unwrap(), "");
        for value in [
            "WHERE",
            "where  ",
            "WHERE id=1; DROP TABLE things",
            "WHERE id=1 -- comment",
            "WHERE (id=1",
        ] {
            assert!(normalized_filter(value).is_err());
        }
    }
    #[tokio::test]
    async fn remote_connections_require_database_before_accessing_credentials() {
        for engine in ["mysql", "postgres"] {
            let config: DatabaseConnection = serde_json::from_value(serde_json::json!({
                "id": "test", "name": "Test", "engine": engine, "host": "127.0.0.1",
                "port": 0, "database": "  ", "username": "test", "file": "",
                "password": {"id": "invalid", "hasSecret": true},
                "tls": "verify", "readOnly": true, "sshId": ""
            }))
            .unwrap();
            let error = Databases::default()
                .connect("main", "test", config, None)
                .await
                .unwrap_err();
            assert!(error.contains("Enter a database name"));
        }
    }
    #[tokio::test]
    async fn sqlite_preserves_values_pages_and_read_only() {
        let path = std::env::temp_dir().join(format!("octode-db-{}.sqlite", uuid::Uuid::new_v4()));
        let conn = rusqlite::Connection::open(&path).unwrap();
        conn.execute_batch("CREATE TABLE things (id INTEGER PRIMARY KEY, value TEXT, empty TEXT, bytes BLOB); INSERT INTO things VALUES(9007199254740993,'hello',NULL,x'0001');").unwrap();
        drop(conn);
        let config = DatabaseConnection {
            id: "test".into(),
            name: "Test".into(),
            engine: "sqlite".into(),
            host: String::new(),
            port: 0,
            database: String::new(),
            username: String::new(),
            password: SecretValue::default(),
            file: path.to_string_lossy().into(),
            tls: "verify".into(),
            read_only: true,
            ssh_id: String::new(),
        };
        let session = DatabaseSession {
            cancel: CancellationToken::new(),
            owner: "main".into(),
            config,
            password: String::new(),
            tunnel: None,
            ssh: None,
        };
        let result = session
            .browse("main", "things", "", "id", false, 0)
            .await
            .unwrap();
        assert_eq!(result.rows[0][0].value, "9007199254740993");
        assert_eq!(result.rows[0][2].kind, "null");
        assert_eq!(result.rows[0][3].value, "AAE=");
        for filter in [
            "id = 9007199254740993",
            "WHERE id = 9007199254740993",
            "where (id = 9007199254740993)",
        ] {
            let filtered = session
                .browse("main", "things", filter, "id", false, 0)
                .await
                .unwrap();
            assert_eq!(filtered.rows.len(), 1);
            assert_eq!(filtered.rows[0][0].value, "9007199254740993");
        }
        assert!(session
            .browse("main", "things", "WHERE id = 0", "id", false, 0)
            .await
            .unwrap()
            .rows
            .is_empty());
        let computed = session
            .query(
                "SELECT 9007199254740993 AS exact_id, COUNT(*) AS count FROM things",
                100,
            )
            .await
            .unwrap();
        assert_eq!(computed.rows[0][0].value, "9007199254740993");
        assert_eq!(computed.rows[0][1].value, "1");
        assert_eq!(computed.columns[0].data_type, "INTEGER");
        assert!(session.query("DELETE FROM things", 100).await.is_err());
        assert!(session
            .browse("main", "missing", "", "", false, 0)
            .await
            .is_err());
        session.cancel.cancel();
        assert!(session
            .query("SELECT 1", 100)
            .await
            .err()
            .unwrap()
            .contains("closed"));
        std::fs::remove_file(path).unwrap();
    }
}

enum DbConnection {
    Sqlite(sqlx::SqliteConnection),
    Postgres(sqlx::PgConnection),
    Mysql(sqlx::MySqlConnection),
}
#[path = "database_edit.rs"]
mod editing;
pub use editing::{RowChange, RowPlan, TableMetadata};
