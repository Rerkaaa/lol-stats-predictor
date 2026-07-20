const parts = Object.fromEntries(new Intl.DateTimeFormat("en", { timeZone: "Europe/Tirane", hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((part) => [part.type, part.value]));
if (parts.hour !== "00") process.exit(1);
