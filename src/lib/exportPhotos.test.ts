import { expect, it } from "vitest";
import { checkExportPhotoUrl, exportPhotoPath } from "./exportPhotos";

it("keeps signed photo URLs below Trade Me's limit with the observed HS512 token format", () => {
  const uid = "bf7e5f66-0f25-4645-80d5-611af6df560e";
  const id = "ac8d1941-7bc8-4f30-b436-6c34f2312d20";
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/=+$/, "");
  const header = encode({ kid: "b7e23cad-c172-4104-b2be-916fb12295df", alg: "HS512" });
  const urlFor = (path: string) => {
    const payload = encode({ url: `photos/${path}`, scope: "download", iat: 1791671766, exp: 1792881366 });
    return `https://mbqnmdhuanjldmhkbcld.supabase.co/storage/v1/object/sign/photos/${path}?token=${header}.${payload}.${"s".repeat(86)}`;
  };
  expect(urlFor(`${uid}/export/${id}/1.jpg`).length).toBe(540);
  for (let n = 1; n <= 20; n++) {
    const path = exportPhotoPath(uid, id, n);
    expect(path.split("/")[0]).toBe(uid);
    expect(checkExportPhotoUrl(urlFor(path)).length).toBeLessThanOrEqual(500);
  }
});

it("refuses oversized URLs instead of creating an import Trade Me will reject", () => {
  expect(checkExportPhotoUrl("x".repeat(500))).toHaveLength(500);
  expect(() => checkExportPhotoUrl("x".repeat(501))).toThrow("ZIP with photo files");
});
