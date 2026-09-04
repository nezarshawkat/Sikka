import { readFile } from "node:fs/promises";

const expected = "google.com, pub-2875822124723194, DIRECT, f08c47fec0942fa0";
const localFile = new URL(
  "../artifacts/sikka/public/app-ads.txt",
  import.meta.url,
);
const url = process.argv[2];

function assertRecord(value, source) {
  const lines = value
    .replace(/^\uFEFF/, "")
    .trim()
    .split(/\r?\n/);
  if (!lines.includes(expected)) {
    throw new Error(
      `${source} does not contain the required AdMob record: ${expected}`,
    );
  }
}

const local = await readFile(localFile, "utf8");
assertRecord(local, "artifacts/sikka/public/app-ads.txt");

if (!url) {
  console.log("Local app-ads.txt is valid.");
  process.exit(0);
}

const response = await fetch(new URL("/app-ads.txt", url), {
  redirect: "follow",
});
if (!response.ok) {
  throw new Error(
    `Published app-ads.txt returned HTTP ${response.status} at ${response.url}`,
  );
}

const contentType = response.headers.get("content-type") ?? "";
if (!contentType.toLowerCase().startsWith("text/plain")) {
  throw new Error(
    `Published app-ads.txt must be text/plain, received ${contentType || "no Content-Type"}`,
  );
}

assertRecord(await response.text(), response.url);
console.log(`Published app-ads.txt is valid: ${response.url}`);
