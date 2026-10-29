import test from "node:test";
import assert from "node:assert/strict";
import {detectUploadedFormat} from "../cloudflare/upload-validation.ts";

const bytes = (value) => new TextEncoder().encode(value);
test("PDF, TXT, PNG and JPEG signatures recognized; formats are not assumed from filenames",()=>{
  assert.equal(detectUploadedFormat(bytes("%PDF-1.7\\nDocument")).extension,"pdf");
  assert.equal(detectUploadedFormat(bytes("Nomor surat 2026")).extension,"txt");
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,3,32,0,0,2,88,8,2,0,0,0]);
  assert.deepEqual([detectUploadedFormat(png).extension,detectUploadedFormat(png).width,detectUploadedFormat(png).height],["png",800,600]);
  const jpg=Uint8Array.from([255,216,255,192,0,17,8,2,88,3,32,3,1,17,0,2,17,1,3,17,1,255,217]);
  assert.equal(detectUploadedFormat(jpg).extension,"jpg");
});
test("reject empty, invalid, high-resolution, oversized and truncated image evidence",()=>{
  assert.throws(()=>detectUploadedFormat(new Uint8Array()),/Ukuran/);
  assert.throws(()=>detectUploadedFormat(new Uint8Array(2000001)),/Ukuran/);
  assert.throws(()=>detectUploadedFormat(Uint8Array.from([0,255,0,2])),/Hanya/);
  const png=Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,13,73,72,68,82,0,0,16,1,0,0,2,88]);
  assert.throws(()=>detectUploadedFormat(png),/4096/);
  assert.throws(()=>detectUploadedFormat(Uint8Array.from([255,216,255,192,0,17,8])),/terpotong/);
});
