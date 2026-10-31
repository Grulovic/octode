use super::*;
use std::collections::BTreeMap;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaColumn {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
    pub default_value: Option<String>,
    pub generated: bool,
    pub full_type: String,
    pub extra: String,
    pub collation: String,
    pub comment: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableMetadata {
    pub columns: Vec<MetaColumn>,
    pub indexes: DbResult,
    pub foreign_keys: DbResult,
    pub editable: bool,
    pub reason: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct RowChange {
    pub kind: String,
    #[serde(default)]
    pub original: BTreeMap<String, Option<String>>,
    #[serde(default)]
    pub values: BTreeMap<String, Option<String>>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowStatement {
    pub sql: String,
    pub parameters: Vec<Option<String>>,
    pub check_sql: Option<String>,
    pub check_parameters: Vec<Option<String>>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RowPlan {
    pub statements: Vec<RowStatement>,
}
fn literal(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}
fn flag(row: &[DbCell], index: usize) -> bool {
    row.get(index)
        .is_some_and(|cell| ["1", "true", "t", "YES"].contains(&cell.value.as_str()))
}
fn text(row: &[DbCell], index: usize) -> String {
    row.get(index)
        .map(|cell| cell.value.clone())
        .unwrap_or_default()
}
impl DatabaseSession {
    async fn validated_table(&self, schema: &str, table: &str) -> Result<String, String> {
        let tables = self.tables().await?;
        if !tables.rows.iter().any(|row| {
            row.first().is_some_and(|cell| cell.value == schema)
                && row.get(1).is_some_and(|cell| cell.value == table)
        }) {
            return Err("Select a table in this connection".into());
        }
        let q = if self.config.engine == "mysql" {
            '`'
        } else {
            '"'
        };
        Ok(format!(
            "{}.{}",
            quote_identifier(schema, q),
            quote_identifier(table, q)
        ))
    }
    pub async fn metadata(&self, schema: &str, table: &str) -> Result<TableMetadata, String> {
        self.validated_table(schema, table).await?;
        let s = literal(schema);
        let t = literal(table);
        let (column_sql,index_sql,fk_sql)=match self.config.engine.as_str(){
   "sqlite"=>(format!("SELECT name, type, CASE WHEN \"notnull\"=0 THEN 1 ELSE 0 END AS nullable, CASE WHEN pk>0 THEN 1 ELSE 0 END AS primary_key, dflt_value, CASE WHEN hidden>0 THEN 1 ELSE 0 END AS octode_generated FROM pragma_table_xinfo({t},{s})"),format!("SELECT name, \"unique\", origin, partial FROM pragma_index_list({t},{s})"),format!("SELECT * FROM pragma_foreign_key_list({t},{s})")),
   "postgres"=>(format!("SELECT c.column_name, c.data_type, CASE WHEN c.is_nullable='YES' THEN 1 ELSE 0 END AS nullable, CASE WHEN EXISTS (SELECT 1 FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage k ON k.constraint_name=tc.constraint_name AND k.constraint_schema=tc.constraint_schema AND k.table_name=tc.table_name WHERE tc.constraint_type='PRIMARY KEY' AND tc.table_schema=c.table_schema AND tc.table_name=c.table_name AND k.column_name=c.column_name) THEN 1 ELSE 0 END AS primary_key, c.column_default, CASE WHEN c.is_generated='ALWAYS' THEN 1 ELSE 0 END AS octode_generated, (SELECT pg_catalog.format_type(a.atttypid,a.atttypmod) FROM pg_catalog.pg_attribute a JOIN pg_catalog.pg_class r ON r.oid=a.attrelid JOIN pg_catalog.pg_namespace n ON n.oid=r.relnamespace WHERE n.nspname=c.table_schema AND r.relname=c.table_name AND a.attname=c.column_name AND a.attnum>0 LIMIT 1) AS full_type FROM information_schema.columns c WHERE c.table_schema={s} AND c.table_name={t} ORDER BY c.ordinal_position"),format!("SELECT indexname AS name, indexdef AS definition FROM pg_indexes WHERE schemaname={s} AND tablename={t}"),format!("SELECT tc.constraint_name, kcu.column_name, ccu.table_schema AS target_schema, ccu.table_name AS target_table, ccu.column_name AS target_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name=kcu.constraint_name AND tc.constraint_schema=kcu.constraint_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name=tc.constraint_name AND ccu.constraint_schema=tc.constraint_schema WHERE tc.constraint_type='FOREIGN KEY' AND tc.table_schema={s} AND tc.table_name={t}")),
   _=>(format!("SELECT COLUMN_NAME, DATA_TYPE, CASE WHEN IS_NULLABLE='YES' THEN 1 ELSE 0 END AS nullable, CASE WHEN COLUMN_KEY='PRI' THEN 1 ELSE 0 END AS primary_key, COLUMN_DEFAULT, CASE WHEN (EXTRA LIKE '%VIRTUAL GENERATED%' OR EXTRA LIKE '%STORED GENERATED%') THEN 1 ELSE 0 END AS octode_generated, COLUMN_TYPE, EXTRA, COLLATION_NAME, COLUMN_COMMENT FROM information_schema.columns WHERE TABLE_SCHEMA={s} AND TABLE_NAME={t} ORDER BY ORDINAL_POSITION"),format!("SELECT INDEX_NAME, COLUMN_NAME, NON_UNIQUE, SEQ_IN_INDEX FROM information_schema.statistics WHERE TABLE_SCHEMA={s} AND TABLE_NAME={t} ORDER BY INDEX_NAME,SEQ_IN_INDEX"),format!("SELECT CONSTRAINT_NAME,COLUMN_NAME,REFERENCED_TABLE_SCHEMA,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME FROM information_schema.key_column_usage WHERE TABLE_SCHEMA={s} AND TABLE_NAME={t} AND REFERENCED_TABLE_NAME IS NOT NULL"))
  };
        let raw = self.metadata_query(&column_sql, 1000).await?;
        let columns = raw
            .rows
            .iter()
            .map(|row| MetaColumn {
                name: text(row, 0),
                data_type: text(row, 1),
                nullable: flag(row, 2),
                primary_key: flag(row, 3),
                default_value: row
                    .get(4)
                    .filter(|cell| cell.kind != "null")
                    .map(|cell| cell.value.clone()),
                generated: flag(row, 5),
                full_type: text(row, 6),
                extra: text(row, 7),
                collation: text(row, 8),
                comment: text(row, 9),
            })
            .collect::<Vec<_>>();
        let mut reason = if self.config.read_only {
            "Reconnect with writes enabled to edit rows".into()
        } else if !columns.iter().any(|column| column.primary_key) {
            "A primary key is required for visual row edits".into()
        } else if columns
            .iter()
            .any(|column| !supported(&self.config.engine, &column.data_type))
        {
            "This table includes a type that visual row editing cannot compare safely".into()
        } else {
            String::new()
        };
        if self.config.engine == "mysql" && reason.is_empty() {
            let engine=self.metadata_query(&format!("SELECT ENGINE FROM information_schema.tables WHERE TABLE_SCHEMA={s} AND TABLE_NAME={t}"),1).await?;
            if !engine
                .rows
                .first()
                .and_then(|row| row.first())
                .is_some_and(|cell| cell.value.eq_ignore_ascii_case("InnoDB"))
            {
                reason = "Visual edits require an InnoDB table for transactional Apply".into();
            }
        }
        Ok(TableMetadata {
            columns,
            indexes: self.metadata_query(&index_sql, 1000).await?,
            foreign_keys: self.metadata_query(&fk_sql, 1000).await?,
            editable: reason.is_empty(),
            reason,
        })
    }
    pub async fn row_plan(
        &self,
        schema: &str,
        table: &str,
        changes: &[RowChange],
    ) -> Result<RowPlan, String> {
        if self.config.read_only {
            return Err("This connection is read-only".into());
        }
        if changes.is_empty() || changes.len() > 100 {
            return Err("Review a batch of 1–100 row changes".into());
        }
        let metadata = self.metadata(schema, table).await?;
        if !metadata.editable {
            return Err(metadata.reason);
        }
        let name = self.validated_table(schema, table).await?;
        plan(&self.config.engine, &name, &metadata.columns, changes)
    }
    pub async fn apply_rows(
        &self,
        schema: &str,
        table: &str,
        changes: &[RowChange],
        reviewed: &RowPlan,
    ) -> Result<u64, String> {
        let plan = self.row_plan(schema, table, changes).await?;
        if &plan != reviewed {
            return Err("The table schema or edit plan changed. Review the SQL again.".into());
        }
        macro_rules! apply{($connection:expr)=>{{let mut connection=$connection;let mut transaction=connection.begin().await.map_err(db_error)?;let mut applied=0;for statement in &plan.statements{if let Some(sql)=&statement.check_sql{let mut check=sqlx::query(sql);for value in &statement.check_parameters{check=check.bind(value.as_deref());}let row=check.fetch_one(&mut *transaction).await.map_err(db_error)?;let count:i64=row.try_get(0).map_err(db_error)?;if count!=1{return Err("A row changed or disappeared since it was loaded. No row edits in this batch were committed; reload and review.".into());}}
      let mut query=sqlx::query(&statement.sql);for value in &statement.parameters{query=query.bind(value.as_deref());}let result=query.execute(&mut *transaction).await.map_err(db_error)?;if result.rows_affected()!=1{return Err("A row edit did not affect exactly one row; the batch was rolled back.".into());}applied+=1;}
      transaction.commit().await.map_err(|_|"The commit result is uncertain. Refresh and verify before retrying.".to_string())?;let _=connection.close().await;Ok(applied)}};}
        let future = async {
            match self.open().await? {
                DbConnection::Sqlite(connection) => apply!(connection),
                DbConnection::Postgres(connection) => apply!(connection),
                DbConnection::Mysql(connection) => apply!(connection),
            }
        };
        tokio::select! {_=self.cancel.cancelled()=>Err("Connection closed during Apply. Refresh and verify the commit outcome before retrying.".into()),result=tokio::time::timeout(Duration::from_secs(60),future)=>result.map_err(|_|"Row edit timed out; verify the commit outcome before retrying".to_string())?}
    }
}
fn supported(engine: &str, data_type: &str) -> bool {
    let lower = data_type.to_ascii_lowercase();
    if engine == "sqlite" {
        return !lower.contains("blob");
    }
    if engine == "postgres" {
        return [
            "smallint",
            "integer",
            "bigint",
            "numeric",
            "real",
            "double precision",
            "text",
            "character varying",
            "character",
            "boolean",
            "date",
            "timestamp without time zone",
            "timestamp with time zone",
            "time without time zone",
            "time with time zone",
            "uuid",
            "jsonb",
        ]
        .contains(&lower.as_str());
    }
    [
        "tinyint",
        "smallint",
        "mediumint",
        "int",
        "bigint",
        "decimal",
        "float",
        "double",
        "char",
        "varchar",
        "text",
        "tinytext",
        "mediumtext",
        "longtext",
        "date",
        "time",
        "datetime",
        "timestamp",
        "year",
        "enum",
        "set",
        "json",
    ]
    .contains(&lower.as_str())
}
fn placeholder(engine: &str, column: &MetaColumn, index: usize) -> String {
    if engine == "mysql" {
        return match column.data_type.to_ascii_lowercase().as_str() {
            // Without CAST, MySQL can compare a JSON document to a JSON string
            // containing the document text, falsely rejecting an unchanged row.
            "json" => "CAST(? AS JSON)",
            // Text-bound integers must not fall through floating-point comparison,
            // particularly for unsigned or large primary keys.
            "tinyint" | "smallint" | "mediumint" | "int" | "bigint" => "CAST(? AS DECIMAL(65,0))",
            _ => "?",
        }
        .into();
    }
    if engine != "postgres" {
        return "?".into();
    }
    let data_type = match column.data_type.to_ascii_lowercase().as_str() {
        "smallint" | "integer" | "bigint" => "bigint",
        "numeric" => "numeric",
        "real" | "double precision" => "double precision",
        "boolean" => "boolean",
        "date" => "date",
        "timestamp without time zone" => "timestamp",
        "timestamp with time zone" => "timestamptz",
        "time without time zone" => "time",
        "time with time zone" => "timetz",
        "uuid" => "uuid",
        "jsonb" => "jsonb",
        _ => "text",
    };
    format!("CAST(${index}::text AS {data_type})")
}
fn plan(
    engine: &str,
    table: &str,
    columns: &[MetaColumn],
    changes: &[RowChange],
) -> Result<RowPlan, String> {
    let quote = if engine == "mysql" { '`' } else { '"' };
    let quoted = |value: &str| quote_identifier(value, quote);
    let mut statements = Vec::new();
    let mut size = 0;
    for change in changes {
        if !["insert", "update", "update-cell", "delete"].contains(&change.kind.as_str()) {
            return Err("Unsupported row edit".into());
        }
        for (name, value) in change.values.iter().chain(change.original.iter()) {
            if !columns.iter().any(|column| &column.name == name) {
                return Err("A row edit references an unknown column".into());
            }
            size += value.as_ref().map_or(0, String::len);
        }
        if size > 4 * 1024 * 1024 {
            return Err("Row edits exceed 4 MB".into());
        }
        let cell_update = change.kind == "update-cell";
        if cell_update
            && (change.values.len() != 1
                || !change
                    .values
                    .keys()
                    .all(|name| change.original.contains_key(name)))
        {
            return Err("A cell update requires exactly one value and its loaded original".into());
        }
        if change.kind != "insert"
            && ((!cell_update && change.original.len() != columns.len())
                || !columns.iter().any(|column| column.primary_key)
                || columns
                    .iter()
                    .filter(|column| column.primary_key)
                    .any(|column| !matches!(change.original.get(&column.name), Some(Some(_)))))
        {
            return Err(
                "Reload the full row, including its non-null primary key, before editing".into(),
            );
        }
        let mut parameters = Vec::new();
        let mut sets = Vec::new();
        for (name, value) in &change.values {
            let column = columns.iter().find(|column| &column.name == name).unwrap();
            if column.generated {
                return Err("Generated columns cannot be edited".into());
            }
            if value.is_none() && !column.nullable && !column.primary_key {
                return Err(format!("{} cannot be NULL", column.name));
            }
            parameters.push(value.clone());
            sets.push((quoted(name), placeholder(engine, column, parameters.len())));
        }
        if change.kind == "update" && sets.is_empty() {
            return Err("Choose a column to update".into());
        }
        let mut check_parameters = Vec::new();
        let mut check_parts = Vec::new();
        let mut where_parts = Vec::new();
        if change.kind != "insert" {
            for column in columns {
                let Some(value) = change.original.get(&column.name).cloned() else {
                    continue;
                };
                check_parameters.push(value.clone());
                parameters.push(value);
                let operator = if engine == "mysql" {
                    "<=>"
                } else if engine == "postgres" {
                    "IS NOT DISTINCT FROM"
                } else {
                    "IS"
                };
                check_parts.push(format!(
                    "{} {operator} {}",
                    quoted(&column.name),
                    placeholder(engine, column, check_parameters.len())
                ));
                where_parts.push(format!(
                    "{} {operator} {}",
                    quoted(&column.name),
                    placeholder(engine, column, parameters.len())
                ));
            }
        }
        let sql = match change.kind.as_str() {
            "insert" => {
                if sets.is_empty() {
                    if engine == "mysql" {
                        format!("INSERT INTO {table} () VALUES ()")
                    } else {
                        format!("INSERT INTO {table} DEFAULT VALUES")
                    }
                } else {
                    format!(
                        "INSERT INTO {table} ({}) VALUES ({})",
                        sets.iter()
                            .map(|(name, _)| name.as_str())
                            .collect::<Vec<_>>()
                            .join(", "),
                        sets.iter()
                            .map(|(_, value)| value.as_str())
                            .collect::<Vec<_>>()
                            .join(", ")
                    )
                }
            }
            "update" | "update-cell" => format!(
                "UPDATE {table} SET {} WHERE {}",
                sets.iter()
                    .map(|(name, value)| format!("{name} = {value}"))
                    .collect::<Vec<_>>()
                    .join(", "),
                where_parts.join(" AND ")
            ),
            _ => {
                if !sets.is_empty() {
                    return Err("Delete edits cannot contain replacement values".into());
                }
                format!("DELETE FROM {table} WHERE {}", where_parts.join(" AND "))
            }
        };
        statements.push(RowStatement {
            sql,
            parameters,
            check_sql: (!check_parts.is_empty()).then(|| {
                format!(
                    "SELECT COUNT(*) FROM {table} WHERE {}",
                    check_parts.join(" AND ")
                )
            }),
            check_parameters,
        });
    }
    Ok(RowPlan { statements })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn columns() -> Vec<MetaColumn> {
        vec![
            MetaColumn {
                name: "id".into(),
                data_type: "integer".into(),
                nullable: false,
                primary_key: true,
                default_value: None,
                generated: false,
                full_type: String::new(),
                extra: String::new(),
                collation: String::new(),
                comment: String::new(),
            },
            MetaColumn {
                name: "name".into(),
                data_type: "text".into(),
                nullable: true,
                primary_key: false,
                default_value: None,
                generated: false,
                full_type: String::new(),
                extra: String::new(),
                collation: String::new(),
                comment: String::new(),
            },
        ]
    }
    #[test]
    fn mysql_row_plans_compare_json_as_documents_and_integer_keys_exactly() {
        let mut fields = columns();
        fields[0].data_type = "bigint".into();
        let mut settings = fields[1].clone();
        settings.name = "settings".into();
        settings.data_type = "json".into();
        fields.push(settings);
        let mut active = fields[1].clone();
        active.name = "active".into();
        active.data_type = "tinyint".into();
        fields.push(active);
        let original = BTreeMap::from([
            ("id".into(), Some("18446744073709551615".into())),
            ("name".into(), Some("before".into())),
            (
                "settings".into(),
                Some(r#"{"enabled":true,"amount":1.2300}"#.into()),
            ),
            ("active".into(), Some("1".into())),
        ]);
        for kind in ["update", "delete"] {
            let change = RowChange {
                kind: kind.into(),
                original: original.clone(),
                values: if kind == "update" {
                    BTreeMap::from([("settings".into(), Some("null".into()))])
                } else {
                    BTreeMap::new()
                },
            };
            let plan = plan("mysql", "things", &fields, &[change]).unwrap();
            let statement = &plan.statements[0];
            assert!(statement.sql.contains("`settings` <=> CAST(? AS JSON)"));
            assert!(statement
                .check_sql
                .as_ref()
                .unwrap()
                .contains("`settings` <=> CAST(? AS JSON)"));
            assert!(statement.sql.contains("`id` <=> CAST(? AS DECIMAL(65,0))"));
            assert!(statement
                .sql
                .contains("`active` <=> CAST(? AS DECIMAL(65,0))"));
            assert_eq!(
                statement.check_parameters[0].as_deref(),
                Some("18446744073709551615")
            );
            assert_eq!(statement.check_parameters[2], original["settings"]);
            if kind == "update" {
                assert!(statement.sql.contains("`settings` = CAST(? AS JSON)"));
            }
        }
    }
    #[test]
    fn cell_update_checks_primary_key_and_original_value_without_requiring_other_values() {
        let mut fields = columns();
        let mut extra = fields[1].clone();
        extra.name = "large_payload".into();
        fields.push(extra);
        let mut change = RowChange {
            kind: "update-cell".into(),
            original: BTreeMap::from([
                ("id".into(), Some("9007199254740993".into())),
                ("name".into(), Some("before".into())),
            ]),
            values: BTreeMap::from([("name".into(), Some("after".into()))]),
        };
        for engine in ["mysql", "postgres", "sqlite"] {
            let reviewed = plan(engine, "things", &fields, std::slice::from_ref(&change)).unwrap();
            assert!(reviewed.statements[0].sql.starts_with("UPDATE"));
            assert!(!reviewed.statements[0].sql.contains("large_payload"));
            assert_eq!(reviewed.statements[0].check_parameters.len(), 2);
        }
        change.kind = "update".into();
        assert!(plan("mysql", "things", &fields, std::slice::from_ref(&change)).is_err());
        change.kind = "update-cell".into();
        change.original.remove("id");
        assert!(plan("mysql", "things", &fields, std::slice::from_ref(&change)).is_err());
        change.original.insert("id".into(), Some("1".into()));
        change.original.remove("name");
        assert!(plan("mysql", "things", &fields, std::slice::from_ref(&change)).is_err());
        change.original.insert("name".into(), Some("before".into()));
        change
            .values
            .insert("large_payload".into(), Some("extra".into()));
        assert!(plan("mysql", "things", &fields, &[change]).is_err());
    }
    #[test]
    fn row_plans_quote_identifiers_bind_values_and_preserve_nulls_and_large_ids() {
        let change = RowChange {
            kind: "update".into(),
            original: BTreeMap::from([
                ("id".into(), Some("9007199254740993".into())),
                ("name".into(), None),
            ]),
            values: BTreeMap::from([("name".into(), Some("O'Reilly; DROP TABLE users".into()))]),
        };
        for engine in ["sqlite", "mysql", "postgres"] {
            let plan = plan(
                engine,
                "\"users\"",
                &columns(),
                std::slice::from_ref(&change),
            )
            .unwrap();
            assert!(!plan.statements[0].sql.contains("O'Reilly"));
            assert_eq!(
                plan.statements[0].parameters[0].as_deref(),
                Some("O'Reilly; DROP TABLE users")
            );
            assert_eq!(
                plan.statements[0].check_parameters[0].as_deref(),
                Some("9007199254740993")
            );
            assert_eq!(plan.statements[0].check_parameters[1], None);
        }
    }
}

#[cfg(test)]
mod sqlite_integration {
    use super::*;
    #[tokio::test]
    async fn row_apply_is_transactional_and_detects_concurrent_edits() {
        let path =
            std::env::temp_dir().join(format!("octode-rows-{}.sqlite", uuid::Uuid::new_v4()));
        let setup = rusqlite::Connection::open(&path).unwrap();
        setup.execute_batch("CREATE TABLE things (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO things VALUES (1,'first'),(2,'second');").unwrap();
        setup
            .execute_batch(
                "CREATE TABLE cell_values (id INTEGER PRIMARY KEY, settings TEXT, payload TEXT);",
            )
            .unwrap();
        setup
            .execute(
                "INSERT INTO cell_values VALUES(1,?1,?2)",
                rusqlite::params!["{\"enabled\":true}", "x".repeat(70000)],
            )
            .unwrap();
        drop(setup);
        let session = DatabaseSession {
            cancel: CancellationToken::new(),
            owner: "main".into(),
            config: DatabaseConnection {
                id: "test".into(),
                name: "Rows".into(),
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
            password: String::new(),
            tunnel: None,
            ssh: None,
        };
        let metadata = session.metadata("main", "things").await.unwrap();
        assert!(metadata.editable);
        assert!(metadata.columns[0].primary_key);
        let first = RowChange {
            kind: "update".into(),
            original: BTreeMap::from([
                ("id".into(), Some("1".into())),
                ("name".into(), Some("first".into())),
            ]),
            values: BTreeMap::from([("name".into(), Some("updated".into()))]),
        };
        let stale = RowChange {
            kind: "delete".into(),
            original: BTreeMap::from([
                ("id".into(), Some("2".into())),
                ("name".into(), Some("stale value".into())),
            ]),
            values: BTreeMap::new(),
        };
        let changes = vec![first.clone(), stale];
        let plan = session.row_plan("main", "things", &changes).await.unwrap();
        assert!(session
            .apply_rows("main", "things", &changes, &plan)
            .await
            .is_err());
        assert_eq!(
            session
                .query("SELECT name FROM things WHERE id=1", 1)
                .await
                .unwrap()
                .rows[0][0]
                .value,
            "first"
        );
        let changes = vec![
            first,
            RowChange {
                kind: "insert".into(),
                original: BTreeMap::new(),
                values: BTreeMap::from([("id".into(), Some("3".into())), ("name".into(), None)]),
            },
        ];
        let plan = session.row_plan("main", "things", &changes).await.unwrap();
        assert_eq!(
            session
                .apply_rows("main", "things", &changes, &plan)
                .await
                .unwrap(),
            2
        );
        let result = session
            .query("SELECT * FROM things ORDER BY id", 10)
            .await
            .unwrap();
        assert_eq!(result.rows[0][1].value, "updated");
        assert_eq!(result.rows[2][1].kind, "null");
        assert!(session
            .apply_rows("main", "things", &changes, &plan)
            .await
            .is_err());
        let displayed = session.query("SELECT * FROM cell_values", 1).await.unwrap();
        assert_eq!(displayed.rows[0][2].kind, "unsupported");
        let changes = vec![RowChange {
            kind: "update-cell".into(),
            original: BTreeMap::from([
                ("id".into(), Some("1".into())),
                ("settings".into(), Some("{\"enabled\":true}".into())),
            ]),
            values: BTreeMap::from([(
                "settings".into(),
                Some("{\"enabled\":false,\"id\":9007199254740993}".into()),
            )]),
        }];
        let reviewed = session
            .row_plan("main", "cell_values", &changes)
            .await
            .unwrap();
        assert_eq!(
            session
                .apply_rows("main", "cell_values", &changes, &reviewed)
                .await
                .unwrap(),
            1
        );
        let saved = session
            .query("SELECT settings, length(payload) FROM cell_values", 1)
            .await
            .unwrap();
        assert!(saved.rows[0][0].value.contains("9007199254740993"));
        assert_eq!(saved.rows[0][1].value, "70000");
        assert!(session
            .apply_rows("main", "cell_values", &changes, &reviewed)
            .await
            .is_err());
        std::fs::remove_file(path).unwrap();
    }
}
