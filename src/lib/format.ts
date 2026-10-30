// Formatting shared by server and client code.

export const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");

/** "9876543210" -> "+91 98765 43210" */
export const phoneDisplay = (n: string) => `+91 ${n.slice(0, 5)} ${n.slice(5)}`;
export const telHref = (n: string) => `tel:+91${n}`;

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** IST date + time, e.g. "29 Oct, 8:30 pm" */
export const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
