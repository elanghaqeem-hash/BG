import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata={title:'BG Ecosystem | Bank Garansi Syariah',description:'Portal pengembangan Bank Garansi lima aktor'};
export default function RootLayout({children}:{children:React.ReactNode}) {return <html lang="id"><body>{children}</body></html>}
