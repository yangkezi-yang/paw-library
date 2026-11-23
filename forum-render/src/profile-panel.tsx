import React,{useState,useRef} from 'react';
import {Camera,Upload,RotateCcw} from 'lucide-react';
import Avatar from './avatar';

async function prepareAvatar(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw Error('请选择 JPG、PNG 或 WebP 图片');
 if(file.size>5*1024*1024)throw Error('请选择小于5MB的图片');
 const url=URL.createObjectURL(file);
 try{
  const image=await new Promise<HTMLImageElement>((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=()=>reject(Error('无法读取这张图片，请换一张试试'));im.src=url});
  if(!image.naturalWidth||!image.naturalHeight)throw Error('无法读取图片尺寸');
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const context=canvas.getContext('2d');if(!context)throw Error('当前浏览器暂不支持处理图片');
  context.fillStyle='#f6f8f4';context.fillRect(0,0,256,256);
  const side=Math.min(image.naturalWidth,image.naturalHeight);context.drawImage(image,(image.naturalWidth-side)/2,(image.naturalHeight-side)/2,side,side,0,0,256,256);
  return canvas.toDataURL('image/jpeg',0.88);
 }finally{URL.revokeObjectURL(url)}
}
export default function ProfilePanel({user,save,onSaved,onLogout,onBusy}:{user:any;save:(x:any)=>Promise<any>;onSaved:(x:any)=>void;onLogout:()=>void;onBusy:(b:boolean)=>void}){
 const [name,setName]=useState(user.name),[preview,setPreview]=useState<string|null>(user.avatar||null),[change,setChange]=useState<string|null|undefined>(undefined),[error,setError]=useState(''),[reading,setReading]=useState(false),[busy,setBusy]=useState(false);
 const fileInput=useRef<HTMLInputElement>(null);
 async function choose(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];e.target.value='';if(!file)return;setError('');setReading(true);onBusy(true);try{const value=await prepareAvatar(file);setPreview(value);setChange(value)}catch(e:any){setError(e.message)}finally{setReading(false);onBusy(false)}}
 async function submit(e:React.FormEvent){e.preventDefault();if(reading||busy)return;setBusy(true);onBusy(true);setError('');try{const result=await save({action:'profile',name,...(change!==undefined?{avatar:change}:{})});onSaved({name:result.name,avatar:result.avatar})}catch(e:any){setError(e.message||'保存失败，请稍后重试')}finally{setBusy(false);onBusy(false)}}
 return <form onSubmit={submit} className="profile-form"><div className="profile-upload"><Avatar src={preview} name={name} signedAuthor={user.signedAuthor} className="profile-preview"/><span className="profile-camera"><Camera size={17}/></span></div><div className="avatar-buttons"><button type="button" className="soft-button" disabled={reading||busy} onClick={()=>fileInput.current?.click()}><Upload size={14}/>{reading?'正在处理图片…':preview?'更换头像':'上传头像'}</button>{preview&&<button type="button" className="avatar-reset" disabled={reading||busy} onClick={()=>{setPreview(null);setChange(null)}}><RotateCcw size={13}/>恢复默认</button>}</div><input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" aria-label="选择头像图片" onChange={choose} disabled={reading||busy} className="avatar-file-input"/><p className="avatar-help">支持 JPG、PNG、WebP，原图最大5MB。自动居中裁成方形，保存后同步显示在帖子和回复中。</p><label className="field-label">社区昵称<input aria-label="社区昵称" value={name} onChange={e=>setName(e.target.value)} minLength={2} maxLength={20} required disabled={reading||busy}/></label>{error&&<p role="alert" className="auth-error">{error}</p>}<p className="muted">选择图片后点击“保存资料”生效。</p><div className="modal-actions"><button type="button" className="text-button" disabled={reading||busy} onClick={onLogout}>退出登录</button><button className="primary" disabled={reading||busy}>{busy?'正在保存…':'保存资料'}</button></div></form>;
}
