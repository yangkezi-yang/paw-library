import type {Metadata} from 'next';
import './globals.css';
export const metadata:Metadata={title:'猫爪 · 短剧资源库',description:'把灵感收进猫爪，视频与文档的一站式资源空间',icons:{icon:'/favicon.svg'}};
export default function Layout({children}:{children:React.ReactNode}){return <html lang="zh-CN"><body>{children}</body></html>}
