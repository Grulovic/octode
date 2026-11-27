use super::*;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use tauri::ipc::Channel;
use tokio::io::{AsyncWriteExt, BufWriter};

#[path = "database_transfer_parse.rs"]
mod parse;

#[derive(Clone, Deserialize)]
pub struct TransferTable {
    pub schema: String,
    pub name: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportRequest {
    pub tables: Vec<TransferTable>,
    pub path: String,
    pub format: String,
    pub headers: bool,
    pub operation_id: String,
}
#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferProgress {
    pub phase: String,
    pub rows: u64,
    pub bytes: u64,
    pub total_bytes: Option<u64>,
    pub table: String,
}
#[derive(Debug, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TransferSummary {
    pub rows: u64,
    pub bytes: u64,
    pub tables: usize,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPreview {
    pub token: String,
    pub name: String,
    pub bytes: u64,
    pub preview: String,
    pub truncated: bool,
    pub rows: u64,
    pub statements: u64,
    pub headers: Vec<String>,
    pub sample: Vec<Vec<String>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportRequest {
    pub token: String,
    pub operation_id: String,
    pub table: Option<TransferTable>,
    pub mapping: Option<Vec<String>>,
    pub empty_null: Option<bool>,
}
struct Temporary {
    path: PathBuf,
}
impl Drop for Temporary {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}
fn temporary(parent: &Path) -> Result<(Temporary, File), String> {
    let path = parent.join(format!(".octode-transfer-{}", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options.open(&path).map_err(|e| e.to_string())?;
    Ok((Temporary { path }, file))
}
struct Prepared {
    owner: String,
    session: String,
    format: String,
    temp: Temporary,
    bytes: u64,
    headers: Vec<String>,
}
#[derive(Clone, Default)]
pub struct PreparedImports(Arc<Mutex<HashMap<String, Arc<Prepared>>>>);
impl PreparedImports {
    pub fn release(&self, owner: &str, token: &str) {
        if let Ok(mut files) = self.0.lock() {
            if files.get(token).is_some_and(|p| p.owner == owner) {
                files.remove(token);
            }
        }
    }
    pub fn close_session(&self, owner: &str, session: &str) {
        if let Ok(mut files) = self.0.lock() {
            files.retain(|_, p| p.owner != owner || p.session != session);
        }
    }
    pub fn close_window(&self, owner: &str) {
        if let Ok(mut files) = self.0.lock() {
            files.retain(|_, p| p.owner != owner);
        }
    }
    fn get(&self, owner: &str, session: &str, token: &str) -> Result<Arc<Prepared>, String> {
        self.0
            .lock()
            .map_err(|e| e.to_string())?
            .get(token)
            .filter(|p| p.owner == owner && p.session == session)
            .cloned()
            .ok_or_else(|| "Choose and review the import file again".into())
    }
    pub fn prepare(
        &self,
        owner: String,
        session: String,
        path: String,
        format: String,
        engine: String,
        cancel: CancellationToken,
        closed: CancellationToken,
        progress: Channel<TransferProgress>,
    ) -> Result<ImportPreview, String> {
        if !["sql", "csv"].contains(&format.as_str()) {
            return Err("Choose SQL or CSV import".into());
        }
        let mut source = File::open(&path).map_err(|e| e.to_string())?;
        if !source.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Choose a regular import file".into());
        }
        let total = source.metadata().map_err(|e| e.to_string())?.len();
        let (temp, mut spool) = temporary(&std::env::temp_dir())?;
        let mut buffer = [0u8; 64 * 1024];
        let mut preview = Vec::new();
        let mut bytes = 0;
        let mut tick = Instant::now();
        loop {
            if cancel.is_cancelled() || closed.is_cancelled() {
                return Err("File preparation cancelled".into());
            }
            let count = source.read(&mut buffer).map_err(|e| e.to_string())?;
            if count == 0 {
                break;
            }
            spool
                .write_all(&buffer[..count])
                .map_err(|e| e.to_string())?;
            if preview.len() < 64 * 1024 {
                preview.extend_from_slice(&buffer[..count.min(64 * 1024 - preview.len())]);
            }
            bytes += count as u64;
            if tick.elapsed() >= Duration::from_millis(100) {
                let _ = progress.send(TransferProgress {
                    phase: "Preparing file".into(),
                    bytes,
                    total_bytes: Some(total),
                    ..Default::default()
                });
                tick = Instant::now();
            }
        }
        drop(spool);
        if bytes == 0 {
            return Err("The selected import file is empty".into());
        }
        let mut headers = Vec::new();
        let mut sample = Vec::new();
        let mut rows = 0;
        let mut statements = 0;
        parse::parse(
            File::open(&temp.path).map_err(|e| e.to_string())?,
            &format,
            &engine,
            cancel.clone(),
            |record| {
                if closed.is_cancelled() {
                    return Err("Database connection closed".into());
                }
                let position = match record {
                    parse::Record::Sql(_, position) => {
                        statements += 1;
                        position
                    }
                    parse::Record::Csv(row, position) => {
                        if headers.is_empty() {
                            headers = row;
                        } else {
                            rows += 1;
                            if sample.len() < 5 {
                                sample.push(
                                    row.into_iter()
                                        .map(|v| v.chars().take(200).collect())
                                        .collect(),
                                );
                            }
                        }
                        position
                    }
                };
                if tick.elapsed() >= Duration::from_millis(100) {
                    let _ = progress.send(TransferProgress {
                        phase: "Reviewing file".into(),
                        bytes: position,
                        total_bytes: Some(bytes),
                        rows,
                        ..Default::default()
                    });
                    tick = Instant::now();
                }
                Ok(())
            },
        )?;
        if format == "csv" && rows == 0 {
            return Err("CSV needs a header and at least one data row".into());
        }
        if format == "sql" && statements == 0 {
            return Err("The selected SQL file contains no statements".into());
        }
        let token = uuid::Uuid::new_v4().to_string();
        let result = ImportPreview {
            token: token.clone(),
            name: Path::new(&path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into(),
            bytes,
            preview: String::from_utf8_lossy(&preview).into(),
            truncated: bytes > preview.len() as u64,
            rows,
            statements,
            headers: headers.clone(),
            sample,
        };
        if cancel.is_cancelled() || closed.is_cancelled() {
            return Err("File preparation cancelled".into());
        }
        self.0.lock().map_err(|e| e.to_string())?.insert(
            token,
            Arc::new(Prepared {
                owner,
                session,
                format,
                temp,
                bytes,
                headers,
            }),
        );
        Ok(result)
    }
}
fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push(DIGITS[(b >> 4) as usize] as char);
        out.push(DIGITS[(b & 15) as usize] as char);
    }
    out
}
fn sql_value(cell: &DbCell, engine: &str) -> Result<String, String> {
    Ok(match cell.kind {
        "null" => "NULL".into(),
        "unsupported" => {
            return Err(
                "A column type cannot be exported without losing data. No partial file was saved."
                    .into(),
            )
        }
        "boolean" => {
            if cell.value == "true" {
                "TRUE".into()
            } else {
                "FALSE".into()
            }
        }
        "number" if cell.value.parse::<f64>().is_ok_and(|n| n.is_finite()) => cell.value.clone(),
        "binary" => {
            let data = hex(&BASE64_STANDARD
                .decode(&cell.value)
                .map_err(|e| e.to_string())?);
            if engine == "postgres" {
                format!("decode('{data}', 'hex')")
            } else {
                format!("X'{data}'")
            }
        }
        _ => {
            let data = hex(cell.value.as_bytes());
            match engine {
                "sqlite" => format!("CAST(X'{data}' AS TEXT)"),
                "mysql" => format!("CONVERT(X'{data}' USING utf8mb4)"),
                _ => {
                    let mut tag = "$octode$".to_string();
                    while cell.value.contains(&tag) {
                        tag.insert(tag.len() - 1, '_');
                    }
                    format!("{tag}{}{tag}", cell.value)
                }
            }
        }
    })
}
fn csv_field(value: &str) -> String {
    if value.is_empty() || value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.into()
    }
}
fn csv_line(values: impl Iterator<Item = String>) -> String {
    values.map(|s| csv_field(&s)).collect::<Vec<_>>().join(",") + "\r\n"
}
fn export_columns_sql(engine: &str, table: &TransferTable) -> Result<String, String> {
    let literal = |value: &str| {
        sql_value(
            &DbCell {
                kind: "text",
                value: value.into(),
            },
            engine,
        )
    };
    let schema = literal(&table.schema)?;
    let name = literal(&table.name)?;
    Ok(match engine {
        "sqlite" => format!("SELECT name, type, hidden FROM pragma_table_xinfo({name}, {schema}) ORDER BY cid"),
        "postgres" => format!("SELECT column_name, data_type, CASE WHEN is_generated='ALWAYS' THEN 1 ELSE 0 END FROM information_schema.columns WHERE table_schema={schema} AND table_name={name} ORDER BY ordinal_position"),
        _ => format!("SELECT CAST(COLUMN_NAME AS CHAR CHARACTER SET utf8mb4), CAST(DATA_TYPE AS CHAR CHARACTER SET utf8mb4), CASE WHEN EXTRA LIKE '%VIRTUAL GENERATED%' OR EXTRA LIKE '%STORED GENERATED%' THEN 1 ELSE 0 END FROM information_schema.columns WHERE TABLE_SCHEMA={schema} AND TABLE_NAME={name} ORDER BY ORDINAL_POSITION"),
    })
}
fn export_columns(rows: Vec<Vec<DbCell>>) -> Result<Vec<DbColumn>, String> {
    let mut columns = Vec::new();
    for mut row in rows {
        for cell in &mut row {
            decode_metadata_text(cell);
        }
        if row.len() != 3 || row.iter().any(|c| matches!(c.kind, "unsupported" | "null")) {
            return Err("Could not read complete export column metadata".into());
        }
        if row[2].value != "0" {
            continue;
        }
        columns.push(DbColumn {
            name: row[0].value.clone(),
            data_type: row[1].value.clone(),
        });
    }
    if columns.is_empty() {
        return Err("The selected table has no exportable columns".into());
    }
    Ok(columns)
}
fn decimal_column(engine: &str, column: &DbColumn) -> bool {
    matches!(engine, "postgres" | "mysql")
        && ["numeric", "decimal"].contains(&column.data_type.to_ascii_lowercase().as_str())
}
fn export_selection(engine: &str, columns: &[DbColumn], q: char) -> String {
    columns
        .iter()
        .map(|column| {
            let name = quote_identifier(&column.name, q);
            if decimal_column(engine, column) {
                // Decode arbitrary-precision decimals as server-formatted text, avoiding
                // rust_decimal's finite precision while retaining the numeric type label.
                format!(
                    "CAST({name} AS {}) AS {name}",
                    if engine == "postgres" {
                        "TEXT"
                    } else {
                        "CHAR CHARACTER SET utf8mb4"
                    }
                )
            } else {
                name
            }
        })
        .collect::<Vec<_>>()
        .join(", ")
}
fn type_cells<R: Row>(row: &R, cells: &mut [DbCell], engine: &str)
where
    usize: sqlx::ColumnIndex<R>,
{
    for (index, cell) in cells.iter_mut().enumerate() {
        if cell.kind != "text" {
            continue;
        }
        let ty = row
            .try_get_raw(index)
            .map(|v| v.type_info().name().to_ascii_uppercase())
            .unwrap_or_default();
        if ["BOOL", "BOOLEAN"].contains(&ty.as_str()) && engine == "postgres" {
            cell.kind = "boolean";
        } else if [
            "INTEGER",
            "REAL",
            "INT2",
            "INT4",
            "INT8",
            "FLOAT4",
            "FLOAT8",
            "NUMERIC",
            "TINYINT",
            "SMALLINT",
            "INT",
            "MEDIUMINT",
            "BIGINT",
            "FLOAT",
            "DOUBLE",
            "DECIMAL",
            "TINYINT UNSIGNED",
            "SMALLINT UNSIGNED",
            "INT UNSIGNED",
            "MEDIUMINT UNSIGNED",
            "BIGINT UNSIGNED",
            "BOOL",
            "BOOLEAN",
        ]
        .contains(&ty.as_str())
        {
            cell.kind = "number";
        }
    }
}
impl DatabaseSession {
    pub fn cancellation(&self) -> CancellationToken {
        self.cancel.clone()
    }
    pub fn engine(&self) -> String {
        self.config.engine.clone()
    }
    pub async fn export_file(
        &self,
        request: &ExportRequest,
        cancel: CancellationToken,
        progress: &Channel<TransferProgress>,
    ) -> Result<TransferSummary, String> {
        if request.tables.is_empty() {
            return Err("Select at least one table".into());
        }
        if !["sql", "json", "csv"].contains(&request.format.as_str())
            || (request.format == "csv" && request.tables.len() != 1)
        {
            return Err("Select a supported format; CSV exports one table".into());
        }
        let destination = Path::new(&request.path);
        if std::fs::symlink_metadata(destination)
            .is_ok_and(|m| !m.is_file() || m.file_type().is_symlink())
        {
            return Err("Choose a regular destination file".into());
        }
        if self.config.engine == "sqlite"
            && destination
                .canonicalize()
                .ok()
                .zip(Path::new(&self.config.file).canonicalize().ok())
                .is_some_and(|(a, b)| a == b)
        {
            return Err("Choose an export file different from the connected database".into());
        }
        let (temp, file) = temporary(destination.parent().ok_or("Choose an export destination")?)?;
        let mut writer = BufWriter::with_capacity(256 * 1024, tokio::fs::File::from_std(file));
        let mut summary = TransferSummary {
            tables: request.tables.len(),
            ..Default::default()
        };
        let q = if self.config.engine == "mysql" {
            '`'
        } else {
            '"'
        };
        let latest = Mutex::new((TransferProgress::default(), Instant::now()));
        let report = |value: TransferProgress| {
            if let Ok(mut latest) = latest.lock() {
                *latest = (value.clone(), Instant::now());
            }
            let _ = progress.send(value);
        };
        report(TransferProgress {
            phase: "Validating table selection".into(),
            ..Default::default()
        });
        let future = async {
            // Validate once. Export only needs column names, types and generated flags;
            // the grid's full metadata also queries indexes, relationships and editability.
            let available = self.tables().await?;
            let available: std::collections::HashSet<_> = available
                .rows
                .iter()
                .filter_map(|row| Some((row.first()?.value.as_str(), row.get(1)?.value.as_str())))
                .collect();
            for table in &request.tables {
                if !available.contains(&(table.schema.as_str(), table.name.as_str())) {
                    return Err("Select a table from this database".into());
                }
            }
            let initial = match request.format.as_str() { "sql" => format!("-- Octode table data ({}). Destination tables must already exist.\n-- Generated columns are omitted. Existing rows are not removed.\n", self.config.engine), "json" => format!("{{\"format\":\"octode-table-data\",\"version\":1,\"engine\":{},\"tables\":[", serde_json::to_string(&self.config.engine).unwrap()), _ => String::new() };
            writer
                .write_all(initial.as_bytes())
                .await
                .map_err(|e| e.to_string())?;
            summary.bytes += initial.len() as u64;
            macro_rules! export { ($connection:expr, $decode:ident) => {{
                let mut connection = $connection;
                let mut tx = connection.begin().await.map_err(db_error)?;
                let mut tick = Instant::now();
                for (table_index, table) in request.tables.iter().enumerate() {
                    let table_label = format!("{}.{}", table.schema, table.name);
                    report(TransferProgress { phase: format!("Reading columns ({}/{})", table_index+1, request.tables.len()), table: table_label.clone(), rows: summary.rows, bytes: summary.bytes, ..Default::default() });
                    let column_sql = export_columns_sql(&self.config.engine, table)?;
                    let raw_columns = sqlx::query(&column_sql).fetch_all(&mut *tx).await.map_err(db_error)?;
                    let columns = export_columns(raw_columns.iter().map(|row| cells!(row, $decode)).collect())?;
                    let name = format!("{}.{}", quote_identifier(&table.schema,q), quote_identifier(&table.name,q));
                    let names = columns.iter().map(|c| quote_identifier(&c.name,q)).collect::<Vec<_>>().join(", ");
                    let header = match request.format.as_str() {
                        "json" => format!("{}{{\"schema\":{},\"name\":{},\"result\":{{\"columns\":{},\"rows\":[", if table_index > 0 { "," } else { "" }, serde_json::to_string(&table.schema).unwrap(), serde_json::to_string(&table.name).unwrap(), serde_json::to_string(&columns).map_err(|e|e.to_string())?),
                        "csv" if request.headers => csv_line(columns.iter().map(|c| c.name.clone())),
                        _ => String::new(),
                    };
                    writer.write_all(header.as_bytes()).await.map_err(|e|e.to_string())?; summary.bytes += header.len() as u64;
                    let sql = format!("SELECT {} FROM {name}", export_selection(&self.config.engine, &columns, q));
                    report(TransferProgress { phase: format!("Reading rows ({}/{})", table_index+1, request.tables.len()), table: table_label.clone(), rows: summary.rows, bytes: summary.bytes, ..Default::default() });
                    let mut stream = sqlx::query(&sql).fetch(&mut *tx); let mut table_rows = 0u64;
                    while let Some(row) = stream.try_next().await.map_err(db_error)? {
                        let mut cells = cells!(&row, $decode); type_cells(&row, &mut cells, &self.config.engine);
                        for (cell, column) in cells.iter_mut().zip(&columns) {
                            if !decimal_column(&self.config.engine,column) || cell.kind == "null" {continue;}
                            if cell.kind == "binary" { cell.value=String::from_utf8(BASE64_STANDARD.decode(&cell.value).map_err(|e|e.to_string())?).map_err(|_|"Invalid decimal text")?; }
                            if cell.kind != "unsupported" {cell.kind="number";}
                        }
                        if cells.iter().any(|c| c.kind == "unsupported") { return Err(format!("{}.{} has an unsupported column type. No partial export was saved.", table.schema, table.name)); }
                        let line = match request.format.as_str() {
                            "sql" => format!("INSERT INTO {name} ({names}){} VALUES ({});\n", if self.config.engine == "postgres" { " OVERRIDING SYSTEM VALUE" } else { "" }, cells.iter().map(|c| sql_value(c, &self.config.engine)).collect::<Result<Vec<_>,_>>()?.join(", ")),
                            "json" => format!("{}{}", if table_rows > 0 { "," } else { "" }, serde_json::to_string(&cells).map_err(|e|e.to_string())?),
                            _ => csv_line(cells.iter().map(|c| match c.kind { "null" => String::new(), "binary" => format!("base64:{}",c.value), _ => c.value.clone() })),
                        };
                        writer.write_all(line.as_bytes()).await.map_err(|e|e.to_string())?; summary.bytes += line.len() as u64; summary.rows += 1; table_rows += 1;
                        if tick.elapsed() >= Duration::from_millis(100) { report(TransferProgress { phase:format!("Exporting ({}/{})", table_index+1, request.tables.len()),rows:summary.rows,bytes:summary.bytes,table:table_label.clone(),..Default::default() }); tick=Instant::now(); }
                    }
                    drop(stream);
                    if request.format == "json" { let end = b"],\"rowsAffected\":0,\"elapsedMs\":0,\"truncated\":false}}"; writer.write_all(end).await.map_err(|e|e.to_string())?; summary.bytes += end.len() as u64; }
                }
                tx.rollback().await.map_err(db_error)?; let _ = connection.close().await;
            }}; }
            report(TransferProgress {
                phase: "Opening export connection".into(),
                ..Default::default()
            });
            match self.open().await? {
                DbConnection::Sqlite(c) => export!(c, sqlite_export_cell),
                DbConnection::Postgres(c) => export!(c, pg_export_cell),
                DbConnection::Mysql(c) => export!(c, mysql_export_cell),
            }
            if request.format == "json" {
                writer.write_all(b"]}\n").await.map_err(|e| e.to_string())?;
                summary.bytes += 3;
            }
            report(TransferProgress {
                phase: "Finishing export file".into(),
                rows: summary.rows,
                bytes: summary.bytes,
                ..Default::default()
            });
            writer.flush().await.map_err(|e| e.to_string())?;
            writer
                .get_ref()
                .sync_all()
                .await
                .map_err(|e| e.to_string())?;
            Ok::<(), String>(())
        };
        {
            tokio::pin!(future);
            let mut heartbeat = tokio::time::interval(Duration::from_secs(1));
            loop {
                tokio::select! {
                    _=cancel.cancelled()=>return Err("Export cancelled; no partial file was saved".into()),
                    _=self.cancel.cancelled()=>return Err("Connection closed; no partial file was saved".into()),
                    result=&mut future=>{ result?; break; },
                    _=heartbeat.tick()=>{
                        let value = latest.lock().ok().map(|latest| { let (value, since) = &*latest;
                            let mut value = value.clone();
                            if since.elapsed().as_secs() >= 2 { value.phase = format!("{} · waiting {}s", value.phase, since.elapsed().as_secs()); }
                            value
                        });
                        if let Some(value) = value { let _ = progress.send(value); }
                    }
                }
            }
        }
        drop(writer);
        // Cancellation is checked before the atomic replacement; an existing file is preserved on failure.
        if cancel.is_cancelled() || self.cancel.is_cancelled() {
            return Err("Export cancelled; no partial file was saved".into());
        }
        std::fs::rename(&temp.path, destination).map_err(|e| e.to_string())?;
        Ok(summary)
    }
    pub async fn import_file(
        &self,
        prepared: &PreparedImports,
        owner: &str,
        session: &str,
        request: &ImportRequest,
        cancel: CancellationToken,
        progress: &Channel<TransferProgress>,
    ) -> Result<TransferSummary, String> {
        if self.config.read_only {
            return Err("Reconnect with writes enabled before importing".into());
        }
        let source = prepared.get(owner, session, &request.token)?;
        let file = File::open(&source.temp.path).map_err(|e| e.to_string())?;
        let mut csv_sql = String::new();
        let mapping = request.mapping.clone().unwrap_or_default();
        if source.format == "csv" {
            if mapping.len() != source.headers.len() {
                return Err("Review the CSV column mapping again".into());
            }
            let names: Vec<_> = mapping.iter().filter(|s| !s.is_empty()).collect();
            if names.is_empty()
                || names.iter().collect::<std::collections::HashSet<_>>().len() != names.len()
            {
                return Err("Map each destination column at most once".into());
            }
            let table = request.table.as_ref().ok_or("Select a destination table")?;
            let metadata = self.metadata(&table.schema, &table.name).await?;
            let q = if self.config.engine == "mysql" {
                '`'
            } else {
                '"'
            };
            for name in &names {
                if !metadata
                    .columns
                    .iter()
                    .any(|c| &c.name == *name && !c.generated)
                {
                    return Err(
                        "A mapped column changed or is generated; review the mapping again".into(),
                    );
                }
            }
            if self.config.engine == "mysql" {
                let s = table.schema.replace('\'', "''");
                let t = table.name.replace('\'', "''");
                let engine=self.metadata_query(&format!("SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA='{s}' AND TABLE_NAME='{t}'"),1).await?;
                if !engine
                    .rows
                    .first()
                    .and_then(|r| r.first())
                    .is_some_and(|c| c.value.eq_ignore_ascii_case("InnoDB"))
                {
                    return Err(
                        "CSV import requires an InnoDB table for transactional import".into(),
                    );
                }
            }
            csv_sql = format!(
                "INSERT INTO {}.{} ({}){} VALUES ",
                quote_identifier(&table.schema, q),
                quote_identifier(&table.name, q),
                names
                    .iter()
                    .map(|n| quote_identifier(n, q))
                    .collect::<Vec<_>>()
                    .join(", "),
                if self.config.engine == "postgres" {
                    " OVERRIDING SYSTEM VALUE"
                } else {
                    ""
                }
            );
        }
        let (sender, mut receiver) = tokio::sync::mpsc::channel(1);
        let format = source.format.clone();
        let engine = self.config.engine.clone();
        let parser_cancel = cancel.clone();
        let keep = source.clone();
        let parser = tokio::task::spawn_blocking(move || {
            let _keep = keep;
            parse::parse(file, &format, &engine, parser_cancel, |record| {
                sender
                    .blocking_send(record)
                    .map_err(|_| "Import stopped".into())
            })
        });
        let mut summary = TransferSummary::default();
        let future = async {
            macro_rules! import { ($connection:expr) => {{
                let mut connection=$connection;
                // CSV is one transaction. SQL scripts retain their own transaction semantics.
                if source.format=="csv" { sqlx::Executor::execute(&mut connection,"BEGIN").await.map_err(db_error)?; }
                let mut skip_header=source.format=="csv"; let mut tick=Instant::now();
                while let Some(record)=receiver.recv().await {
                    let (sql,position)=match record {
                        parse::Record::Sql(sql,position)=>(sql,position),
                        parse::Record::Csv(row,position)=>{
                            if skip_header {skip_header=false;continue;}
                            let values=row.iter().zip(&mapping).filter(|(_,name)|!name.is_empty()).map(|(value,_)|sql_value(&DbCell {kind:if request.empty_null.unwrap_or(false)&&value.is_empty(){"null"}else{"text"},value:value.clone()},&self.config.engine)).collect::<Result<Vec<_>,_>>()?;
                            (format!("{csv_sql}({})",values.join(", ")),position)
                        }
                    };
                    let result=sqlx::Executor::execute(&mut connection,sql.as_str()).await.map_err(|e|format!("{}. {}",db_error(e),if source.format=="csv"{"CSV import was rolled back; no rows were committed."}else{"Some SQL statements may have applied; verify before retrying."}))?;
                    summary.rows+=result.rows_affected(); summary.bytes=position;
                    if tick.elapsed()>=Duration::from_millis(100) {let _=progress.send(TransferProgress {phase:"Importing".into(),rows:summary.rows,bytes:position,total_bytes:Some(source.bytes),..Default::default()});tick=Instant::now();}
                }
                parser.await.map_err(|e|e.to_string())??;
                if source.format=="csv" {sqlx::Executor::execute(&mut connection,"COMMIT").await.map_err(|_|"Commit outcome is uncertain; verify before retrying".to_string())?;}
                let _=connection.close().await;
            }}; }
            match self.open().await? {
                DbConnection::Sqlite(c) => import!(c),
                DbConnection::Postgres(c) => import!(c),
                DbConnection::Mysql(c) => import!(c),
            }
            summary.bytes = source.bytes;
            summary.tables = usize::from(source.format == "csv");
            Ok::<(), String>(())
        };
        tokio::select! { _=cancel.cancelled()=>return Err(if source.format=="csv" {"CSV import cancelled. No rows were committed unless the commit was already in progress; verify before retrying."} else {"SQL import cancelled. Some statements may have applied; verify before retrying."}.into()), _=self.cancel.cancelled()=>return Err("Connection closed during import. Verify the outcome before retrying.".into()), result=future=>result? }
        Ok(summary)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture {
        directory: PathBuf,
        session: DatabaseSession,
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.directory);
        }
    }
    fn fixture() -> Fixture {
        let directory =
            std::env::temp_dir().join(format!("octode-stream-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&directory).unwrap();
        let path = directory.join("data.sqlite");
        rusqlite::Connection::open(&path).unwrap().execute_batch("CREATE TABLE items(id INTEGER PRIMARY KEY, value TEXT, bytes BLOB, optional TEXT, doubled INTEGER GENERATED ALWAYS AS (id*2)); CREATE TABLE copies(id INTEGER PRIMARY KEY, value TEXT, bytes BLOB, optional TEXT);").unwrap();
        Fixture {
            directory,
            session: DatabaseSession {
                cancel: CancellationToken::new(),
                owner: "test".into(),
                password: String::new(),
                tunnel: None,
                ssh: None,
                config: DatabaseConnection {
                    id: "test".into(),
                    name: "Test".into(),
                    engine: "sqlite".into(),
                    host: String::new(),
                    port: 0,
                    database: String::new(),
                    username: String::new(),
                    password: SecretValue::default(),
                    file: path.to_string_lossy().into(),
                    tls: "disable".into(),
                    read_only: false,
                    ssh_id: String::new(),
                },
            },
        }
    }
    fn channel() -> Channel<TransferProgress> {
        Channel::new(|_| Ok(()))
    }
    fn table(name: &str) -> TransferTable {
        TransferTable {
            schema: "main".into(),
            name: name.into(),
        }
    }
    fn request(path: &Path, format: &str, tables: Vec<TransferTable>) -> ExportRequest {
        ExportRequest {
            tables,
            path: path.to_string_lossy().into(),
            format: format.into(),
            headers: true,
            operation_id: uuid::Uuid::new_v4().to_string(),
        }
    }
    fn prepare(f: &Fixture, store: &PreparedImports, path: &Path, format: &str) -> ImportPreview {
        store
            .prepare(
                "test".into(),
                "session".into(),
                path.to_string_lossy().into(),
                format.into(),
                "sqlite".into(),
                CancellationToken::new(),
                f.session.cancel.clone(),
                channel(),
            )
            .unwrap()
    }
    fn import_request(token: String) -> ImportRequest {
        ImportRequest {
            token,
            operation_id: uuid::Uuid::new_v4().to_string(),
            table: None,
            mapping: None,
            empty_null: None,
        }
    }
    #[tokio::test]
    async fn streams_large_cells_without_display_limits_and_preserves_types() {
        let f = fixture();
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        connection
            .execute(
                "INSERT INTO items(id,value,bytes) VALUES(9007199254740993,?,?)",
                rusqlite::params!["Ćao;'\\\n".repeat(20000), vec![0u8, 1, 255].repeat(30000)],
            )
            .unwrap();
        drop(connection);
        let file = f.directory.join("export.json");
        let summary = f
            .session
            .export_file(
                &request(&file, "json", vec![table("items")]),
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        assert_eq!(summary.rows, 1);
        let json: serde_json::Value = serde_json::from_reader(File::open(&file).unwrap()).unwrap();
        let result = &json["tables"][0]["result"];
        assert_eq!(result["columns"].as_array().unwrap().len(), 4);
        assert_eq!(result["rows"][0][0]["value"], "9007199254740993");
        assert_eq!(result["rows"][0][0]["kind"], "number");
        assert_eq!(
            result["rows"][0][1]["value"].as_str().unwrap(),
            "Ćao;'\\\n".repeat(20000)
        );
        assert_eq!(
            BASE64_STANDARD
                .decode(result["rows"][0][2]["value"].as_str().unwrap())
                .unwrap()
                .len(),
            90000
        );
        assert_eq!(result["rows"][0][3]["kind"], "null");
        let sql = f.directory.join("export.sql");
        f.session
            .export_file(
                &request(&sql, "sql", vec![table("items")]),
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        let destination = f.directory.join("restored.sqlite");
        let connection = rusqlite::Connection::open(&destination).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE items(id INTEGER PRIMARY KEY,value TEXT,bytes BLOB,optional TEXT);",
            )
            .unwrap();
        connection
            .execute_batch(&std::fs::read_to_string(sql).unwrap())
            .unwrap();
        assert_eq!(
            connection
                .query_row("SELECT length(bytes) FROM items", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            90000
        );
    }
    #[tokio::test]
    async fn streams_csv_past_all_previous_row_and_file_limits_and_imports_atomically() {
        let f = fixture();
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        connection.execute_batch("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<100005) INSERT INTO items(id,value) SELECT x,replace(hex(zeroblob(160)),'0','a') FROM n;").unwrap();
        drop(connection);
        let file = f.directory.join("large.csv");
        let summary = f
            .session
            .export_file(
                &request(&file, "csv", vec![table("items")]),
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        assert_eq!(summary.rows, 100005);
        assert!(summary.bytes > 20 * 1024 * 1024);
        let imports = PreparedImports::default();
        let preview = prepare(&f, &imports, &file, "csv");
        assert_eq!(preview.rows, 100005);
        assert!(preview.truncated);
        assert!(preview.preview.len() <= 65536 * 3);
        assert_eq!(preview.sample.len(), 5);
        let mut req = import_request(preview.token);
        req.table = Some(table("copies"));
        req.mapping = Some(vec![
            "id".into(),
            "value".into(),
            "bytes".into(),
            "optional".into(),
        ]);
        req.empty_null = Some(true);
        let summary = f
            .session
            .import_file(
                &imports,
                "test",
                "session",
                &req,
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        assert_eq!(summary.rows, 100005);
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM copies", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            100005
        );
    }
    #[tokio::test]
    async fn sql_import_uses_reviewed_snapshot_accepts_large_statements_and_enforces_ownership() {
        let mut f = fixture();
        let imports = PreparedImports::default();
        let file = f.directory.join("large.sql");
        let mut out = File::create(&file).unwrap();
        write!(
            out,
            "BEGIN; INSERT INTO items(value) VALUES('{}'); COMMIT;",
            "a".repeat(4 * 1024 * 1024 + 17)
        )
        .unwrap();
        drop(out);
        let preview = prepare(&f, &imports, &file, "sql");
        assert_eq!(preview.statements, 3);
        assert!(preview.truncated);
        std::fs::write(&file, "DROP TABLE items;").unwrap();
        let req = import_request(preview.token.clone());
        assert!(f
            .session
            .import_file(
                &imports,
                "other",
                "session",
                &req,
                CancellationToken::new(),
                &channel()
            )
            .await
            .is_err());
        assert!(f
            .session
            .import_file(
                &imports,
                "test",
                "other-session",
                &req,
                CancellationToken::new(),
                &channel()
            )
            .await
            .is_err());
        f.session.config.read_only = true;
        assert!(f
            .session
            .import_file(
                &imports,
                "test",
                "session",
                &req,
                CancellationToken::new(),
                &channel()
            )
            .await
            .is_err());
        f.session.config.read_only = false;
        f.session
            .import_file(
                &imports,
                "test",
                "session",
                &req,
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT length(value) FROM items", [], |r| r
                    .get::<_, i64>(0))
                .unwrap(),
            4 * 1024 * 1024 + 17
        );
        imports.release("test", &preview.token);
        assert!(imports.get("test", "session", &preview.token).is_err());
    }
    #[tokio::test]
    async fn cancelled_or_failed_export_keeps_destination_and_removes_temporary_file() {
        let f = fixture();
        let file = f.directory.join("existing.csv");
        std::fs::write(&file, "original").unwrap();
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(f
            .session
            .export_file(
                &request(&file, "csv", vec![table("items")]),
                cancel,
                &channel()
            )
            .await
            .is_err());
        assert!(f
            .session
            .export_file(
                &request(&file, "csv", vec![table("missing")]),
                CancellationToken::new(),
                &channel()
            )
            .await
            .is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "original");
        assert!(!std::fs::read_dir(&f.directory).unwrap().any(|p| p
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".octode-transfer-")));
        assert!(f
            .session
            .export_file(
                &request(
                    Path::new(&f.session.config.file),
                    "sql",
                    vec![table("items")]
                ),
                CancellationToken::new(),
                &channel()
            )
            .await
            .is_err());
    }
    #[tokio::test]
    async fn csv_failure_and_cancellation_do_not_commit_partial_rows() {
        let f = fixture();
        let imports = PreparedImports::default();
        let file = f.directory.join("conflict.csv");
        std::fs::write(&file, "id,value\r\n1,first\r\n1,duplicate\r\n").unwrap();
        let preview = prepare(&f, &imports, &file, "csv");
        let mut req = import_request(preview.token);
        req.table = Some(table("copies"));
        req.mapping = Some(vec!["id".into(), "value".into()]);
        assert!(f
            .session
            .import_file(
                &imports,
                "test",
                "session",
                &req,
                CancellationToken::new(),
                &channel()
            )
            .await
            .unwrap_err()
            .contains("rolled back"));
        let cancel = CancellationToken::new();
        cancel.cancel();
        assert!(f
            .session
            .import_file(&imports, "test", "session", &req, cancel, &channel())
            .await
            .is_err());
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM copies", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
    #[tokio::test]
    async fn exports_more_than_two_hundred_tables_including_empty_ones() {
        let f = fixture();
        let connection = rusqlite::Connection::open(&f.session.config.file).unwrap();
        let mut tables = Vec::new();
        for n in 0..201 {
            let name = format!("table_{n}");
            connection
                .execute_batch(&format!("CREATE TABLE {name}(id INTEGER)"))
                .unwrap();
            tables.push(table(&name));
        }
        drop(connection);
        let file = f.directory.join("tables.json");
        f.session
            .export_file(
                &request(&file, "json", tables),
                CancellationToken::new(),
                &channel(),
            )
            .await
            .unwrap();
        let json: serde_json::Value = serde_json::from_reader(File::open(file).unwrap()).unwrap();
        assert_eq!(json["tables"].as_array().unwrap().len(), 201);
    }
    #[tokio::test]
    async fn export_reports_each_stage_before_rows_even_for_empty_tables() {
        let f = fixture();
        let messages = Arc::new(Mutex::new(Vec::<serde_json::Value>::new()));
        let captured = messages.clone();
        let progress = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                captured
                    .lock()
                    .unwrap()
                    .push(serde_json::from_str(&json).unwrap());
            }
            Ok(())
        });
        let destination = f.directory.join("progress.json");
        f.session
            .export_file(
                &request(&destination, "json", vec![table("items"), table("copies")]),
                CancellationToken::new(),
                &progress,
            )
            .await
            .unwrap();
        let messages = messages.lock().unwrap();
        let phases: Vec<_> = messages
            .iter()
            .map(|v| v["phase"].as_str().unwrap())
            .collect();
        assert_eq!(phases[0], "Validating table selection");
        assert!(phases.contains(&"Opening export connection"));
        assert!(phases.contains(&"Reading columns (1/2)"));
        assert!(phases.contains(&"Reading rows (1/2)"));
        assert!(phases.contains(&"Reading columns (2/2)"));
        assert!(phases.contains(&"Reading rows (2/2)"));
        assert!(phases.contains(&"Finishing export file"));
        assert!(messages
            .iter()
            .any(|v| v["phase"] == "Reading columns (2/2)" && v["table"] == "main.copies"));
    }
    #[tokio::test]
    async fn export_reports_waiting_and_can_cancel_during_locked_metadata() {
        let f = fixture();
        let lock = rusqlite::Connection::open(&f.session.config.file).unwrap();
        lock.execute_batch("BEGIN EXCLUSIVE").unwrap();
        let cancel = CancellationToken::new();
        let stop = cancel.clone();
        let saw_wait = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let captured = saw_wait.clone();
        let progress = Channel::new(move |body| {
            if let tauri::ipc::InvokeResponseBody::Json(json) = body {
                let value: serde_json::Value = serde_json::from_str(&json).unwrap();
                if value["phase"]
                    .as_str()
                    .unwrap_or_default()
                    .contains("waiting 2s")
                {
                    captured.store(true, std::sync::atomic::Ordering::Relaxed);
                    stop.cancel();
                }
            }
            Ok(())
        });
        let destination = f.directory.join("existing.sql");
        std::fs::write(&destination, "original").unwrap();
        let result = f
            .session
            .export_file(
                &request(&destination, "sql", vec![table("items")]),
                cancel,
                &progress,
            )
            .await;
        lock.execute_batch("ROLLBACK").unwrap();
        assert!(result.unwrap_err().contains("cancelled"));
        assert!(saw_wait.load(std::sync::atomic::Ordering::Relaxed));
        assert_eq!(std::fs::read_to_string(destination).unwrap(), "original");
    }
}
