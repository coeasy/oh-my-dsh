declare module 'sql.js' {
  export type SqlValue = number | string | Uint8Array | null
  export interface QueryExecResult {
    columns: string[]
    values: Array<Array<any>>
  }
  export interface Database {
    run(sql: string, params?: unknown[]): void
    exec(sql: string, params?: unknown[]): QueryExecResult[]
    export(): Uint8Array
    close(): void
  }
  export interface SqlJsStatic {
    Database: new (data?: Uint8Array | null) => Database
  }
  const initSqlJs: (config?: { locateFile?: (file: string) => string }) => Promise<SqlJsStatic>
  export default initSqlJs
}
