import type { DbResult } from "../toolTypes";
import type { TableMetadata } from "../lib/databaseRows";
function MetadataGrid({
  title,
  result,
  empty,
}: {
  title: string;
  result: DbResult;
  empty: string;
}) {
  return (
    <section>
      <h3>{title}</h3>
      {result.rows.length ? (
        <div className="data-grid">
          <table>
            <thead>
              <tr>
                {result.columns.map((column, index) => (
                  <th key={index}>{column.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, index) => (
                <tr key={index}>
                  {row.map((cell, column) => (
                    <td key={column}>
                      {cell.kind === "null" ? "NULL" : cell.value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="service-hint">{empty}</p>
      )}
      {result.truncated && (
        <p className="service-hint">Metadata display limit reached.</p>
      )}
    </section>
  );
}
export default function DatabaseTableInfo({ metadata }: { metadata: TableMetadata }) {
  return (
    <div
      className="service-content database-table-info"
      role="region"
      aria-label="Table info"
    >
      <section>
        <h3>Columns</h3>
        <div className="data-grid">
          <table>
            <thead>
              <tr>
                <th>Column</th>
                <th>Type</th>
                <th>Nullable</th>
                <th>Key / default</th>
              </tr>
            </thead>
            <tbody>
              {metadata.columns.map((column) => (
                <tr key={column.name}>
                  <td>{column.name}</td>
                  <td>{column.fullType || column.dataType}</td>
                  <td>{column.nullable ? "YES" : "NO"}</td>
                  <td>
                    {column.primaryKey ? "PRIMARY KEY · " : ""}
                    {column.generated ? "Generated · " : ""}
                    {column.defaultValue ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <MetadataGrid
        title="Indexes"
        result={metadata.indexes}
        empty="No indexes."
      />
      <MetadataGrid
        title="Relationships"
        result={metadata.foreignKeys}
        empty="No relationships."
      />
    </div>
  );
}
