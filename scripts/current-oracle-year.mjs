const parts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Tirane", year: "numeric" }).formatToParts(new Date());
const year = parts.find((part) => part.type === "year")?.value;
if (!year) throw new Error("Unable to determine the current Europe/Tirane year.");
process.stdout.write(year);
