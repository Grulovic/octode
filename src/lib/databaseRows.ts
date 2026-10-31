import type { DbResult } from "../toolTypes";

export interface ColumnMetadata {
  name: string;
  dataType: string;
  nullable: boolean;
  primaryKey: boolean;
  defaultValue: string | null;
  generated: boolean;
  fullType?: string;
  extra?: string;
  collation?: string;
  comment?: string;
}
export interface TableMetadata {
  columns: ColumnMetadata[];
  indexes: DbResult;
  foreignKeys: DbResult;
  editable: boolean;
  reason: string;
}
export interface RowPlan {
  statements: {
    sql: string;
    parameters: (string | null)[];
    checkSql: string | null;
    checkParameters: (string | null)[];
  }[];
}
