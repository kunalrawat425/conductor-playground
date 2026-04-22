const IST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" };

export function fmtDateTimeIST(d: string | Date): string {
  return new Date(d).toLocaleString("en-IN", { ...IST });
}

export function fmtDateIST(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" });
}

export function fmtDateLongIST(d: string | Date): string {
  return new Date(d).toLocaleDateString("en-IN", { ...IST });
}

export function fmtTimeIST(d: string | Date): string {
  return new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit" });
}

export function fmtScheduledIST(d: string | Date): string {
  return new Date(d).toLocaleString("en-IN", { ...IST, weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function fmtOrderTimeIST(d: string | Date): string {
  return new Date(d).toLocaleString("en-IN", { ...IST, hour: "numeric", minute: "2-digit" });
}

export function fmtDateTimeFullIST(d: string | Date): string {
  return `${new Date(d).toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short" })} at ${new Date(d).toLocaleTimeString("en-IN", { ...IST, hour: "2-digit", minute: "2-digit" })}`;
}
