// 同期の結果を、画面の知らせの文言にする。圏外は普通のことなので、騒がない
import type { SyncStatus } from "../data/syncRunner.ts";

export interface SyncNotice {
  tone: "info" | "warning" | "danger";
  text: string;
}

export function syncNotice(status: SyncStatus, pending: number): SyncNotice | null {
  const waiting = pending > 0 ? `未送信 ${pending} 件。` : "";
  switch (status.errorKind) {
    case "offline":
      return pending > 0 ? { tone: "info", text: `つながっていません。${waiting}つながったら送ります。` } : null;
    case "auth":
      return { tone: "danger", text: `ログインが切れました。${waiting}ログインし直してください。` };
    case "forbidden":
      return { tone: "danger", text: `シートへの権限がありません。${waiting}持ち主に「編集者」の権限をもらってください。` };
    case "notFound":
      return { tone: "danger", text: `シートが見つかりません。${waiting}アカウントの画面から別のシートへ切り替えられます。` };
    case "schema":
      return { tone: "danger", text: `シートの形が合いません。${waiting}アプリを更新するか、シートの見出しを確かめてください。` };
    case "invalid":
      return { tone: "danger", text: `シートへの書き込みが拒否されました。${waiting}シートの内容を確かめてください。` };
    case "rateLimited":
    case "server":
      return { tone: "warning", text: `Google のサーバーが混み合っています。${waiting}あとで送り直します。` };
    case "unknown":
      return { tone: "danger", text: `同期できませんでした。${waiting}` };
    case null:
      break;
  }
  if (status.issues.length > 0) {
    return { tone: "warning", text: `シートの ${status.issues.length} 行を読み取れませんでした。シートの内容を確かめてください。` };
  }
  return null;
}
