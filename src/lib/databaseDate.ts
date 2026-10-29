export type CellDateKind = "date" | "datetime";
export function cellDateKind(type: string, value: string): CellDateKind | null {
  if (/^(date)$/i.test(type.trim())) return "date";
  if (/^(datetime|timestamptz|timestamp)(?:\b|\()/i.test(type.trim()))
    return "datetime";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date";
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/.test(value)) return "datetime";
  return null;
}
export function dateParts(value: string) {
  const match =
    /^(\d{4}-\d{2}-\d{2})(?:([ T])(\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?)(.*))?$/.exec(
      value,
    );
  return {
    date: match?.[1] ?? "",
    separator: match?.[2] ?? " ",
    time: match?.[3] ?? "00:00:00",
    suffix: match?.[4] ?? "",
  };
}
export function validCellDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return (
    Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value
  );
}
export function calendarDays(month: string) {
  const first = new Date(`${month}-01T12:00:00Z`);
  const start = first.valueOf() - first.getUTCDay() * 86400000;
  return Array.from({ length: 42 }, (_, index) =>
    new Date(start + index * 86400000).toISOString().slice(0, 10),
  );
}
export function moveCalendarMonth(month: string, offset: number) {
  const date = new Date(`${month}-01T12:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 7);
}
export function pickedDate(
  kind: CellDateKind,
  date: string,
  time: string,
  source: string,
) {
  if (!validCellDate(date)) throw new Error("Choose a valid date.");
  if (kind === "date") return date;
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,9})?)?$/.test(time))
    throw new Error("Use HH:mm or HH:mm:ss with optional fractional seconds.");
  const parts = dateParts(source);
  return `${date}${parts.separator}${time}${parts.suffix}`;
}
