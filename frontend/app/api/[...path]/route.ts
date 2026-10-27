import {NextRequest} from 'next/server';
export const dynamic='force-dynamic';
async function proxy(request:NextRequest,{params}:{params:Promise<{path:string[]}>}){
  const {path}=await params;
  const base=process.env.BG_API_INTERNAL_URL||'http://127.0.0.1:8000';
  const target=base.replace(/\/$/,'')+'/'+path.map(encodeURIComponent).join('/')+request.nextUrl.search;
  const headers=new Headers();
  for(const name of ['cookie','content-type','x-csrf-token']){const value=request.headers.get(name);if(value)headers.set(name,value)}
  try{
    const body=request.method==='GET'?undefined:await request.arrayBuffer();
    if(body&&body.byteLength>3_000_000)return Response.json({detail:'Permintaan terlalu besar'},{status:413});
    const upstream=await fetch(target,{method:request.method,headers,body,cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(30_000)});
    const output=new Headers({'Cache-Control':'no-store'});
    for(const name of ['content-type','content-disposition','set-cookie','x-request-id']){const value=upstream.headers.get(name);if(value)output.set(name,value)}
    return new Response(upstream.body,{status:upstream.status,headers:output});
  }catch{return Response.json({code:'UPSTREAM',detail:'Layanan transaksi belum tersedia. Coba lagi setelah koneksi pulih.'},{status:503})}
}
export {proxy as GET,proxy as POST};
