use std::fs::File;
use std::io::{BufReader, Bytes, Read};
use std::iter::Peekable;
use tokio_util::sync::CancellationToken;

pub enum Record {
    Sql(String, u64),
    Csv(Vec<String>, u64),
}
struct Input {
    bytes: Peekable<Bytes<BufReader<File>>>,
    offset: u64,
    cancel: CancellationToken,
}
impl Input {
    fn next(&mut self) -> Result<Option<u8>, String> {
        if self.offset % 4096 == 0 && self.cancel.is_cancelled() {
            return Err("Transfer cancelled".into());
        }
        match self.bytes.next() {
            Some(Ok(byte)) => {
                self.offset += 1;
                Ok(Some(byte))
            }
            Some(Err(error)) => Err(error.to_string()),
            None => Ok(None),
        }
    }
    fn peek(&mut self) -> Option<u8> {
        self.bytes.peek().and_then(|v| v.as_ref().ok().copied())
    }
}
pub fn parse(
    file: File,
    format: &str,
    engine: &str,
    cancel: CancellationToken,
    mut emit: impl FnMut(Record) -> Result<(), String>,
) -> Result<(), String> {
    let mut input = Input {
        bytes: BufReader::with_capacity(64 * 1024, file).bytes().peekable(),
        offset: 0,
        cancel,
    };
    // Strip a UTF-8 BOM without changing the byte offsets used for progress.
    if input.peek() == Some(0xef) {
        for expected in [0xef, 0xbb, 0xbf] {
            if input.next()? != Some(expected) {
                return Err("Choose a UTF-8 text file".into());
            }
        }
    }
    if format == "csv" {
        csv(&mut input, &mut emit)
    } else {
        sql(&mut input, engine, &mut emit)
    }
}
fn utf8(bytes: Vec<u8>) -> Result<String, String> {
    String::from_utf8(bytes).map_err(|_| "The import file is not UTF-8 text".into())
}
fn csv(
    input: &mut Input,
    emit: &mut impl FnMut(Record) -> Result<(), String>,
) -> Result<(), String> {
    let mut row = Vec::new();
    let mut field = Vec::new();
    let mut quoted = false;
    let mut closed = false;
    let mut started = false;
    let mut width = None;
    loop {
        let byte = input.next()?;
        if quoted {
            match byte {
                None => return Err("A CSV quoted field is not closed".into()),
                Some(b'"') if input.peek() == Some(b'"') => {
                    input.next()?;
                    field.push(b'"');
                }
                Some(b'"') => {
                    quoted = false;
                    closed = true;
                }
                Some(byte) => field.push(byte),
            }
            continue;
        }
        if closed && !matches!(byte, None | Some(b',' | b'\r' | b'\n')) {
            return Err("Unexpected characters after a quoted CSV field".into());
        }
        match byte {
            Some(b'"') => {
                if !field.is_empty() || closed {
                    return Err("CSV quotes must begin at the start of a field".into());
                }
                quoted = true;
                started = true;
            }
            Some(b',') => {
                row.push(utf8(std::mem::take(&mut field))?);
                closed = false;
                started = true;
            }
            None | Some(b'\r' | b'\n') => {
                if byte == Some(b'\r') && input.peek() == Some(b'\n') {
                    input.next()?;
                }
                if started {
                    row.push(utf8(std::mem::take(&mut field))?);
                    match width {
                        Some(width) if row.len() != width => {
                            return Err(
                                "Every CSV row must have the same number of fields as the header"
                                    .into(),
                            )
                        }
                        None => width = Some(row.len()),
                        _ => {}
                    }
                    emit(Record::Csv(std::mem::take(&mut row), input.offset))?;
                }
                if byte.is_none() {
                    break;
                }
                started = false;
                closed = false;
            }
            Some(byte) => {
                field.push(byte);
                started = true;
            }
        }
    }
    if width.is_none() {
        return Err("The CSV is empty".into());
    }
    Ok(())
}
fn first_code(mut sql: &str) -> &str {
    loop {
        sql = sql.trim_start();
        if sql.starts_with("--") || sql.starts_with('#') {
            sql = sql.find('\n').map(|n| &sql[n + 1..]).unwrap_or("");
        } else if sql.starts_with("/*") && !sql.starts_with("/*!") {
            let bytes = sql.as_bytes();
            let mut depth = 1;
            let mut i = 2;
            while i + 1 < bytes.len() && depth > 0 {
                if &bytes[i..i + 2] == b"/*" {
                    depth += 1;
                    i += 2;
                } else if &bytes[i..i + 2] == b"*/" {
                    depth -= 1;
                    i += 2;
                } else {
                    i += 1;
                }
            }
            if depth > 0 {
                return "";
            }
            sql = &sql[i..];
        } else {
            return sql;
        }
    }
}
fn send_sql(
    bytes: Vec<u8>,
    offset: u64,
    emit: &mut impl FnMut(Record) -> Result<(), String>,
) -> Result<(), String> {
    let statement = utf8(bytes)?;
    let code = first_code(&statement);
    let upper = code.to_ascii_uppercase();
    if upper.starts_with("DELIMITER ") || code.starts_with('\\') {
        return Err(
            "SQL import accepts server SQL, without DELIMITER or psql backslash commands".into(),
        );
    }
    if upper.starts_with("COPY ") && upper.contains("FROM STDIN") {
        return Err("COPY FROM STDIN is not supported. Export PostgreSQL dumps with INSERT statements instead.".into());
    }
    if !statement.trim().is_empty() {
        emit(Record::Sql(statement, offset))?;
    }
    Ok(())
}
fn sql(
    input: &mut Input,
    engine: &str,
    emit: &mut impl FnMut(Record) -> Result<(), String>,
) -> Result<(), String> {
    let mut statement = Vec::new();
    let mut quote = None;
    let mut escape_strings = false;
    let mut line_comment = false;
    let mut block_depth = 0usize;
    let mut dollar: Option<(Vec<u8>, usize)> = None;
    let mut has_sql = false;
    while let Some(byte) = input.next()? {
        statement.push(byte);
        if let Some((tag, start)) = &dollar {
            if statement.len() - start >= tag.len() && statement.ends_with(tag) {
                dollar = None;
            }
            continue;
        }
        if line_comment {
            if byte == b'\n' {
                line_comment = false;
            }
            continue;
        }
        if block_depth > 0 {
            if byte == b'*' && input.peek() == Some(b'/') {
                statement.push(input.next()?.unwrap());
                block_depth -= 1;
            } else if engine == "postgres" && byte == b'/' && input.peek() == Some(b'*') {
                statement.push(input.next()?.unwrap());
                block_depth += 1;
            }
            continue;
        }
        if let Some(end) = quote {
            if byte == b'\\' && escape_strings {
                if let Some(next) = input.next()? {
                    statement.push(next);
                }
            } else if byte == end {
                if input.peek() == Some(end) && end != b']' {
                    statement.push(input.next()?.unwrap());
                } else {
                    quote = None;
                }
            }
            continue;
        }
        if byte == b'-' && input.peek() == Some(b'-') {
            statement.push(input.next()?.unwrap());
            line_comment = true;
            continue;
        }
        if engine == "mysql" && byte == b'#' {
            line_comment = true;
            continue;
        }
        if byte == b'/' && input.peek() == Some(b'*') {
            statement.push(input.next()?.unwrap());
            block_depth = 1;
            if engine == "mysql" && input.peek() == Some(b'!') {
                has_sql = true;
            }
            continue;
        }
        if matches!(byte, b'\'' | b'"' | b'`') || (engine == "sqlite" && byte == b'[') {
            quote = Some(if byte == b'[' { b']' } else { byte });
            escape_strings = engine == "mysql"
                || (engine == "postgres"
                    && byte == b'\''
                    && statement.len() >= 2
                    && matches!(statement[statement.len() - 2], b'E' | b'e')
                    && (statement.len() < 3
                        || !statement[statement.len() - 3].is_ascii_alphanumeric()));
            has_sql = true;
            continue;
        }
        if engine == "postgres"
            && byte == b'$'
            && (statement.len() < 2
                || !(statement[statement.len() - 2].is_ascii_alphanumeric()
                    || statement[statement.len() - 2] >= 128
                    || statement[statement.len() - 2] == b'_'))
        {
            let mut tag = vec![b'$'];
            while input
                .peek()
                .is_some_and(|b| b.is_ascii_alphanumeric() || b == b'_')
            {
                tag.push(input.next()?.unwrap());
            }
            if input.peek() == Some(b'$') && (tag.len() == 1 || !tag[1].is_ascii_digit()) {
                tag.push(input.next()?.unwrap());
                statement.extend_from_slice(&tag[1..]);
                dollar = Some((tag, statement.len()));
                has_sql = true;
                continue;
            }
            statement.extend_from_slice(&tag[1..]);
        }
        if byte == b';' {
            if engine == "sqlite" && has_sql {
                let c = std::ffi::CString::new(statement.as_slice())
                    .map_err(|_| "SQL files cannot contain NUL bytes")?;
                // SQLite's own completeness parser keeps CREATE TRIGGER bodies together.
                if unsafe { rusqlite::ffi::sqlite3_complete(c.as_ptr()) } == 0 {
                    continue;
                }
            }
            if has_sql {
                send_sql(std::mem::take(&mut statement), input.offset, emit)?;
            } else {
                statement.clear();
            }
            has_sql = false;
        } else if !byte.is_ascii_whitespace() {
            has_sql = true;
        }
    }
    if quote.is_some() || dollar.is_some() || block_depth != 0 {
        return Err("The SQL file contains an unclosed quote or comment".into());
    }
    if has_sql {
        send_sql(statement, input.offset, emit)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn records(text: &str, format: &str, engine: &str) -> Result<Vec<Record>, String> {
        let path = std::env::temp_dir().join(format!("octode-parse-{}", uuid::Uuid::new_v4()));
        std::fs::write(&path, text).unwrap();
        let mut records = Vec::new();
        let result = parse(
            File::open(&path).unwrap(),
            format,
            engine,
            CancellationToken::new(),
            |record| {
                records.push(record);
                Ok(())
            },
        );
        let _ = std::fs::remove_file(path);
        result.map(|_| records)
    }
    #[test]
    fn sql_keeps_quotes_dollar_bodies_comments_and_sqlite_triggers_together() {
        let sql="-- test\nCREATE FUNCTION x() RETURNS void AS $body$ BEGIN RAISE NOTICE 'a;b'; END; $body$ LANGUAGE plpgsql; /* nested /* ; */ comment */ SELECT E'a\\\';b'; SELECT 'DELIMITER ;';";
        assert_eq!(records(sql, "sql", "postgres").unwrap().len(), 3);
        assert_eq!(
            records("SELECT $tag$tag$;inside$tag$; SELECT 1;", "sql", "postgres")
                .unwrap()
                .len(),
            2
        );
        let trigger="CREATE TRIGGER t AFTER INSERT ON x BEGIN INSERT INTO y VALUES('a;b'); INSERT INTO y VALUES(CASE WHEN 1 THEN 2 ELSE 3 END); END; SELECT 1;";
        assert_eq!(records(trigger, "sql", "sqlite").unwrap().len(), 2);
        assert_eq!(
            records("/*!40101 SET x=1 */; SELECT 1;", "sql", "mysql")
                .unwrap()
                .len(),
            2
        );
        assert!(records("-- comment\nDELIMITER $$\nSELECT 1;", "sql", "mysql").is_err());
        assert!(records("-- comment\nCOPY x FROM STDIN;\n1\n\\.", "sql", "postgres").is_err());
        assert!(records("SELECT 'unclosed;", "sql", "sqlite").is_err());
    }
    #[test]
    fn csv_preserves_bom_quotes_newlines_empty_fields_and_checks_width() {
        let rows = records(
            "\u{feff}id,text,empty\r\n1,\"a,\"\"b\"\"\r\nĆao\",\"\"\r\n2,x,\r\n",
            "csv",
            "sqlite",
        )
        .unwrap();
        assert_eq!(rows.len(), 3);
        match &rows[1] {
            Record::Csv(row, _) => assert_eq!(row, &["1", "a,\"b\"\r\nĆao", ""]),
            _ => panic!(),
        }
        assert!(records("a,b\n1\n", "csv", "sqlite").is_err());
        assert!(records("a\n\"bad", "csv", "sqlite").is_err());
    }
}
