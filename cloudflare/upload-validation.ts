/**
 * File signature and pixel-bound checks for small Cloudflare Free sandbox evidence.
 * No OCR, malware scan or issuer verification is implied by this validator.
 */
export type EvidenceFormat = {mime: string; extension: "pdf" | "txt" | "jpg" | "png"; width?: number; height?: number};
const LIMIT = 4096;
const invalid = (reason: string): never => {throw new Error(reason)};
const dimension = (width: number, height: number) => {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>LIMIT||height>LIMIT)
    invalid("Resolusi gambar harus antara 1 dan 4096 piksel per sisi");
};
export function detectUploadedFormat(bytes: Uint8Array): EvidenceFormat {
  if(bytes.length===0 || bytes.length>2000000) invalid("Ukuran dokumen harus 1 byte sampai 2 MB");
  if(bytes.length>=5 && String.fromCharCode(...bytes.subarray(0,5))==="%PDF-")
    return {mime:"application/pdf",extension:"pdf"};
  const png=[137,80,78,71,13,10,26,10];
  if(bytes.length>=24 && png.every((n,i)=>bytes[i]===n)) {
    if(bytes[12]!==73||bytes[13]!==72||bytes[14]!==68||bytes[15]!==82 ||
       bytes[8]!==0||bytes[9]!==0||bytes[10]!==0||bytes[11]!==13)
      invalid("Header PNG tidak valid");
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const width=view.getUint32(16),height=view.getUint32(20);
    dimension(width,height);
    return {mime:"image/png",extension:"png",width,height};
  }
  if(bytes.length>4 && bytes[0]===255 && bytes[1]===216) {
    let i=2;
    while(i<bytes.length) {
      if(bytes[i++]!==255) invalid("Struktur JPEG tidak valid");
      while(bytes[i]===255) i++;
      const marker=bytes[i++];
      if(marker===217||marker===218) break;
      if(marker===1||(marker>=208&&marker<=215)) continue;
      if(i+2>bytes.length) invalid("Segmen JPEG terpotong");
      const len=(bytes[i]<<8)|bytes[i+1];
      if(len<2||i+len>bytes.length) invalid("Panjang segmen JPEG tidak valid");
      if([192,193,194,195,198,199,201,202,203,205,206,207].includes(marker)) {
        if(len<7) invalid("Dimensi JPEG tidak tersedia");
        const height=(bytes[i+3]<<8)|bytes[i+4],width=(bytes[i+5]<<8)|bytes[i+6];
        dimension(width,height);
        return {mime:"image/jpeg",extension:"jpg",width,height};
      }
      i+=len;
    }
    invalid("JPEG tidak berisi dimensi gambar yang valid");
  }
  try {
    new TextDecoder("utf-8",{fatal:true}).decode(bytes);
    if(!bytes.includes(0)) return {mime:"text/plain",extension:"txt"};
  } catch {}
  return invalid("Hanya teks UTF-8, PDF, JPG dan PNG yang didukung");
}
