import React,{useEffect,useState} from 'react';
import {Cat,Feather} from 'lucide-react';
export default function Avatar({src,name='',className='',signedAuthor=false}:{src?:string|null;name?:string;className?:string;signedAuthor?:boolean}){
 const [failed,setFailed]=useState(false);useEffect(()=>setFailed(false),[src]);
 return (
  <span className={'avatar '+className+(signedAuthor?' signed-author-avatar':'')}>
   {src&&!failed?<img src={src} alt={name?name+'的头像':'头像'} onError={()=>setFailed(true)}/>:<Cat aria-hidden="true"/>}
   {signedAuthor&&<span className="signed-author-mark" title="签约作者" role="img" aria-label="签约作者"><Feather aria-hidden="true"/></span>}
  </span>
 );
}
