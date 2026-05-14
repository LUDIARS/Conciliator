export function fmtTime(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function relTime(unixSec: number): string {
  const diff = Date.now() / 1000 - unixSec;
  if (diff < 60) return "たった今";
  if (diff < 3600) return `${Math.floor(diff / 60)}分前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}時間前`;
  return `${Math.floor(diff / 86400)}日前`;
}

export function baseName(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}
