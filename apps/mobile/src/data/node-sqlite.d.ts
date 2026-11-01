// テストで使う node:sqlite の型。Node の型を入れないので、使う分だけを宣言する
declare module "node:sqlite" {
  interface Statement {
    run(...params: unknown[]): { changes: number | bigint };
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): Statement;
  }
}
